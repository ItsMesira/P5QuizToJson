/* GET /api/classes/[id] — class info + members (membership required) */
import type { ApiRequest, ApiResponse } from "../../_lib/types.js";
import { sql } from "../../_lib/db.js";
import { ensureSchema } from "../../_lib/db.js";
import { getUserByToken, parseCookies, membership } from "../../_lib/auth.js";
import { classIdSchema, parse } from "../../_lib/validate.js";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "../../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return unauthorized(res);
  try {
    await ensureSchema();
    const user = await getUserByToken(parseCookies(req.headers.cookie ?? null)["p5q_session"]);
    if (!user) return unauthorized(res);
    const id = parse(classIdSchema, req.query?.id);
    if (!id.ok) return badRequest(res, id.error);

    const cls = await sql`SELECT id, name, code, owner_id FROM classes WHERE id = ${id.data} LIMIT 1`;
    if (cls.rows.length === 0) return notFound(res, "Class not found");
    const mem = await membership(user.id, id.data);
    if (!mem) return forbidden(res);

    const members = await sql`
      SELECT u.username, m.role, m.joined
      FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.class_id = ${id.data}
      ORDER BY m.joined ASC`;
    return ok(res, {
      ok: true,
      cls: {
        id: String(cls.rows[0].id),
        name: String(cls.rows[0].name),
        code: String(cls.rows[0].code),
        owner: String(cls.rows[0].owner_id) === user.id,
        myRole: mem.role,
      },
      members: members.rows.map((m) => ({ username: String(m.username), role: String(m.role) })),
    });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
