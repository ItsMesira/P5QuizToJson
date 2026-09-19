/* /api/auth/me — GET current session · POST logout · DELETE own account.
   (logout was merged here to stay within the 12-function limit.) */
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { sql, ensureSchema } from "../_lib/db.js";
import { sessionInfo, parseCookies, destroySession, clearCookieHeaders, csrfValid, getUserByToken, COOKIE } from "../_lib/auth.js";
import { ok, unauthorized, fail, serverError } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    await ensureSchema();
    const cookies = parseCookies(req.headers.cookie ?? null);
    const token = cookies[COOKIE];

    if (req.method === "GET") {
      const session = await sessionInfo(token);
      if (!session) return unauthorized(res);
      return ok(res, { ok: true, session });
    }

    if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) {
      return unauthorized(res, "Missing CSRF token");
    }

    if (req.method === "POST") {
      if (token) await destroySession(token);
      res.setHeader("Set-Cookie", clearCookieHeaders());
      return ok(res);
    }

    if (req.method === "DELETE") {
      const user = await getUserByToken(token);
      if (!user) return unauthorized(res);
      const adm = await sql`SELECT is_admin FROM users WHERE id = ${user.id} LIMIT 1`;
      if (adm.rows[0]?.is_admin) return fail(res, 403, "Admin accounts are removed from the admin panel");
      await sql`DELETE FROM users WHERE id = ${user.id}`; // cascades sessions/quizzes/results/members
      res.setHeader("Set-Cookie", clearCookieHeaders());
      return ok(res);
    }

    return fail(res, 405, "GET/POST/DELETE only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}