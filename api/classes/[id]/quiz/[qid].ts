/* GET /api/classes/[id]/quiz/[qid] — full quiz JSON (members only) */
import type { ApiRequest, ApiResponse } from "../../../_lib/types";
import { sql } from "../../../_lib/db";
import { ensureSchema } from "../../../_lib/db";
import { getUserByToken, parseCookies, membership } from "../../../_lib/auth";
import { classIdSchema, parse } from "../../../_lib/validate";
import { ok, unauthorized, forbidden, notFound, badRequest, serverError } from "../../../_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return unauthorized(res);
  try {
    await ensureSchema();
    const user = await getUserByToken(parseCookies(req.headers.cookie ?? null)["p5q_session"]);
    if (!user) return unauthorized(res);
    const id = parse(classIdSchema, req.query?.id);
    if (!id.ok) return badRequest(res, id.error);
    const mem = await membership(user.id, id.data);
    if (!mem) return forbidden(res);
    const qid = parse(classIdSchema, req.query?.qid);
    if (!qid.ok) return badRequest(res, qid.error);

    const rows = await sql`SELECT title, data FROM quizzes WHERE id = ${qid.data} AND class_id = ${id.data} LIMIT 1`;
    if (rows.rows.length === 0) return notFound(res, "Quiz not found");
    return ok(res, { ok: true, title: String(rows.rows[0].title), quiz: rows.rows[0].data as Record<string, unknown> });
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
