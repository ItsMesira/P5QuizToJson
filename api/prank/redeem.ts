/* /api/prank/redeem — consume a one-time .env drop.
   GET  ?code=…  → existence check only (never consumes, safe for link previews)
   POST {code}   → atomic DELETE … RETURNING, so exactly one caller wins */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql, ensureSchema } from "../_lib/db";
import { ok, fail, tooMany, notFound, readBody, clientIp, rateLimit, serverError } from "../_lib/http";
import { createHash } from "node:crypto";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "GET/POST only");
  if (!rateLimit(clientIp(req.headers as never), req.method === "GET" ? 60 : 20)) return tooMany(res);
  try {
    await ensureSchema();

    let code = "";
    if (req.method === "GET") {
      code = String(req.query?.code ?? "");
    } else {
      const body = (await readBody(req as never)) as Record<string, unknown> | null;
      code = typeof body?.code === "string" ? body.code : "";
    }
    code = code.trim();
    if (code.length < 8 || code.length > 128) return notFound(res, "No such code");

    const hash = createHash("sha256").update(code).digest("hex");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const hit = await sql`SELECT expires FROM prank_drops WHERE code_hash = ${hash} AND expires > now() LIMIT 1`;
      /* never reveal the payload here — this path is what crawlers/previewers hit */
      return ok(res, { ok: true, exists: hit.rows.length > 0 });
    }

    const gone = await sql`DELETE FROM prank_drops WHERE code_hash = ${hash} AND expires > now() RETURNING payload`;
    if (gone.rows.length === 0) return notFound(res, "Code not found, already used, or expired");
    return ok(res, { ok: true, env: String(gone.rows[0].payload) });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}