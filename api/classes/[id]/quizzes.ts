/* /api/classes/[id]/quizzes — GET list · POST save (any member) · DELETE (teacher only) */
import type { ApiRequest, ApiResponse } from "../../_lib/types.js";
import { sql } from "../../_lib/db.js";
import { ensureSchema } from "../../_lib/db.js";
import { getUserByToken, parseCookies, csrfValid, membership, newId } from "../../_lib/auth.js";
import { classIdSchema, quizTitleSchema, quizDataSchema, parse } from "../../_lib/validate.js";
import { ok, unauthorized, forbidden, notFound, badRequest, fail, tooMany, readBody, clientIp, rateLimit, serverError } from "../../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    await ensureSchema();
    const cookies = parseCookies(req.headers.cookie ?? null);
    const user = await getUserByToken(cookies["p5q_session"]);
    if (!user) return unauthorized(res);
    const id = parse(classIdSchema, req.query?.id);
    if (!id.ok) return badRequest(res, id.error);
    const mem = await membership(user.id, id.data);
    if (!mem) return forbidden(res);

    if (req.method === "GET") {
      /* ?qid=… → one full quiz (this used to be /classes/[id]/quiz/[qid]) */
      if (req.query?.qid) {
        const qid = parse(classIdSchema, req.query?.qid);
        if (!qid.ok) return badRequest(res, qid.error);
        const one = await sql`SELECT title, data FROM quizzes WHERE id = ${qid.data} AND class_id = ${id.data} LIMIT 1`;
        if (one.rows.length === 0) return notFound(res, "Quiz not found");
        return ok(res, { ok: true, title: String(one.rows[0].title), quiz: one.rows[0].data as Record<string, unknown> });
      }
      const rows = await sql`
        SELECT q.id, q.title, q.author_id, u.username AS author, q.created
        FROM quizzes q JOIN users u ON u.id = q.author_id
        WHERE q.class_id = ${id.data}
        ORDER BY q.created DESC LIMIT 100`;
      return ok(res, {
        ok: true,
        quizzes: rows.rows.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          author: String(r.author),
          created: r.created,
        })),
      });
    }

    if (req.method === "POST") {
      if (!rateLimit(clientIp(req.headers as never), 20)) return tooMany(res);
      if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
      const body = await readBody(req as never);
      const t = parse(quizTitleSchema, (body as Record<string, unknown>)?.title);
      if (!t.ok) return badRequest(res, t.error);
      const d = parse(quizDataSchema, (body as Record<string, unknown>)?.quiz);
      if (!d.ok) return badRequest(res, d.error);
      // hard cap on stored quiz size
      if (JSON.stringify(d.data).length > 300_000) return badRequest(res, "Quiz too large (300KB max)");
      const qid = newId();
      await sql`INSERT INTO quizzes (id, class_id, author_id, title, data) VALUES (${qid}, ${id.data}, ${user.id}, ${t.data}, ${JSON.stringify(d.data)})`;
      return ok(res, { ok: true, id: qid });
    }

    if (req.method === "DELETE") {
      if (mem.role !== "teacher") return forbidden(res, "Only the teacher can delete quizzes");
      if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
      const qid = parse(classIdSchema, req.query?.qid);
      if (!qid.ok) return badRequest(res, qid.error);
      const del = await sql`DELETE FROM quizzes WHERE id = ${qid.data} AND class_id = ${id.data}`;
      if (del.rowCount === 0) return notFound(res, "Quiz not found");
      return ok(res);
    }

    return fail(res, 405, "GET/POST/DELETE only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
