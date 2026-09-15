/* ============ P5 QUIZ API — AUTH: argon2id, session tokens, cookies, CSRF ============ */
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

const SESSION_DAYS = 30;
const COOKIE = "p5q_session";
const CSRF_COOKIE = "p5q_csrf";

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
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
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAge: number): string {
  const secure = secureCookies() ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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

/* ---------- sessions ---------- */

export async function createSession(userId: string): Promise<{ token: string; csrf: string }> {
  const token = randomToken();
  const csrf = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`INSERT INTO sessions (token_hash, user_id, expires)
    VALUES (${sha256hex(token)}, ${userId}, ${expires})`;
  return { token, csrf };
}

export async function destroySession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${sha256hex(token)}`;
}

export async function getUserByToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await sql`
    SELECT u.id, u.username, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256hex(token)} AND s.expires > now()
    LIMIT 1`;
  const r = rows.rows[0];
  if (!r) return null;
  return { id: String(r.id), username: String(r.username), email: r.email ? String(r.email) : null };
}

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
  // 6-char unambiguous code
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[randomBytes(1)[0] % alphabet.length];
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

export { sha256hex };
