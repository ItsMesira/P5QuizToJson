/* POST /api/auth/login — verify credentials (+ optionally auto-join a class) */
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { sql } from "../_lib/db.js";
import { ensureSchema } from "../_lib/db.js";
import {
  verifyPassword, dummyVerify, createSession, sessionCookie, csrfCookieHeader, sessionInfo,
  recordAuthFail, clearAuthFails, authLocked, SESSION_DAYS,
} from "../_lib/auth.js";
import { usernameSchema, passwordSchema, classCodeSchema, parse } from "../_lib/validate.js";
import { badRequest, ok, fail, tooMany, readBody, clientIp, rateLimit, serverError, sameSite } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  if (!sameSite(req)) return fail(res, 403, "Cross-origin request blocked");
  const ip = clientIp(req.headers as never);
  if (!rateLimit(`login:${ip}`, 10)) return tooMany(res);
  try {
    await ensureSchema();
    const body = await readBody(req as never);
    const u = parse(usernameSchema, (body as Record<string, unknown>)?.username);
    if (!u.ok) return badRequest(res, u.error);
    const p = parse(passwordSchema, (body as Record<string, unknown>)?.password);
    if (!p.ok) return badRequest(res, p.error);

    const userKey = `login-user:${u.data.toLowerCase()}`;
    const ipKey = `login-ip:${ip}`;
    if ((await authLocked(userKey, 8, 15)) || (await authLocked(ipKey, 20, 15))) return tooMany(res);

    let classCode: string | null = null;
    if ((body as Record<string, unknown>)?.classCode) {
      const c = parse(classCodeSchema, (body as Record<string, unknown>)?.classCode);
      if (!c.ok) return badRequest(res, c.error);
      classCode = c.data;
    }

    const rows = await sql`SELECT id, pass_hash FROM users WHERE username = ${u.data} LIMIT 1`;
    const user = rows.rows[0];
    // always spend the same work: verify the hash, or a dummy when absent
    const okPass = user ? await verifyPassword(String(user.pass_hash), p.data) : await dummyVerify(p.data);
    if (!user || !okPass) {
      await recordAuthFail(userKey);
      await recordAuthFail(ipKey);
      return fail(res, 401, "Wrong username or password");
    }
    await clearAuthFails(userKey);
    await clearAuthFails(ipKey);

    if (classCode) {
      const cls = await sql`SELECT id FROM classes WHERE code = ${classCode} LIMIT 1`;
      if (cls.rows.length > 0) {
        await sql`INSERT INTO members (class_id, user_id, role) VALUES (${String(cls.rows[0].id)}, ${String(user.id)}, 'student') ON CONFLICT DO NOTHING`;
      }
    }

    const { token, csrf } = await createSession(String(user.id));
    res.setHeader("Set-Cookie", [sessionCookie(token), csrfCookieHeader(csrf, SESSION_DAYS * 86_400)]);
    return ok(res, { ok: true, session: await sessionInfo(token) });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}