/* POST /api/auth/login — verify credentials (+ optionally auto-join a class) */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql } from "../_lib/db";
import { ensureSchema } from "../_lib/db";
import { verifyPassword, createSession, cookieHeader, csrfCookieHeader, sessionInfo } from "../_lib/auth";
import { usernameSchema, passwordSchema, classCodeSchema, parse } from "../_lib/validate";
import { badRequest, ok, fail, tooMany, readBody, clientIp, rateLimit, serverError } from "../_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  if (!rateLimit(clientIp(req.headers as never), 10)) return tooMany(res);
  try {
    await ensureSchema();
    const body = await readBody(req as never);
    const u = parse(usernameSchema, (body as Record<string, unknown>)?.username);
    if (!u.ok) return badRequest(res, u.error);
    const p = parse(passwordSchema, (body as Record<string, unknown>)?.password);
    if (!p.ok) return badRequest(res, p.error);

    let classCode: string | null = null;
    if ((body as Record<string, unknown>)?.classCode) {
      const c = parse(classCodeSchema, (body as Record<string, unknown>)?.classCode);
      if (!c.ok) return badRequest(res, c.error);
      classCode = c.data;
    }

    const rows = await sql`SELECT id, pass_hash FROM users WHERE username = ${u.data} LIMIT 1`;
    const user = rows.rows[0];
    if (!user || !(await verifyPassword(String(user.pass_hash), p.data))) {
      return fail(res, 401, "Wrong username or password");
    }

    if (classCode) {
      const cls = await sql`SELECT id FROM classes WHERE code = ${classCode} LIMIT 1`;
      if (cls.rows.length > 0) {
        await sql`INSERT INTO members (class_id, user_id, role) VALUES (${String(cls.rows[0].id)}, ${String(user.id)}, 'student') ON CONFLICT DO NOTHING`;
      }
    }

    const { token, csrf } = await createSession(String(user.id));
    res.setHeader("Set-Cookie", [cookieHeader("p5q_session", token, 60 * 60 * 24 * 30), csrfCookieHeader(csrf, 60 * 60 * 24 * 30)]);
    return ok(res, { ok: true, session: await sessionInfo(token) });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
