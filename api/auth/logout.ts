/* POST /api/auth/logout — destroy session, clear cookies (CSRF-protected) */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { ensureSchema } from "../_lib/db";
import { destroySession, clearCookieHeaders, parseCookies, csrfValid } from "../_lib/auth";
import { ok, unauthorized, fail, serverError } from "../_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    await ensureSchema();
    const cookies = parseCookies(req.headers.cookie ?? null);
    const token = cookies["p5q_session"];
    if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
    if (!token) return unauthorized(res);
    await destroySession(token);
    res.setHeader("Set-Cookie", clearCookieHeaders());
    return ok(res);
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
