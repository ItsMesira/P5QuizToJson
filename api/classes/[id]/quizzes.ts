/* /api/classes/[id]/quizzes — GET list (q/sort/page/limit) · POST save (any member)
   · PATCH pin (teacher only) · DELETE (teacher only) */
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
      const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? String(v[0] ?? "") : v === undefined ? "" : String(v));
      const q = first(req.query?.q).trim().slice(0, 64);
      const pinnedRaw = first(req.query?.pinned);
      const pinnedOnly = pinnedRaw === "1" || pinnedRaw === "true";
      const sortRaw = first(req.query?.sort);
      const sort = sortRaw === "title" || sortRaw === "played" ? sortRaw : "newest";
      const pageNum = Math.floor(Number(first(req.query?.page) || "1"));
      const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
      const limitNum = Math.floor(Number(first(req.query?.limit) || "24"));
      const limit = Number.isFinite(limitNum) ? Math.min(60, Math.max(1, limitNum)) : 24;
      const offset = (page - 1) * limit;
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

      const counted = await sql`
        SELECT count(*)::int AS n
        FROM quizzes q JOIN users u ON u.id = q.author_id
        WHERE q.class_id = ${id.data}
          AND (${q} = '' OR q.title ILIKE ${like} OR u.username ILIKE ${like})
          AND (${pinnedOnly} = false OR q.pinned)`;
      const total = Number(counted.rows[0]?.n ?? 0);

      const rows = sort === "title"
        ? await sql`
            SELECT q.id, q.title, u.username AS author, q.created, q.pinned,
              (SELECT count(*) FROM results r WHERE r.quiz_id = q.id) AS plays
            FROM quizzes q JOIN users u ON u.id = q.author_id
            WHERE q.class_id = ${id.data}
              AND (${q} = '' OR q.title ILIKE ${like} OR u.username ILIKE ${like})
              AND (${pinnedOnly} = false OR q.pinned)
            ORDER BY lower(q.title) ASC, q.created DESC
            LIMIT ${limit} OFFSET ${offset}`
        : sort === "played"
          ? await sql`
              SELECT q.id, q.title, u.username AS author, q.created, q.pinned,
                (SELECT count(*) FROM results r WHERE r.quiz_id = q.id) AS plays
              FROM quizzes q JOIN users u ON u.id = q.author_id
              WHERE q.class_id = ${id.data}
                AND (${q} = '' OR q.title ILIKE ${like} OR u.username ILIKE ${like})
              AND (${pinnedOnly} = false OR q.pinned)
              ORDER BY plays DESC, q.created DESC
              LIMIT ${limit} OFFSET ${offset}`
          : await sql`
              SELECT q.id, q.title, u.username AS author, q.created, q.pinned,
                (SELECT count(*) FROM results r WHERE r.quiz_id = q.id) AS plays
              FROM quizzes q JOIN users u ON u.id = q.author_id
              WHERE q.class_id = ${id.data}
                AND (${q} = '' OR q.title ILIKE ${like} OR u.username ILIKE ${like})
              AND (${pinnedOnly} = false OR q.pinned)
              ORDER BY q.created DESC
              LIMIT ${limit} OFFSET ${offset}`;

      return ok(res, {
        ok: true,
        quizzes: rows.rows.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          author: String(r.author),
          created: r.created,
          pinned: Boolean(r.pinned),
          plays: Number(r.plays),
        })),
        total,
        page,
        pages: Math.ceil(total / limit),
      });
    }

    if (req.method === "PATCH") {
      if (mem.role !== "teacher") return forbidden(res, "Only the teacher can pin quizzes");
      if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
      const body = await readBody(req as never);
      const qid = parse(classIdSchema, (body as Record<string, unknown>)?.id);
      if (!qid.ok) return badRequest(res, qid.error);
      const pinned = (body as Record<string, unknown>)?.pinned;
      if (typeof pinned !== "boolean") return badRequest(res, "pinned must be a boolean");
      const upd = await sql`UPDATE quizzes SET pinned = ${pinned} WHERE id = ${qid.data} AND class_id = ${id.data}`;
      if (upd.rowCount === 0) return notFound(res, "Quiz not found");
      return ok(res, { ok: true, id: qid.data, pinned });
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

    return fail(res, 405, "GET/POST/PATCH/DELETE only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
