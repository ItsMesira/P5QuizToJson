/* POST /api/classes/join — join a class by code */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "../_lib/db";
import { getUserByToken, parseCookies, csrfValid } from "../_lib/auth";
import { classCodeSchema, parse } from "../_lib/validate";
import { badRequest, ok, fail, tooMany, unauthorized, readBody, clientIp, rateLimit, serverError } from "../_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  if (!rateLimit(clientIp(req.headers as never), 20)) return tooMany(res);
  try {
    await ensureSchema();
    const cookies = parseCookies(req.headers.cookie ?? null);
    const user = await getUserByToken(cookies["p5q_session"]);
    if (!user) return unauthorized(res);
    if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");

    const body = await readBody(req as never);
    const c = parse(classCodeSchema, (body as Record<string, unknown>)?.code);
    if (!c.ok) return badRequest(res, c.error);

    const cls = await sql`SELECT id, name, code FROM classes WHERE code = ${c.data} LIMIT 1`;
    if (cls.rows.length === 0) return fail(res, 404, "No class with that code");

    const id = String(cls.rows[0].id);
    await sql`INSERT INTO members (class_id, user_id, role) VALUES (${id}, ${user.id}, 'student') ON CONFLICT DO NOTHING`;
    return ok(res, { ok: true, cls: { id, name: String(cls.rows[0].name), code: String(cls.rows[0].code), role: "student" } });
  } catch {
    return serverError(res);
  }
}
