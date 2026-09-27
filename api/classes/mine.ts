/* /api/classes/mine — GET every class the user belongs to · POST switch active class */
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { sql } from "../_lib/db.js";
import { ensureSchema } from "../_lib/db.js";
import { getUserByToken, parseCookies, csrfValid, membership } from "../_lib/auth.js";
import { classIdSchema, parse } from "../_lib/validate.js";
import { ok, unauthorized, forbidden, badRequest, fail, readBody, serverError } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    await ensureSchema();
    const user = await getUserByToken(parseCookies(req.headers.cookie ?? null)["p5q_session"]);
    if (!user) return unauthorized(res);

    if (req.method === "GET") {
      const rows = await sql`
        SELECT c.id, c.name, c.code, m.role,
          (SELECT count(*) FROM members mm WHERE mm.class_id = c.id) AS members
        FROM members m JOIN classes c ON c.id = m.class_id
        WHERE m.user_id = ${user.id}
        ORDER BY m.joined DESC`;
      const active = await sql`SELECT active_class_id FROM users WHERE id = ${user.id} LIMIT 1`;
      const wanted = active.rows[0]?.active_class_id ? String(active.rows[0].active_class_id) : null;
      const classes = rows.rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        code: String(r.code),
        role: String(r.role),
        members: Number(r.members),
      }));
      const activeId = wanted && classes.some((c) => c.id === wanted) ? wanted : classes[0]?.id ?? null;
      return ok(res, { ok: true, classes, activeId });
    }

    if (req.method === "POST") {
      if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
      const body = await readBody(req as never);
      const c = parse(classIdSchema, (body as Record<string, unknown>)?.classId);
      if (!c.ok) return badRequest(res, c.error);
      const mem = await membership(user.id, c.data);
      if (!mem) return forbidden(res);
      await sql`UPDATE users SET active_class_id = ${c.data} WHERE id = ${user.id}`;
      return ok(res, { ok: true, activeId: c.data });
    }

    return fail(res, 405, "GET/POST only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
