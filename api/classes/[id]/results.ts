/* /api/classes/[id]/results — GET class leaderboard · POST submit result (members) */
import type { ApiRequest, ApiResponse } from "../../_lib/types";
import { sql } from "../../_lib/db";
import { ensureSchema } from "../../_lib/db";
import { getUserByToken, parseCookies, csrfValid, membership, newId } from "../../_lib/auth";
import { classIdSchema, resultSchema, parse } from "../../_lib/validate";
import { ok, unauthorized, forbidden, badRequest, fail, tooMany, readBody, clientIp, rateLimit, serverError } from "../../_lib/http";

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
      const r = parse(resultSchema, body);
      if (!r.ok) return badRequest(res, r.error);
      await sql`INSERT INTO results (id, class_id, user_id, quiz_title, points, max_points, rank, correct, total)
        VALUES (${newId()}, ${id.data}, ${user.id}, ${r.data.quizTitle}, ${r.data.points}, ${r.data.maxPoints}, ${r.data.rank}, ${r.data.correct}, ${r.data.total})`;
      return ok(res);
    }

    return fail(res, 405, "GET/POST only");
  } catch (err) {
    console.error("[p5q]", err);
    return serverError(res);
  }
}
