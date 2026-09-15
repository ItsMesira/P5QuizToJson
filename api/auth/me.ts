/* GET /api/auth/me — current session (user + active class) */
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { ensureSchema } from "../_lib/db.js";
import { sessionInfo, parseCookies } from "../_lib/auth.js";
import { ok, unauthorized, serverError } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return unauthorized(res);
  try {
    await ensureSchema();
    const token = parseCookies(req.headers.cookie ?? null)["p5q_session"];
    const session = await sessionInfo(token);
    if (!session) return unauthorized(res);
    return ok(res, { ok: true, session });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
