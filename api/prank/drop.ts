/* POST /api/prank/drop — store a one-time .env blob, return its code.
   The plaintext code is only ever returned here; the DB stores its hash.
   Not covered by CSRF on purpose: it is anonymous and rate-limited. */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql, ensureSchema } from "../_lib/db";
import { ok, fail, tooMany, badRequest, readBody, clientIp, rateLimit, serverError } from "../_lib/http";
import { createHash, randomBytes } from "node:crypto";

const MAX_ENV = 4096;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  if (!rateLimit(clientIp(req.headers as never), 20)) return tooMany(res);
  try {
    await ensureSchema();
    const body = (await readBody(req as never)) as Record<string, unknown> | null;
    const env = typeof body?.env === "string" ? body.env : "";
    const ttl = Math.min(Math.max(Math.round(Number(body?.ttlMinutes ?? 60) || 60), 5), 1440);
    if (!env.trim() || env.length > MAX_ENV) return badRequest(res, "env missing or too large (4KB max)");
    if (!/^\s*DISCORD_TOKEN=/m.test(env)) return badRequest(res, "not a prank-agent .env (missing DISCORD_TOKEN=)");

    const code = randomBytes(16).toString("base64url"); // 22 chars, unguessable
    const hash = createHash("sha256").update(code).digest("hex");
    const expires = new Date(Date.now() + ttl * 60_000);

    await sql`DELETE FROM prank_drops WHERE expires < now()`;
    await sql`INSERT INTO prank_drops (code_hash, payload, expires) VALUES (${hash}, ${env}, ${expires.toISOString()}::timestamptz)`;

    res.setHeader("Cache-Control", "no-store");
    return ok(res, { ok: true, code, expiresInMinutes: ttl });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}