/* GET /api/classes/mine — every class the user belongs to */
import type { ApiRequest, ApiResponse } from "../_lib/types";
import { sql } from "../_lib/db";
import { ensureSchema } from "../_lib/db";
import { getUserByToken, parseCookies } from "../_lib/auth";
import { ok, unauthorized, serverError } from "../_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return unauthorized(res);
  try {
    await ensureSchema();
    const user = await getUserByToken(parseCookies(req.headers.cookie ?? null)["p5q_session"]);
    if (!user) return unauthorized(res);
    const rows = await sql`
      SELECT c.id, c.name, c.code, m.role,
        (SELECT count(*) FROM members mm WHERE mm.class_id = c.id) AS members
      FROM members m JOIN classes c ON c.id = m.class_id
      WHERE m.user_id = ${user.id}
      ORDER BY m.joined DESC`;
    return ok(res, {
      ok: true,
      classes: rows.rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        code: String(r.code),
        role: String(r.role),
        members: Number(r.members),
      })),
    });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
