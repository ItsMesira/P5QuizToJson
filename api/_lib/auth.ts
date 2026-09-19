/* ============ P5 QUIZ API — AUTH: argon2id, session tokens, cookies, CSRF ============ */
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "./db.js";

const SESSION_DAYS = 7; // user sessions (tightened from 30)
const ADMIN_HOURS = 8; // admin sessions
const STEP_UP_MINUTES = 30; // destructive admin actions
const COOKIE = "p5q_session";
const ADMIN_COOKIE = "p5q_admin";
const CSRF_COOKIE = "p5q_csrf";

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  impersonated?: boolean;
}

export interface SessionInfo {
  user: SessionUser;
  cls: {
    id: string;
    name: string;
    code: string;
    role: "teacher" | "student";
  } | null;
}

/* ---------- helpers ---------- */

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function secureCookies(): boolean {
  // Only flag cookies Secure when the app actually runs over TLS.
  return process.env.VERCEL === "1" || process.env.SECURE_COOKIES === "1";
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        /* malformed percent-encoding — ignore this pair */
      }
    }
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAge: number): string {
  const secure = secureCookies() ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(token: string): string {
  return cookieHeader(COOKIE, token, SESSION_DAYS * 24 * 60 * 60);
}

export function adminCookie(token: string): string {
  return cookieHeader(ADMIN_COOKIE, token, ADMIN_HOURS * 60 * 60);
}

export function csrfCookieHeader(value: string, maxAge: number): string {
  // CSRF token cookie is intentionally NOT HttpOnly — the SPA must read it.
  const secure = secureCookies() ? "; Secure" : "";
  return `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookieHeaders(): string[] {
  const secure = secureCookies() ? "; Secure" : "";
  return [
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  ];
}

export function clearAdminCookieHeader(): string {
  const secure = secureCookies() ? "; Secure" : "";
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/* ---------- passwords ---------- */

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(passHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passHash, password);
  } catch {
    return false;
  }
}

/* Equalize login timing so a missing user is indistinguishable from a wrong
   password (prevents username enumeration by timing). */
let dummyHash: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<false> {
  if (!dummyHash) dummyHash = hash("p5q-timing-equalizer", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await verifyPassword(await dummyHash, password);
  return false;
}

/* ---------- brute-force lockout (DB-backed, survives warm instances) ---------- */

export async function recordAuthFail(key: string): Promise<void> {
  await sql`INSERT INTO auth_attempts (key, fails, last) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET fails = auth_attempts.fails + 1, last = now()`;
}

export async function clearAuthFails(key: string): Promise<void> {
  await sql`DELETE FROM auth_attempts WHERE key = ${key}`;
}

export async function authLocked(key: string, max = 8, windowMinutes = 15): Promise<boolean> {
  const r = await sql`SELECT fails, last FROM auth_attempts WHERE key = ${key}`;
  const row = r.rows[0];
  if (!row) return false;
  if (Date.now() - new Date(String(row.last)).getTime() > windowMinutes * 60_000) return false;
  return Number(row.fails) >= max;
}

/* ---------- sessions ---------- */

export type SessionKind = "user" | "admin" | "impersonation";

export async function createSession(
  userId: string,
  opts: { kind?: SessionKind; impersonatorId?: string | null } = {},
): Promise<{ token: string; csrf: string }> {
  const token = randomToken();
  const csrf = randomToken();
  const kind = opts.kind ?? "user";
  const ttlMs = kind === "admin" ? ADMIN_HOURS * 60 * 60 * 1000 : SESSION_DAYS * 24 * 60 * 60 * 1000;
  const expires = new Date(Date.now() + ttlMs);
  await sql`INSERT INTO sessions (token_hash, user_id, expires, kind, impersonator_id)
    VALUES (${sha256hex(token)}, ${userId}, ${expires}, ${kind}, ${opts.impersonatorId ?? null})`;
  return { token, csrf };
}

export async function destroySession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${sha256hex(token)}`;
}

export async function destroyUserSessions(userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND kind = 'user'`;
}

/* Kill every session of a user regardless of kind (user/admin/impersonation).
   Used when an admin resets someone's password. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

/* Kill every session of a user except the caller's current one. Used on
   self password change so other logged-in devices are logged out. */
export async function destroyOtherSessions(userId: string, keepToken: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND token_hash <> ${sha256hex(keepToken)}`;
}

/* normal user / impersonation sessions (admin uses adminByToken) */
export async function getUserByToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.username, u.email, s.kind
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256hex(token)}
      AND s.expires > now()
      AND s.kind IN ('user', 'impersonation')
    LIMIT 1`;
  const r = rows.rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    username: String(r.username),
    email: r.email ? String(r.email) : null,
    impersonated: String(r.kind) === "impersonation",
  };
}

export interface AdminSession {
  user: SessionUser;
  impersonatorId: string | null;
  steppedAt: Date | null;
}

export async function adminByToken(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.username, u.email, s.impersonator_id, s.stepped_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256hex(token)}
      AND s.expires > now()
      AND s.kind = 'admin'
      AND u.is_admin = true
    LIMIT 1`;
  const r = rows.rows[0];
  if (!r) return null;
  return {
    user: { id: String(r.id), username: String(r.username), email: r.email ? String(r.email) : null },
    impersonatorId: r.impersonator_id ? String(r.impersonator_id) : null,
    steppedAt: r.stepped_at ? new Date(String(r.stepped_at)) : null,
  };
}

export async function markStepUp(token: string): Promise<void> {
  await sql`UPDATE sessions SET stepped_at = now() WHERE token_hash = ${sha256hex(token)}`;
}

export async function steppedRecently(token: string, minutes = STEP_UP_MINUTES): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM sessions
    WHERE token_hash = ${sha256hex(token)}
      AND stepped_at IS NOT NULL
      AND stepped_at > now() - make_interval(mins => ${minutes})
    LIMIT 1`;
  return rows.rows.length > 0;
}

export { STEP_UP_MINUTES, SESSION_DAYS, ADMIN_COOKIE, COOKIE, CSRF_COOKIE };

/* ---------- CSRF ---------- */

export function csrfValid(reqHeaders: Record<string, string | undefined>, cookieHeaderRaw: string | null): boolean {
  const headerToken = reqHeaders["x-csrf-token"];
  const cookieToken = parseCookies(cookieHeaderRaw)[CSRF_COOKIE];
  if (!headerToken || !cookieToken) return false;
  const a = Buffer.from(String(headerToken));
  const b = Buffer.from(String(cookieToken));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ---------- session + class info ---------- */

export async function sessionInfo(token: string | undefined): Promise<SessionInfo | null> {
  const user = await getUserByToken(token);
  if (!user) return null;
  const cls = await sql`
    SELECT c.id, c.name, c.code, m.role
    FROM members m JOIN classes c ON c.id = m.class_id
    WHERE m.user_id = ${user.id}
    ORDER BY m.joined DESC
    LIMIT 1`;
  const c = cls.rows[0];
  return {
    user,
    cls: c
      ? { id: String(c.id), name: String(c.name), code: String(c.code), role: String(c.role) as "teacher" | "student" }
      : null,
  };
}

/* ---------- class helpers ---------- */

export function newId(): string {
  return randomUUID();
}

export function newClassCode(): string {
  // 8-char unambiguous code (32 alphabet → ~1.1e12 combinations)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export async function classExists(code: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM classes WHERE code = ${code.toUpperCase()} LIMIT 1`;
  return rows.rows.length > 0;
}

export async function membership(userId: string, classId: string): Promise<{ role: string } | null> {
  const rows = await sql`SELECT role FROM members WHERE class_id = ${classId} AND user_id = ${userId} LIMIT 1`;
  return rows.rows[0] ? { role: String(rows.rows[0].role) } : null;
}

/* ---------- admin audit ---------- */

export async function audit(
  actor: { id: string; username: string },
  action: string,
  target: string | null,
  detail: unknown,
  ip: string,
): Promise<void> {
  try {
    await sql`INSERT INTO admin_audit (id, actor_id, actor, action, target, detail, ip)
      VALUES (${randomUUID()}, ${actor.id}, ${actor.username}, ${action}, ${target}, ${detail ? JSON.stringify(detail) : null}, ${ip})`;
  } catch (err) {
    console.error("[p5q] audit write failed:", (err as Error).message);
  }
}

export { sha256hex };