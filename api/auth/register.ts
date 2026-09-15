/* POST /api/auth/register — create account (+ optionally auto-join a class) */
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { sql } from "../_lib/db.js";
import { ensureSchema } from "../_lib/db.js";
import { hashPassword, createSession, cookieHeader, csrfCookieHeader, sessionInfo, newId } from "../_lib/auth.js";
import { usernameSchema, passwordSchema, emailSchema, classCodeSchema, parse } from "../_lib/validate.js";
import { badRequest, ok, fail, tooMany, readBody, clientIp, rateLimit, serverError } from "../_lib/http.js";

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
    const e = parse(emailSchema, (body as Record<string, unknown>)?.email ?? "");
    if (!e.ok) return badRequest(res, e.error);

    // joined-first flow: class code may arrive before any account exists
    let classCode: string | null = null;
    if ((body as Record<string, unknown>)?.classCode) {
      const c = parse(classCodeSchema, (body as Record<string, unknown>)?.classCode);
      if (!c.ok) return badRequest(res, c.error);
      classCode = c.data;
    }

    const dup = await sql`SELECT 1 FROM users WHERE username = ${u.data} LIMIT 1`;
    if (dup.rows.length > 0) return fail(res, 409, "That username is taken");
    const email = e.data?.trim() || null;
    if (email) {
      const dupE = await sql`SELECT 1 FROM users WHERE email = ${email} LIMIT 1`;
      if (dupE.rows.length > 0) return fail(res, 409, "That email is already registered");
    }

    const id = newId();
    const passHash = await hashPassword(p.data);
    await sql`INSERT INTO users (id, username, email, pass_hash) VALUES (${id}, ${u.data}, ${email}, ${passHash})`;

    if (classCode) {
      const cls = await sql`SELECT id FROM classes WHERE code = ${classCode} LIMIT 1`;
      if (cls.rows.length > 0) {
        await sql`INSERT INTO members (class_id, user_id, role) VALUES (${String(cls.rows[0].id)}, ${id}, 'student') ON CONFLICT DO NOTHING`;
      }
    }

    const { token, csrf } = await createSession(id);
    res.setHeader("Set-Cookie", [cookieHeader("p5q_session", token, 60 * 60 * 24 * 30), csrfCookieHeader(csrf, 60 * 60 * 24 * 30)]);
    return ok(res, { ok: true, session: await sessionInfo(token) });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
