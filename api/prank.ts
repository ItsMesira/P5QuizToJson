/* /api/prank — one-time .env delivery for the prank-agent installer.
   POST { op:"drop",   env, ttlMinutes } → store, returns a code
   POST { op:"redeem", code }            → atomic consume, returns env
   GET  ?code=…                          → existence check only (never consumes)
   The plaintext code is only ever returned by "drop"; the DB stores its hash. */
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { sql, ensureSchema } from "./_lib/db.js";
import { ok, fail, tooMany, badRequest, notFound, readBody, clientIp, rateLimit, serverError } from "./_lib/http.js";
import { createHash, randomBytes } from "node:crypto";

const MAX_ENV = 4096;

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "GET/POST only");
  if (!rateLimit(clientIp(req.headers as never), req.method === "GET" ? 60 : 20)) return tooMany(res);
  try {
    await ensureSchema();
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const code = String(req.query?.code ?? "").trim();
      if (code.length < 8 || code.length > 128) return notFound(res, "No such code");
      const hit = await sql`SELECT 1 FROM prank_drops WHERE code_hash = ${hashOf(code)} AND expires > now() LIMIT 1`;
      /* never reveal the payload here — this path is what crawlers/previewers hit */
      return ok(res, { ok: true, exists: hit.rows.length > 0 });
    }

    const body = (await readBody(req as never)) as Record<string, unknown> | null;
    const op = String(body?.op ?? "");

    if (op === "drop") {
      const env = typeof body?.env === "string" ? body.env : "";
      const ttl = Math.min(Math.max(Math.round(Number(body?.ttlMinutes ?? 60) || 60), 5), 1440);
      if (!env.trim() || env.length > MAX_ENV) return badRequest(res, "env missing or too large (4KB max)");
      if (!/^\s*DISCORD_TOKEN=/m.test(env)) return badRequest(res, "not a prank-agent .env (missing DISCORD_TOKEN=)");

      const code = randomBytes(16).toString("base64url"); // 22 chars, unguessable
      const expires = new Date(Date.now() + ttl * 60_000);
      await sql`DELETE FROM prank_drops WHERE expires < now()`;
      await sql`INSERT INTO prank_drops (code_hash, payload, expires) VALUES (${hashOf(code)}, ${env}, ${expires.toISOString()}::timestamptz)`;
      return ok(res, { ok: true, code, expiresInMinutes: ttl });
    }

    if (op === "redeem") {
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (code.length < 8 || code.length > 128) return notFound(res, "Code not found, already used, or expired");
      const gone = await sql`DELETE FROM prank_drops WHERE code_hash = ${hashOf(code)} AND expires > now() RETURNING payload`;
      if (gone.rows.length === 0) return notFound(res, "Code not found, already used, or expired");
      return ok(res, { ok: true, env: String(gone.rows[0].payload) });
    }

    return badRequest(res, "Unknown op");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}