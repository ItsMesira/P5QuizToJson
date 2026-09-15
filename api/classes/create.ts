/* POST /api/classes/create — create a class (creator becomes teacher) */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql } from "../_lib/db";
import { ensureSchema } from "../_lib/db";
import { getUserByToken, parseCookies, csrfValid, newId, newClassCode } from "../_lib/auth";
import { classNameSchema, parse } from "../_lib/validate";
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
    const n = parse(classNameSchema, (body as Record<string, unknown>)?.name);
    if (!n.ok) return badRequest(res, n.error);

    const id = newId();
    let code = newClassCode();
    for (let i = 0; i < 5; i++) {
      const dup = await sql`SELECT 1 FROM classes WHERE code = ${code} LIMIT 1`;
      if (dup.rows.length === 0) break;
      code = newClassCode();
    }
    await sql`INSERT INTO classes (id, name, code, owner_id) VALUES (${id}, ${n.data}, ${code}, ${user.id})`;
    await sql`INSERT INTO members (class_id, user_id, role) VALUES (${id}, ${user.id}, 'teacher')`;
    return ok(res, { ok: true, cls: { id, name: n.data, code, role: "teacher" } });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
