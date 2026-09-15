/* GET /api/health — liveness ping for the daily keep-alive cron.
   Runs a real SELECT 1 through the pool so the database registers
   activity (this is what stops Supabase free projects from pausing). */
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { sql } from "./_lib/db.js";
import { ok, fail, tooMany, clientIp, rateLimit } from "./_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return fail(res, 405, "GET only");
  if (!rateLimit(clientIp(req.headers), 60)) return tooMany(res);
  try {
    await sql`SELECT 1`;
    return ok(res, { ok: true, db: "up" });
  } catch {
    return fail(res, 503, "Database unreachable");
  }
}
