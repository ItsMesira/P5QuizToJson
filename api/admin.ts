/* ============ P5 QUIZ — ADMIN API (single function, action-based) ============
   Auth: separate p5q_admin cookie (HttpOnly, SameSite=Lax), argon2id, DB-backed
   lockout, CSRF double-submit, password step-up for destructive actions.
   Every action is allowlisted, zod-validated, parameterized, and audited. */
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { sql, ensureSchema } from "./_lib/db.js";
import { z } from "zod";
import {
  adminByToken, createSession, destroySession, destroyUserSessions, parseCookies,
  csrfValid, csrfCookieHeader, adminCookie, clearAdminCookieHeader, verifyPassword, hashPassword,
  markStepUp, steppedRecently, audit, randomToken, ADMIN_COOKIE, SESSION_DAYS,
  recordAuthFail, clearAuthFails, authLocked, dummyVerify,
} from "./_lib/auth.js";
import { parse } from "./_lib/validate.js";
import {
  ok, fail, badRequest, unauthorized, forbidden, notFound, tooMany, readBody,
  clientIp, rateLimit, serverError, sameSite,
} from "./_lib/http.js";

type Obj = Record<string, unknown>;

const usernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/);
const emailOpt = z.string().trim().toLowerCase().email().max(150).nullable().optional();
const idSchema = z.string().uuid();
const limitSchema = z.number().int().min(1).max(200).optional();
const offsetSchema = z.number().int().min(0).max(1_000_000).optional();
const passwordSchema = z.string().min(10).max(128).refine((p) => !/^(?:password|admin|123456|qwerty)/i.test(p), "Password is too common");

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  if (!sameSite(req)) return fail(res, 403, "Cross-origin request blocked");
  const ip = clientIp(req.headers as never);
  if (!rateLimit(`admin:${ip}`, 40)) return tooMany(res);

  try {
    await ensureSchema();
    const body = (await readBody(req as never)) as Obj | null;
    if (!body) return badRequest(res, "Bad body");
    const action = String(body.action ?? "");
    const cookies = parseCookies(req.headers.cookie ?? null);
    const token = cookies[ADMIN_COOKIE];

    /* ---------- unauthenticated: login ---------- */
    if (action === "login") {
      if (!rateLimit(`admin-login:${ip}`, 8)) return tooMany(res);
      const v = parse(z.object({ username: usernameSchema, password: z.string().min(1).max(128) }), body);
      if (!v.ok) return badRequest(res, v.error);
      const key = `admin:${v.data.username.toLowerCase()}`;
      if (await authLocked(key, 8, 15)) return tooMany(res);
      const rows = await sql`SELECT id, username, pass_hash, must_change_password FROM users
        WHERE username = ${v.data.username} AND is_admin = true LIMIT 1`;
      const row = rows.rows[0];
      const okPass = row ? await verifyPassword(String(row.pass_hash), v.data.password) : await dummyVerify(v.data.password);
      if (!row || !okPass) {
        await recordAuthFail(key);
        return fail(res, 401, "Wrong credentials");
      }
      await clearAuthFails(key);
      const { token: at, csrf } = await createSession(String(row.id), { kind: "admin" });
      res.setHeader("Set-Cookie", [adminCookie(at), csrfCookieHeader(csrf, 8 * 3600)]);
      await audit({ id: String(row.id), username: String(row.username) }, "admin.login", null, null, ip);
      return ok(res, { ok: true, username: String(row.username), mustChangePassword: !!row.must_change_password });
    }

    /* ---------- authenticated ---------- */
    const admin = await adminByToken(token);
    if (!admin) return unauthorized(res, "Admin login required");
    if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");

    const gate = await sql`SELECT must_change_password FROM users WHERE id = ${admin.user.id} LIMIT 1`;
    const mustChange = !!gate.rows[0]?.must_change_password;
    const stepUpOk = async (): Promise<boolean> => !!token && (await steppedRecently(token));

    if (action === "logout") {
      await destroySession(token!);
      res.setHeader("Set-Cookie", clearAdminCookieHeader());
      await audit(admin.user, "admin.logout", null, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "changePassword") {
      const v = parse(z.object({ current: z.string().min(1).max(128), next: passwordSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const r = await sql`SELECT pass_hash FROM users WHERE id = ${admin.user.id} LIMIT 1`;
      if (!(await verifyPassword(String(r.rows[0]?.pass_hash ?? ""), v.data.current))) return fail(res, 401, "Wrong password");
      await sql`UPDATE users SET pass_hash = ${await hashPassword(v.data.next)}, must_change_password = false WHERE id = ${admin.user.id}`;
      await destroyUserSessions(admin.user.id); // revoke other sessions; keep the current admin one
      await audit(admin.user, "admin.change_password", admin.user.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "stepUp") {
      const v = parse(z.object({ password: z.string().min(1).max(128) }), body);
      if (!v.ok) return badRequest(res, v.error);
      const r = await sql`SELECT pass_hash FROM users WHERE id = ${admin.user.id} LIMIT 1`;
      if (!(await verifyPassword(String(r.rows[0]?.pass_hash ?? ""), v.data.password))) return fail(res, 401, "Wrong password");
      await markStepUp(token!);
      return ok(res, { ok: true });
    }

    if (action === "me") return ok(res, { ok: true, admin: admin.user, mustChangePassword: mustChange });

    // force the first-login password change before anything else
    if (mustChange) return forbidden(res, "Change your password before continuing");

    /* ---------- reads ---------- */
    if (action === "stats") {
      const r = await sql`SELECT
        (SELECT count(*) FROM users)::int AS users,
        (SELECT count(*) FROM users WHERE is_admin)::int AS admins,
        (SELECT count(*) FROM classes)::int AS classes,
        (SELECT count(*) FROM quizzes)::int AS quizzes,
        (SELECT count(*) FROM results)::int AS results,
        (SELECT count(*) FROM sessions WHERE expires > now())::int AS sessions`;
      return ok(res, { ok: true, stats: r.rows[0] });
    }

    if (action === "users.list") {
      const v = parse(z.object({ query: z.string().trim().max(64).optional(), limit: limitSchema, offset: offsetSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const q = `%${v.data.query ?? ""}%`;
      const rows = await sql`
        SELECT u.id, u.username, u.email, u.created, u.is_admin,
          (SELECT count(*) FROM members m WHERE m.user_id = u.id)::int AS classes,
          (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires > now())::int AS sessions
        FROM users u
        WHERE u.username ILIKE ${q} OR coalesce(u.email,'') ILIKE ${q}
        ORDER BY u.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`;
      return ok(res, { ok: true, users: rows.rows });
    }

    if (action === "users.get") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const u = await sql`SELECT id, username, email, created, is_admin FROM users WHERE id = ${v.data.id} LIMIT 1`;
      if (!u.rows[0]) return notFound(res, "User not found");
      const cls = await sql`
        SELECT c.id, c.name, c.code, m.role FROM members m JOIN classes c ON c.id = m.class_id
        WHERE m.user_id = ${v.data.id} ORDER BY m.joined DESC`;
      const sess = await sql`SELECT token_hash, kind, created, expires FROM sessions
        WHERE user_id = ${v.data.id} AND expires > now() ORDER BY created DESC`;
      return ok(res, { ok: true, user: u.rows[0], classes: cls.rows, sessions: sess.rows.map((s) => ({
        id: String(s.token_hash).slice(0, 12) + "…", kind: s.kind, created: s.created, expires: s.expires,
      })) });
    }

    if (action === "classes.list") {
      const v = parse(z.object({ limit: limitSchema, offset: offsetSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const rows = await sql`
        SELECT c.id, c.name, c.code, c.created, u.username AS owner,
          (SELECT count(*) FROM members m WHERE m.class_id = c.id)::int AS members,
          (SELECT count(*) FROM quizzes q WHERE q.class_id = c.id)::int AS quizzes
        FROM classes c JOIN users u ON u.id = c.owner_id
        ORDER BY c.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`;
      return ok(res, { ok: true, classes: rows.rows });
    }

    if (action === "classes.get") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const c = await sql`SELECT c.id, c.name, c.code, c.owner_id, c.created, u.username AS owner
        FROM classes c JOIN users u ON u.id = c.owner_id WHERE c.id = ${v.data.id} LIMIT 1`;
      if (!c.rows[0]) return notFound(res, "Class not found");
      const members = await sql`SELECT u.id, u.username, m.role, m.joined
        FROM members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ${v.data.id} ORDER BY m.joined`;
      const quizzes = await sql`SELECT id, title, author_id, created FROM quizzes WHERE class_id = ${v.data.id} ORDER BY created DESC`;
      return ok(res, { ok: true, cls: c.rows[0], members: members.rows, quizzes: quizzes.rows });
    }

    if (action === "quizzes.list") {
      const v = parse(z.object({ classId: idSchema.optional(), limit: limitSchema, offset: offsetSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const rows = v.data.classId
        ? await sql`SELECT q.id, q.title, q.class_id, q.author_id, u.username AS author, q.created
            FROM quizzes q JOIN users u ON u.id = q.author_id WHERE q.class_id = ${v.data.classId}
            ORDER BY q.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`
        : await sql`SELECT q.id, q.title, q.class_id, q.author_id, u.username AS author, q.created
            FROM quizzes q JOIN users u ON u.id = q.author_id
            ORDER BY q.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`;
      return ok(res, { ok: true, quizzes: rows.rows });
    }

    if (action === "results.list") {
      const v = parse(z.object({ classId: idSchema.optional(), limit: limitSchema, offset: offsetSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const rows = v.data.classId
        ? await sql`SELECT r.id, r.quiz_title, r.quiz_id, r.points, r.max_points, r.rank, r.correct, r.total, r.created, u.username, r.class_id
            FROM results r JOIN users u ON u.id = r.user_id WHERE r.class_id = ${v.data.classId}
            ORDER BY r.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`
        : await sql`SELECT r.id, r.quiz_title, r.quiz_id, r.points, r.max_points, r.rank, r.correct, r.total, r.created, u.username, r.class_id
            FROM results r JOIN users u ON u.id = r.user_id
            ORDER BY r.created DESC LIMIT ${v.data.limit ?? 50} OFFSET ${v.data.offset ?? 0}`;
      return ok(res, { ok: true, results: rows.rows });
    }

    if (action === "sessions.list") {
      const v = parse(z.object({ userId: idSchema.optional(), limit: limitSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const rows = v.data.userId
        ? await sql`SELECT s.token_hash, s.user_id, s.kind, s.created, s.expires, u.username FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.user_id = ${v.data.userId} AND s.expires > now() ORDER BY s.created DESC LIMIT ${v.data.limit ?? 100}`
        : await sql`SELECT s.token_hash, s.user_id, s.kind, s.created, s.expires, u.username FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.expires > now() ORDER BY s.created DESC LIMIT ${v.data.limit ?? 100}`;
      return ok(res, { ok: true, sessions: rows.rows.map((s) => ({ id: String(s.token_hash).slice(0, 12) + "…", user_id: s.user_id, kind: s.kind, username: s.username, created: s.created, expires: s.expires })) });
    }

    if (action === "audit.list") {
      const v = parse(z.object({ limit: limitSchema, offset: offsetSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const rows = await sql`SELECT id, actor, action, target, detail, ip, created FROM admin_audit
        ORDER BY created DESC LIMIT ${v.data.limit ?? 100} OFFSET ${v.data.offset ?? 0}`;
      return ok(res, { ok: true, audit: rows.rows });
    }

    /* ---------- destructive (step-up required) ---------- */
    const destructive = new Set([
      "users.delete", "users.setAdmin", "users.resetPassword", "users.setPassword", "users.revokeSessions",
      "classes.delete", "classes.transfer", "classes.removeMember",
      "quizzes.delete", "results.delete", "results.clear", "sessions.revoke", "impersonate.start",
    ]);
    if (destructive.has(action) && !(await stepUpOk())) {
      return forbidden(res, "Re-enter your password to continue");
    }

    if (action === "users.update") {
      const v = parse(z.object({ id: idSchema, username: usernameSchema.optional(), email: emailOpt }), body);
      if (!v.ok) return badRequest(res, v.error);
      if (v.data.username !== undefined) {
        const dup = await sql`SELECT 1 FROM users WHERE username = ${v.data.username} AND id <> ${v.data.id} LIMIT 1`;
        if (dup.rows.length) return fail(res, 409, "Username already taken");
        await sql`UPDATE users SET username = ${v.data.username} WHERE id = ${v.data.id}`;
      }
      if (v.data.email !== undefined) {
        await sql`UPDATE users SET email = ${v.data.email ?? null} WHERE id = ${v.data.id}`;
      }
      await audit(admin.user, "users.update", v.data.id, { username: v.data.username, email: v.data.email }, ip);
      return ok(res, { ok: true });
    }

    if (action === "users.resetPassword") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const temp = randomToken().slice(0, 14);
      await sql`UPDATE users SET pass_hash = ${await hashPassword(temp)}, must_change_password = true WHERE id = ${v.data.id}`;
      await destroyUserSessions(v.data.id);
      await audit(admin.user, "users.reset_password", v.data.id, null, ip);
      return ok(res, { ok: true, temporaryPassword: temp });
    }

    if (action === "users.setPassword") {
      const v = parse(z.object({ id: idSchema, password: passwordSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      await sql`UPDATE users SET pass_hash = ${await hashPassword(v.data.password)}, must_change_password = false WHERE id = ${v.data.id}`;
      await destroyUserSessions(v.data.id);
      await audit(admin.user, "users.set_password", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "users.revokeSessions") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      await sql`DELETE FROM sessions WHERE user_id = ${v.data.id}`;
      await audit(admin.user, "users.revoke_sessions", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "users.setAdmin") {
      const v = parse(z.object({ id: idSchema, isAdmin: z.boolean() }), body);
      if (!v.ok) return badRequest(res, v.error);
      if (v.data.id === admin.user.id && !v.data.isAdmin) return forbidden(res, "You cannot remove your own admin access");
      const cnt = await sql`SELECT count(*)::int AS n FROM users WHERE is_admin`;
      const target = await sql`SELECT is_admin FROM users WHERE id = ${v.data.id} LIMIT 1`;
      if (!target.rows[0]) return notFound(res, "User not found");
      if (target.rows[0].is_admin && !v.data.isAdmin && Number(cnt.rows[0].n) <= 1) return forbidden(res, "Cannot remove the last admin");
      await sql`UPDATE users SET is_admin = ${v.data.isAdmin} WHERE id = ${v.data.id}`;
      await audit(admin.user, v.data.isAdmin ? "users.grant_admin" : "users.revoke_admin", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "users.delete") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      if (v.data.id === admin.user.id) return forbidden(res, "You cannot delete your own account here");
      const target = await sql`SELECT username, is_admin FROM users WHERE id = ${v.data.id} LIMIT 1`;
      if (!target.rows[0]) return notFound(res, "User not found");
      if (target.rows[0].is_admin) {
        const cnt = await sql`SELECT count(*)::int AS n FROM users WHERE is_admin`;
        if (Number(cnt.rows[0].n) <= 1) return forbidden(res, "Cannot delete the last admin");
      }
      await sql`DELETE FROM users WHERE id = ${v.data.id}`;
      await audit(admin.user, "users.delete", v.data.id, { username: target.rows[0].username }, ip);
      return ok(res, { ok: true });
    }

    if (action === "classes.removeMember") {
      const v = parse(z.object({ classId: idSchema, userId: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const c = await sql`SELECT owner_id FROM classes WHERE id = ${v.data.classId} LIMIT 1`;
      if (!c.rows[0]) return notFound(res, "Class not found");
      if (String(c.rows[0].owner_id) === v.data.userId) return forbidden(res, "Transfer ownership before removing the owner");
      const d = await sql`DELETE FROM members WHERE class_id = ${v.data.classId} AND user_id = ${v.data.userId}`;
      if (d.rowCount === 0) return notFound(res, "Not a member");
      await audit(admin.user, "classes.remove_member", v.data.classId, { userId: v.data.userId }, ip);
      return ok(res, { ok: true });
    }

    if (action === "classes.transfer") {
      const v = parse(z.object({ classId: idSchema, userId: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const u = await sql`SELECT 1 FROM users WHERE id = ${v.data.userId} LIMIT 1`;
      if (!u.rows.length) return notFound(res, "User not found");
      await sql`INSERT INTO members (class_id, user_id, role) VALUES (${v.data.classId}, ${v.data.userId}, 'teacher')
        ON CONFLICT (class_id, user_id) DO UPDATE SET role = 'teacher'`;
      await sql`UPDATE classes SET owner_id = ${v.data.userId} WHERE id = ${v.data.classId}`;
      await audit(admin.user, "classes.transfer", v.data.classId, { to: v.data.userId }, ip);
      return ok(res, { ok: true });
    }

    if (action === "classes.delete") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const d = await sql`DELETE FROM classes WHERE id = ${v.data.id}`;
      if (d.rowCount === 0) return notFound(res, "Class not found");
      await audit(admin.user, "classes.delete", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "quizzes.delete") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const d = await sql`DELETE FROM quizzes WHERE id = ${v.data.id}`;
      if (d.rowCount === 0) return notFound(res, "Quiz not found");
      await audit(admin.user, "quizzes.delete", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "results.delete") {
      const v = parse(z.object({ id: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      await sql`DELETE FROM results WHERE id = ${v.data.id}`;
      await audit(admin.user, "results.delete", v.data.id, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "results.clear") {
      const v = parse(z.object({ classId: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const d = await sql`DELETE FROM results WHERE class_id = ${v.data.classId}`;
      await audit(admin.user, "results.clear", v.data.classId, { deleted: d.rowCount }, ip);
      return ok(res, { ok: true });
    }

    if (action === "sessions.revoke") {
      const v = parse(z.object({ userId: idSchema.optional(), tokenPrefix: z.string().min(8).max(64).optional() }), body);
      if (!v.ok) return badRequest(res, v.error);
      if (v.data.userId) {
        await sql`DELETE FROM sessions WHERE user_id = ${v.data.userId}`;
        await audit(admin.user, "sessions.revoke_user", v.data.userId, null, ip);
        return ok(res, { ok: true });
      }
      if (v.data.tokenPrefix) {
        await sql`DELETE FROM sessions WHERE token_hash LIKE ${v.data.tokenPrefix.replace(/…/g, "") + "%"}`;
        await audit(admin.user, "sessions.revoke_token", v.data.tokenPrefix, null, ip);
        return ok(res, { ok: true });
      }
      return badRequest(res, "userId or tokenPrefix required");
    }

    /* ---------- impersonation ---------- */
    if (action === "impersonate.start") {
      const v = parse(z.object({ userId: idSchema }), body);
      if (!v.ok) return badRequest(res, v.error);
      const u = await sql`SELECT id, is_admin FROM users WHERE id = ${v.data.userId} LIMIT 1`;
      if (!u.rows[0]) return notFound(res, "User not found");
      if (u.rows[0].is_admin) return forbidden(res, "Cannot impersonate another admin");
      const { token: userToken } = await createSession(v.data.userId, { kind: "impersonation", impersonatorId: admin.user.id });
      // replace only the user session cookie; keep the admin + csrf cookies intact
      res.setHeader("Set-Cookie", [
        `p5q_session=${encodeURIComponent(userToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` +
          (process.env.VERCEL === "1" || process.env.SECURE_COOKIES === "1" ? "; Secure" : ""),
      ]);
      await audit(admin.user, "impersonate.start", v.data.userId, null, ip);
      return ok(res, { ok: true });
    }

    if (action === "impersonate.stop") {
      const sess = cookies.p5q_session;
      if (sess) await destroySession(sess);
      res.setHeader("Set-Cookie", [`p5q_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`]);
      await audit(admin.user, "impersonate.stop", null, null, ip);
      return ok(res, { ok: true });
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}