/* /api/classes/[id]/results — GET class leaderboard · POST submit result (members) */
import type { ApiRequest, ApiResponse } from "../../_lib/types.js";
import { sql } from "../../_lib/db.js";
import { ensureSchema } from "../../_lib/db.js";
import { getUserByToken, parseCookies, csrfValid, membership, newId } from "../../_lib/auth.js";
import { classIdSchema, resultSubmitSchema, parse } from "../../_lib/validate.js";
import { gradeQuiz, type GQuiz } from "../../_lib/grading.js";
import { ok, unauthorized, forbidden, badRequest, fail, tooMany, readBody, clientIp, rateLimit, serverError } from "../../_lib/http.js";

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
      const rows = await sql`
        SELECT u.username, r.quiz_title, r.points, r.max_points, r.rank, r.correct, r.total, r.created
        FROM results r JOIN users u ON u.id = r.user_id
        WHERE r.class_id = ${id.data}
        ORDER BY r.points DESC, r.created DESC
        LIMIT 100`;
      return ok(res, {
        ok: true,
        results: rows.rows.map((r) => ({
          username: String(r.username),
          quizTitle: String(r.quiz_title),
          points: Number(r.points),
          maxPoints: Number(r.max_points),
          rank: String(r.rank),
          correct: Number(r.correct),
          total: Number(r.total),
          created: r.created,
        })),
      });
    }

    if (req.method === "POST") {
      if (!rateLimit(clientIp(req.headers as never), 30)) return tooMany(res);
      if (!csrfValid(req.headers as never, req.headers.cookie ?? null)) return unauthorized(res, "Missing CSRF token");
      const body = await readBody(req as never);
      const r = parse(resultSubmitSchema, body);
      if (!r.ok) return badRequest(res, r.error);

      // the quiz must exist in THIS class; grade from its stored answer key
      const quizRow = await sql`SELECT data FROM quizzes WHERE id = ${r.data.quizId} AND class_id = ${id.data} LIMIT 1`;
      if (!quizRow.rows[0]) return badRequest(res, "Unknown quiz for this class");
      const quiz = quizRow.rows[0].data as GQuiz;
      const flat: { points?: number }[] = [];
      for (const s of quiz.sections ?? []) for (const q of s.questions ?? []) flat.push(q);

      const answers: (string | null)[] = new Array(flat.length).fill(null);
      for (const item of r.data.answers) {
        if (item.q >= 0 && item.q < flat.length) answers[item.q] = item.a;
      }
      const g = gradeQuiz(quiz, answers);
      // every question must be accounted for exactly once (no gaps/dupes)
      if (new Set(r.data.answers.map((x) => x.q)).size !== r.data.answers.length) {
        return badRequest(res, "Duplicate answers");
      }

      await sql`INSERT INTO results (id, class_id, user_id, quiz_title, points, max_points, rank, correct, total, quiz_id, data)
        VALUES (${newId()}, ${id.data}, ${user.id}, ${r.data.quizTitle}, ${g.points}, ${g.maxPoints}, ${g.rank}, ${g.correct}, ${g.total}, ${r.data.quizId}, ${JSON.stringify({ perQuestion: g.perQuestion })}::jsonb)`;
      return ok(res, { ok: true, points: g.points, maxPoints: g.maxPoints, rank: g.rank, correct: g.correct, total: g.total });
    }

    return fail(res, 405, "GET/POST only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
