/* GET /api/health — liveness ping for the daily keep-alive cron.
   Runs a real SELECT 1 through the pool so the database registers
   activity (this is what stops Supabase free projects from pausing).
   Also opportunistically clears expired sessions + stale lockout rows.
   On failure it returns a SAFE reason code (never a secret) so an operator
   can curl it and know which env value to fix. */
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { sql } from "./_lib/db.js";
import { ok, fail, tooMany, clientIp, rateLimit } from "./_lib/http.js";

function dbReason(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message ?? "");
  const code = String(e?.code ?? "");
  if (/tenant identifier|ENOIDENTIFIER/i.test(msg) || code === "XX000") return "db-url-missing-project-ref";
  if (code === "28P01" || /password authentication failed/i.test(msg)) return "db-auth-failed";
  if (code === "ENOTFOUND" || /getaddrinfo|ENOTFOUND/i.test(msg)) return "db-host-not-found";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout|timed out/i.test(msg)) return "db-unreachable";
  if (!/^postgres(ql)?:\/\//.test((process.env.DATABASE_URL ?? "").trim())) return "db-url-missing-or-invalid";
  return "db-error";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return fail(res, 405, "GET only");
  if (!rateLimit(clientIp(req.headers), 60)) return tooMany(res);
  try {
    await sql`SELECT 1`;
    // retention is best-effort: never fail a liveness ping because of it
    try {
      await sql`DELETE FROM sessions WHERE expires < now()`;
      await sql`DELETE FROM auth_attempts WHERE last < now() - interval '1 day'`;
    } catch {
      /* tables not migrated yet — ignore */
    }
    return ok(res, { ok: true });
  } catch (err) {
    return fail(res, 503, dbReason(err));
  }
}