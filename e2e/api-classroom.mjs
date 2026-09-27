/* ============ P5 QUIZ — CLASSROOM API CONTRACT E2E ============ */
/* Standalone script (no test-runner). Proves the classroom API contract with
   throwaway fixtures on the real DB, then deletes every account it created.

   Contract under test:
     GET   /api/classes/{id}/quizzes?q=&sort=newest|title|played&page=&limit=
           -> {ok, quizzes:[{id,title,author,created,pinned,plays}], total, page, pages}
           limit clamps 1..60 (default 24); q matches title or author;
           pages = ceil(total/limit)
     PATCH /api/classes/{id}/quizzes {id, pinned}   -> teacher only (403 for student)
     GET   /api/classes/mine  -> {ok, classes:[{id,name,code,role,members}], activeId}
     POST  /api/classes/mine {classId} -> sets active class; /api/auth/me then
           reports session.cls = that class
     POST  /api/classes/{id}/quizzes is rate-limited 20/min per IP

   Run:  P5Q_BASE=http://localhost:3013 node e2e/api-classroom.mjs            */

import { randomBytes } from "node:crypto";
import {
  BASE,
  Client, PASSWORD, check, results, randIp,
  registerUser, createClass, joinClass, seedQuizzes, cleanupAccounts,
} from "./lib.mjs";

const tag = randomBytes(3).toString("hex");
const teacherName = `e2e_teacher_${tag}`;
const studentName = `e2e_student_${tag}`;
const zebraToken = `ZEBRAFISH_${tag}`;

const teacher = new Client();
const student = new Client();

const fixtures = {
  teacher: { name: teacherName, client: teacher, created: false },
  student: { name: studentName, client: student, created: false },
};

let clsA = null;
let clsB = null;
let quizIds = [];

const seedTitles = Array.from({ length: 30 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `E2E Quiz ${n} [${tag}]${i + 1 === 17 ? ` ${zebraToken}` : ""}`;
});

async function main() {
  /* ---------- fixtures ---------- */
  const rt = await registerUser(teacher, teacherName);
  fixtures.teacher.created = rt.status === 200 && !!rt.json?.session?.user?.id;
  check("fixture: teacher registered (throwaway)", fixtures.teacher.created, `${teacherName} status=${rt.status}`);

  const rs = await registerUser(student, studentName);
  fixtures.student.created = rs.status === 200 && !!rs.json?.session?.user?.id;
  check("fixture: student registered (throwaway)", fixtures.student.created, `${studentName} status=${rs.status}`);

  if (!fixtures.teacher.created || !fixtures.student.created) throw new Error("accounts unavailable — cannot run contract checks");

  const ca = await createClass(teacher, `E2E Class A ${tag}`);
  clsA = ca.json?.cls ?? null;
  const cb = await createClass(teacher, `E2E Class B ${tag}`);
  clsB = cb.json?.cls ?? null;
  check("fixture: two classes created (teacher)", ca.status === 200 && cb.status === 200 && !!clsA?.id && !!clsB?.id, `A=${clsA?.code ?? ca.status} B=${clsB?.code ?? cb.status}`);
  if (!clsA?.id || !clsB?.id) throw new Error("classes unavailable — cannot run contract checks");

  const j1 = await joinClass(student, clsA.code);
  const j2 = await joinClass(student, clsB.code);
  check("fixture: student joined both classes", j1.status === 200 && j2.status === 200, `A=${j1.status} B=${j2.status}`);

  const seeded = await seedQuizzes(teacher, clsA.id, seedTitles);
  quizIds = seeded.ids;
  check("fixture: 30 valid quizzes seeded into class A (IP rotated)", seeded.statuses.every((s) => s === 200) && quizIds.filter(Boolean).length === 30, `created=${quizIds.filter(Boolean).length} statuses=[${[...new Set(seeded.statuses)].join(",")}]`);

  const list = (qs = "") => teacher.get(`/api/classes/${clsA.id}/quizzes${qs}`);

  /* ---------- GET list: paging ---------- */
  const first = await list();
  const q0 = first.json?.quizzes?.[0];
  check(
    "GET quizzes: default page 24 of total 30 (page 1, pages 2)",
    first.status === 200 && first.json?.ok === true && Array.isArray(first.json?.quizzes) &&
      first.json.quizzes.length === 24 && first.json.total === 30 && first.json.page === 1 && first.json.pages === 2,
    `status=${first.status} total=${first.json?.total} page=${first.json?.page} pages=${first.json?.pages} n=${first.json?.quizzes?.length}`,
  );
  check(
    "GET quizzes: row shape {id,title,author,created,pinned,plays}",
    !!q0 &&
      ["id", "title", "author", "created", "pinned", "plays"].every((k) => k in q0) &&
      typeof q0.id === "string" && typeof q0.title === "string" && typeof q0.author === "string" &&
      typeof q0.pinned === "boolean" && typeof q0.plays === "number" && q0.plays === 0 && !!q0.created,
    JSON.stringify(q0 ?? null).slice(0, 160),
  );

  const p2 = await list("?page=2");
  check(
    "GET quizzes: page=2 returns the remaining 6",
    p2.status === 200 && p2.json?.quizzes?.length === 6 && p2.json.total === 30 && p2.json.page === 2 && p2.json.pages === 2,
    `status=${p2.status} n=${p2.json?.quizzes?.length} page=${p2.json?.page} pages=${p2.json?.pages}`,
  );

  const lim = await list("?limit=999");
  check(
    "GET quizzes: limit=999 clamps (≤60; all 30, pages 1)",
    lim.status === 200 && lim.json?.quizzes?.length <= 60 && lim.json.quizzes.length === 30 && lim.json.pages === 1,
    `status=${lim.status} n=${lim.json?.quizzes?.length} pages=${lim.json?.pages}`,
  );

  const l0 = await list("?limit=0");
  check(
    "GET quizzes: limit=0 clamps to 1 (pages 30)",
    l0.status === 200 && l0.json?.quizzes?.length === 1 && l0.json.pages === 30,
    `status=${l0.status} n=${l0.json?.quizzes?.length} pages=${l0.json?.pages}`,
  );

  /* ---------- GET list: q / sort ---------- */
  const qTitle = await list(`?q=${zebraToken}`);
  check(
    "GET quizzes: q matches title (exactly 1 hit)",
    qTitle.status === 200 && qTitle.json?.total === 1 && qTitle.json?.quizzes?.length === 1 &&
      String(qTitle.json.quizzes[0]?.title ?? "").includes(zebraToken),
    `total=${qTitle.json?.total} title=${qTitle.json?.quizzes?.[0]?.title ?? "—"}`,
  );

  const qAuthor = await list(`?q=${encodeURIComponent(teacherName)}`);
  check(
    "GET quizzes: q matches author (all 30 hits)",
    qAuthor.status === 200 && qAuthor.json?.total === 30 && qAuthor.json?.quizzes?.length === 24,
    `total=${qAuthor.json?.total} n=${qAuthor.json?.quizzes?.length}`,
  );

  const st = await list("?sort=title&limit=60");
  const titles = (st.json?.quizzes ?? []).map((q) => String(q.title));
  check(
    "GET quizzes: sort=title ascending",
    st.status === 200 && titles.length === 30 && titles.every((t, i) => i === 0 || titles[i - 1] <= t),
    `first=${titles[0] ?? "—"} last=${titles[titles.length - 1] ?? "—"} sorted=${titles.every((t, i) => i === 0 || titles[i - 1] <= t)}`,
  );

  const sp = await list("?sort=played");
  check(
    "GET quizzes: sort=played accepted (200 + rows)",
    sp.status === 200 && Array.isArray(sp.json?.quizzes) && sp.json.quizzes.length === 24,
    `status=${sp.status} n=${sp.json?.quizzes?.length}`,
  );

  /* ---------- PATCH pin ---------- */
  const zebraId = quizIds[16];
  const pin = await teacher.patch(`/api/classes/${clsA.id}/quizzes`, { id: zebraId, pinned: true });
  check("PATCH quizzes: teacher can pin (200 ok:true)", pin.status === 200 && pin.json?.ok === true, `status=${pin.status} body=${JSON.stringify(pin.json)?.slice(0, 100)}`);

  const pinnedList = await list(`?q=${zebraToken}`);
  check(
    "PATCH quizzes: pinned=true reflected in list",
    pinnedList.status === 200 && pinnedList.json?.quizzes?.[0]?.pinned === true,
    `pinned=${pinnedList.json?.quizzes?.[0]?.pinned}`,
  );

  const sPin = await student.patch(`/api/classes/${clsA.id}/quizzes`, { id: zebraId, pinned: true });
  check("PATCH quizzes: student is rejected with 403", sPin.status === 403, `status=${sPin.status}`);

  const unpin = await teacher.patch(`/api/classes/${clsA.id}/quizzes`, { id: zebraId, pinned: false });
  const unpinnedList = await list(`?q=${zebraToken}`);
  check(
    "PATCH quizzes: unpin works (pinned=false)",
    unpin.status === 200 && unpinnedList.json?.quizzes?.[0]?.pinned === false,
    `status=${unpin.status} pinned=${unpinnedList.json?.quizzes?.[0]?.pinned}`,
  );

  /* ---------- classes/mine + active class ---------- */
  const mine1 = await teacher.get("/api/classes/mine");
  const mineClasses = mine1.json?.classes ?? [];
  check(
    "GET classes/mine: both classes + shape + activeId present",
    mine1.status === 200 && mine1.json?.ok === true && Array.isArray(mineClasses) && mineClasses.length === 2 &&
      [clsA.id, clsB.id].every((id) => mineClasses.some((c) => c.id === id)) &&
      mineClasses.every((c) => typeof c.name === "string" && typeof c.code === "string" && c.role === "teacher" && typeof c.members === "number" && c.members >= 2) &&
      Object.prototype.hasOwnProperty.call(mine1.json ?? {}, "activeId"),
    `status=${mine1.status} n=${mineClasses.length} activeId=${mine1.json?.activeId ?? "—"}`,
  );

  const setB = await teacher.post("/api/classes/mine", { classId: clsB.id });
  const meB = await teacher.get("/api/auth/me");
  check(
    "POST classes/mine: set class B → /auth/me reports class B",
    setB.status === 200 && meB.json?.session?.cls?.id === clsB.id,
    `post=${setB.status} me.cls=${meB.json?.session?.cls?.id ?? "—"}`,
  );

  const mineB = await teacher.get("/api/classes/mine");
  check("GET classes/mine: activeId reflects class B", mineB.json?.activeId === clsB.id, `activeId=${mineB.json?.activeId ?? "—"}`);

  const setA = await teacher.post("/api/classes/mine", { classId: clsA.id });
  const meA = await teacher.get("/api/auth/me");
  check(
    "POST classes/mine: toggle back to class A → /auth/me reports class A",
    setA.status === 200 && meA.json?.session?.cls?.id === clsA.id,
    `post=${setA.status} me.cls=${meA.json?.session?.cls?.id ?? "—"}`,
  );

  const sSet = await student.post("/api/classes/mine", { classId: clsA.id });
  const sMe = await student.get("/api/auth/me");
  check(
    "student active class toggle reflected in /auth/me",
    sSet.status === 200 && sMe.json?.session?.cls?.id === clsA.id,
    `post=${sSet.status} me.cls=${sMe.json?.session?.cls?.id ?? "—"}`,
  );

  /* ---------- wildcard search: % and _ are searched literally ---------- */
  const wildTitle = `100% Under_score [${tag}]`;
  const wildQuiz = { title: wildTitle, sections: [{ name: "S", questions: [{ type: "multiple", question: "q", answers: [{ text: "a", correct: true }, { text: "b" }] }] }] };
  const wildPost = await teacher.post(`/api/classes/${clsA.id}/quizzes`, { title: wildTitle, quiz: wildQuiz });
  const wildPct = await teacher.get(`/api/classes/${clsA.id}/quizzes?q=${encodeURIComponent("100%")}`);
  const wildUnd = await teacher.get(`/api/classes/${clsA.id}/quizzes?q=${encodeURIComponent("Under_score")}`);
  const wildOnly = await teacher.get(`/api/classes/${clsA.id}/quizzes?q=${encodeURIComponent("%")}`);
  check(
    "search: literal '%' and '_' match only the literal title",
    wildPost.status === 200 && wildPct.json?.total === 1 && wildUnd.json?.total === 1 && wildOnly.json?.total === 1,
    `post=${wildPost.status} pct=${wildPct.json?.total} underscore=${wildUnd.json?.total} lone-pct=${wildOnly.json?.total}`,
  );

  /* ---------- POST rate limit ----------
     Only meaningful locally: live Vercel normalizes the client IP, so the
     seeding above already consumed the window and spoofing cannot isolate it. */
  if (!/localhost|127\.0\.0\.1/.test(BASE)) {
    console.log("SKIP rate-limit probe on live (Vercel normalizes the client IP)");
  } else {
  const rlIp = randIp();
  const rlStatuses = [];
  for (let i = 0; i < 21; i++) {
    const r = await teacher.post(
      `/api/classes/${clsA.id}/quizzes`,
      { title: `E2E RL ${i} [${tag}]`, quiz: { title: `E2E RL ${i} [${tag}]`, sections: [{ name: "S", questions: [{ type: "multiple", question: "q", answers: [{ text: "a", correct: true }, { text: "b" }] }] }] } },
      { ip: rlIp },
    );
    rlStatuses.push(r.status);
  }
  check(
    "POST quizzes: rate-limited 20/min per IP (21st → 429)",
    rlStatuses.slice(0, 20).every((s) => s === 200) && rlStatuses[20] === 429,
    `statuses=[${rlStatuses.join(",")}]`,
  );
  }
}

try {
  await main();
} catch (e) {
  check("harness completed without throwing", false, String(e).slice(0, 200));
  console.error(e);
} finally {
  await cleanupAccounts(Object.values(fixtures));
  console.log(results.fails ? `\n${results.fails} FAILURE(S)` : "\nALL PASS");
  process.exit(results.fails ? 1 : 0);
}
