/* ============ P5 QUIZ — CLASSROOM UI E2E (browser) ============ */
/* One standalone script (shared check() runner) that drives the built app from
   dist/ through devapi with the system Chrome. Fixtures on the real DB:
   throwaway teacher + student, two classes (student in both), 30 valid quizzes
   seeded into class A. Covers the frozen UI contract:
     #dashboard  recent hub (6) · VIEW ALL (30) · pin/unpin in place
     #class-library  24/page pager · search · sort · bulk delete
     class switcher  remount → /auth/me → reload persistence
     role gating  student sees no teacher-only controls
     phone 390×844  no horizontal overflow + working sort
   Every account is deleted via DELETE /api/auth/me, so the script is
   rerunnable/residue-free.

   Run:  P5Q_BASE=http://localhost:3013 node e2e/ui-classroom.mjs            */

import { randomBytes } from "node:crypto";
import {
  Client, check, results,
  registerUser, createClass, joinClass, seedQuizzes, cleanupAccounts, browser,
} from "./lib.mjs";

const APP = (process.env.P5Q_BASE ?? "http://localhost:3013").replace(/\/+$/, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Poll a page predicate; true on the first truthy result, false on timeout. */
async function waitFor(page, fn, arg = null, { timeout = 20_000, poll = 100 } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: poll });
    return true;
  } catch {
    return false;
  }
}

async function waitCount(page, sel, n, timeout = 20_000) {
  return waitFor(page, ([s, want]) => document.querySelectorAll(s).length === want, [sel, n], { timeout });
}

async function readText(page, sel) {
  try {
    return (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  } catch {
    return "«missing»";
  }
}

/* Client jar -> Playwright cookies. p5q_csrf must stay readable by the SPA;
   p5q_session is HttpOnly server-side, so keep it HttpOnly here too. */
function jarToCookies(client) {
  return Object.entries(client.cookies).map(([name, value]) => ({
    name,
    value,
    url: APP,
    httpOnly: name === "p5q_session",
    secure: false,
    sameSite: "Lax",
  }));
}

/* Thin API helpers over the shared Client (PATCH pin / active-class switch). */
const listQuizzes = (client, classId, qs = "") => client.get(`/api/classes/${classId}/quizzes${qs}`);
const pinQuiz = (client, classId, id, pinned) => client.patch(`/api/classes/${classId}/quizzes`, { id, pinned });
const setActiveClass = (client, classId) => client.post("/api/classes/mine", { classId });

const tag = randomBytes(3).toString("hex");
const teacherName = `e2e_ui_teacher_${tag}`;
const studentName = `e2e_ui_student_${tag}`;
const titles = Array.from({ length: 30 }, (_, i) => `E2E Quiz ${String(i + 1).padStart(2, "0")} [${tag}]`);
const expectedFirstTitle = [...titles].sort((a, b) => a.localeCompare(b))[0];

const teacher = new Client(APP);
const student = new Client(APP);
const accounts = [
  { name: teacherName, client: teacher, created: false },
  { name: studentName, client: student, created: false },
];

let clsA = null;
let clsB = null;
let b = null;
let ctx = null;
let page = null;
const pageErrors = [];
const track = (p) => {
  p.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
  p.on("crash", () => pageErrors.push("RENDERER CRASH"));
};

/* Hard budget guard so a wedged UI can never hang the gauntlet loop. */
const watchdog = setTimeout(() => {
  console.log("FAIL ui-classroom exceeded the 240s budget");
  process.exit(1);
}, 240_000);

async function main() {
  /* ---------- fixtures (throwaway, real DB) ---------- */
  const rt = await registerUser(teacher, teacherName);
  accounts[0].created = rt.status === 200 && !!rt.json?.session?.user?.id;
  check("fixture: teacher registered (throwaway)", accounts[0].created, `${teacherName} status=${rt.status}`);

  const rs = await registerUser(student, studentName);
  accounts[1].created = rs.status === 200 && !!rs.json?.session?.user?.id;
  check("fixture: student registered (throwaway)", accounts[1].created, `${studentName} status=${rs.status}`);
  if (!accounts[0].created || !accounts[1].created) throw new Error("accounts unavailable — cannot run UI checks");

  const ca = await createClass(teacher, `E2E UI Class A ${tag}`);
  const cb = await createClass(teacher, `E2E UI Class B ${tag}`);
  clsA = ca.json?.cls ?? null;
  clsB = cb.json?.cls ?? null;
  check(
    "fixture: two classes created (teacher)",
    ca.status === 200 && cb.status === 200 && !!clsA?.id && !!clsB?.id,
    `A=${clsA?.code ?? ca.status} B=${clsB?.code ?? cb.status}`,
  );
  if (!clsA?.id || !clsB?.id) throw new Error("classes unavailable — cannot run UI checks");

  const j1 = await joinClass(student, clsA.code);
  const j2 = await joinClass(student, clsB.code);
  check("fixture: student joined both classes", j1.status === 200 && j2.status === 200, `A=${j1.status} B=${j2.status}`);

  const seeded = await seedQuizzes(teacher, clsA.id, titles);
  check(
    "fixture: 30 valid quizzes seeded into class A",
    seeded.statuses.every((s) => s === 200) && seeded.ids.filter(Boolean).length === 30,
    `created=${seeded.ids.filter(Boolean).length} statuses=[${[...new Set(seeded.statuses)].join(",")}]`,
  );

  /* Both accounts would default to the class joined most recently; pin the run
     to class A so the dashboard/library steps have known content. */
  const aT = await setActiveClass(teacher, clsA.id);
  const aS = await setActiveClass(student, clsA.id);
  check("fixture: teacher + student active class pinned to A", aT.status === 200 && aS.status === 200, `teacher=${aT.status} student=${aS.status}`);

  /* ---------- browser: teacher ---------- */
  b = await browser();
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(jarToCookies(teacher));
  page = await ctx.newPage();
  track(page);
  await page.goto(`${APP}/#dashboard`, { waitUntil: "domcontentloaded" });

  /* ---- 1) dashboard hub ---- */
  const hubReady = await waitFor(page, () => {
    const recent = document.querySelectorAll('[data-hub="recent"] .qcard').length;
    const viewAll = document.querySelector(".dash-viewall")?.textContent ?? "";
    return recent === 6 && /\(30\)/.test(viewAll);
  });
  const recentN = await page.locator('[data-hub="recent"] .qcard').count();
  const viewAllText = await readText(page, ".dash-viewall");
  check("1 dashboard: [data-hub=recent] has exactly 6 .qcard", hubReady && recentN === 6, `count=${recentN}`);
  check("1 dashboard: VIEW ALL shows total 30", /VIEW ALL \(30\)/.test(viewAllText), `text="${viewAllText}"`);
  const pinnedBefore = await page.locator('[data-hub="pinned"]').count();
  check("1 dashboard: no pinned section before pinning", pinnedBefore === 0, `sections=${pinnedBefore}`);

  /* ---- 2) pin in place, then unpin ---- */
  await page.evaluate(() => {
    window.__e2eNoReload = `mark-${Math.random()}`;
  });
  const mark = await page.evaluate(() => window.__e2eNoReload);
  const firstCard = page.locator('[data-hub="recent"] .qcard').first();
  const firstQid = await firstCard.getAttribute("data-qid");
  await firstCard.locator(".qcard-pin").click();
  const pinnedOk = await waitFor(
    page,
    (qid) => {
      const sec = document.querySelector('[data-hub="pinned"]');
      const card = sec?.querySelector(`.qcard[data-qid="${qid}"]`);
      return !!card && card.classList.contains("pinned");
    },
    firstQid,
    { timeout: 15_000 },
  );
  const pinPressed = await page
    .locator(`[data-hub="pinned"] .qcard[data-qid="${firstQid}"] .qcard-pin`)
    .getAttribute("aria-pressed")
    .catch(() => "«missing»");
  const markSame = (await page.evaluate(() => window.__e2eNoReload)) === mark;
  check("2 pin: card gains .pinned and appears in PINNED", pinnedOk, `qid=${firstQid} aria-pressed=${pinPressed}`);
  check("2 pin: rerender happened in place (no reload)", markSame, `mark intact=${markSame}`);

  await sleep(550); /* respect the deliberate-action cooldown the UI applies */
  await page.locator('[data-hub="pinned"] .qcard .qcard-pin').first().click();
  const unpinnedOk = await waitFor(
    page,
    () => !document.querySelector('[data-hub="pinned"]') && document.querySelectorAll(".qcard.pinned").length === 0,
    null,
    { timeout: 15_000 },
  );
  const markSame2 = (await page.evaluate(() => window.__e2eNoReload)) === mark;
  const pinnedAfter = await page.locator('[data-hub="pinned"]').count();
  check("2 unpin: pinned section disappears and card unpins", unpinnedOk && pinnedAfter === 0, `pinnedSections=${pinnedAfter} .qcard.pinned=${await page.locator(".qcard.pinned").count()}`);
  check("2 unpin: still no reload", markSame2, `mark intact=${markSame2}`);

  /* ---- 2b) edge guards: dblclick is one toggle; delete purges the pin ---- */
  await sleep(550); /* let the step-2 unpin cooldown lapse before re-pinning */
  const c2 = page.locator('[data-hub="recent"] .qcard').first();
  const c2id = await c2.getAttribute("data-qid");
  let pinPatches = 0;
  const countPatch = (req) => {
    if (req.method() === "PATCH" && req.url().includes("/quizzes")) pinPatches++;
  };
  page.on("request", countPatch);
  await page.locator(`[data-hub="recent"] .qcard[data-qid="${c2id}"] .qcard-pin`).click();
  await sleep(250);
  await page
    .locator(`[data-hub="pinned"] .qcard[data-qid="${c2id}"] .qcard-pin`)
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  const dblOk = await waitFor(
    page,
    (qid) => {
      const sec = document.querySelector('[data-hub="pinned"]');
      return !!sec?.querySelector(`.qcard[data-qid="${qid}"]`);
    },
    c2id,
    { timeout: 15_000 },
  );
  page.off("request", countPatch);
  check("2b pin: 250ms double-click fires ONE patch and stays PINNED", dblOk && pinPatches === 1, `patches=${pinPatches} qid=${c2id}`);

  /* ---- 3) open class library via VIEW ALL ---- */
  await page.locator(".dash-viewall").click();
  const libReady = await waitFor(
    page,
    () => location.hash === "#class-library" && document.querySelectorAll(".clib-grid .qcard").length === 24,
    null,
    { timeout: 25_000 },
  );
  const hash = await page.evaluate(() => location.hash);
  const libN = await page.locator(".clib-grid .qcard").count();
  const showing1 = await readText(page, ".clib-showing");
  const pos1 = await readText(page, ".clib-pos");
  const prevDisabled1 = await page.locator(".clib-prev").isDisabled();
  check("3 library: VIEW ALL opens #class-library", libReady && hash === "#class-library", `hash=${hash}`);
  check("3 library: page 1 shows 24 cards", libN === 24, `cards=${libN}`);
  check('3 library: .clib-showing contains "of 30"', showing1.includes("of 30"), `text="${showing1}"`);
  check("3 library: .clib-pos shows 1/2", pos1 === "1/2", `text="${pos1}"`);
  check("3 library: .clib-prev disabled on page 1", prevDisabled1, `disabled=${prevDisabled1}`);

  await page.locator(".clib-next").click();
  const page2Ok = await waitFor(
    page,
    () => document.querySelectorAll(".clib-grid .qcard").length === 6 && (document.querySelector(".clib-pos")?.textContent ?? "").trim() === "2/2",
    null,
    { timeout: 20_000 },
  );
  const showing2 = await readText(page, ".clib-showing");
  const prevDisabled2 = await page.locator(".clib-prev").isDisabled();
  check("3 pager: .clib-next → 6 cards (page 2/2)", page2Ok, `cards=${await page.locator(".clib-grid .qcard").count()} pos="${await readText(page, ".clib-pos")}" showing="${showing2}"`);
  check("3 pager: prev enabled on page 2", !prevDisabled2, `disabled=${prevDisabled2}`);

  await page.locator(".clib-prev").click();
  const back1Ok = await waitCount(page, ".clib-grid .qcard", 24, 20_000);
  check("3 pager: .clib-prev returns to 24 cards (1/2)", back1Ok, `cards=${await page.locator(".clib-grid .qcard").count()} pos="${await readText(page, ".clib-pos")}"`);

  /* ---- 4) search ---- */
  await page.locator(".clib-search").fill("E2E Quiz 07");
  const searchOk = await waitFor(
    page,
    () => document.querySelectorAll(".clib-grid .qcard").length === 1 && (document.querySelector(".clib-showing")?.textContent ?? "").includes("of 1"),
    null,
    { timeout: 20_000 },
  );
  const hitTitle = await readText(page, ".clib-grid .qcard .qcard-title");
  check('4 search: "E2E Quiz 07" → 1 card, .clib-showing "of 1"', searchOk && hitTitle === `E2E Quiz 07 [${tag}]`, `title="${hitTitle}" showing="${await readText(page, ".clib-showing")}"`);

  await page.locator(".clib-search").fill("");
  const clearedOk = await waitFor(
    page,
    () => document.querySelectorAll(".clib-grid .qcard").length === 24 && (document.querySelector(".clib-showing")?.textContent ?? "").includes("of 30"),
    null,
    { timeout: 20_000 },
  );
  check("4 search: cleared → 24 cards / of 30", clearedOk, `cards=${await page.locator(".clib-grid .qcard").count()} showing="${await readText(page, ".clib-showing")}"`);

  /* ---- 5) sort=title / sort=played ---- */
  await page.locator('.clib-sort[data-sort="title"]').click();
  const titleSortOk = await waitFor(
    page,
    (exp) => {
      const cards = [...document.querySelectorAll(".clib-grid .qcard .qcard-title")];
      if (cards.length !== 24) return false;
      const ts = cards.map((c) => (c.textContent ?? "").trim());
      return ts[0] === exp && ts.every((t, i) => i === 0 || ts[i - 1] <= t);
    },
    expectedFirstTitle,
    { timeout: 20_000 },
  );
  check("5 sort=title: first .qcard-title is alphabetically first (ascending)", titleSortOk, `first="${await readText(page, ".clib-grid .qcard .qcard-title")}" expected="${expectedFirstTitle}"`);

  await page.locator('.clib-sort[data-sort="played"]').click();
  const playedOk = await waitFor(
    page,
    () => document.querySelectorAll(".clib-grid .qcard").length === 24 && (document.querySelector('.clib-sort[data-sort="played"]')?.classList.contains("active") ?? false),
    null,
    { timeout: 20_000 },
  );
  check("5 sort=played: accepted, 24 rows, chip active", playedOk, `cards=${await page.locator(".clib-grid .qcard").count()}`);

  /* ---- 6) teacher bulk delete ---- */
  await page.locator(".clib-select-toggle").click();
  const bulkOpen = await waitFor(page, () => !(document.querySelector(".clib-bulk")?.classList.contains("hidden") ?? true), null, { timeout: 10_000 });
  check("6 bulk: .clib-select-toggle reveals .clib-bulk", bulkOpen, `bulkHidden=${await page.locator(".clib-bulk").evaluate((el) => el.classList.contains("hidden")).catch(() => "«missing»")}`);

  const libCards = page.locator(".clib-grid .qcard");
  await libCards.nth(0).locator(".qcard-title").click();
  await libCards.nth(1).locator(".qcard-title").click();
  const twoSelOk = await waitFor(
    page,
    () => document.querySelectorAll(".clib-grid .qcard.selected").length === 2 && (document.querySelector(".clib-bulk-count")?.textContent ?? "").includes("2 selected"),
    null,
    { timeout: 10_000 },
  );
  const selectedIds = await page.$$eval(".clib-grid .qcard.selected", (els) => els.map((e) => e.getAttribute("data-qid")));
  const delEnabled = await page.locator(".clib-bulk-del").isEnabled();
  check("6 bulk: two cards .selected + bulk count '2 selected'", twoSelOk && selectedIds.length === 2 && selectedIds.every(Boolean), `ids=[${selectedIds.join(",")}]`);
  check("6 bulk: .clib-bulk-del enabled with selection", delEnabled, `enabled=${delEnabled}`);

  await page.locator(".clib-bulk-del").click();
  const dropOk = await waitFor(
    page,
    () => {
      const c = document.querySelector(".clib-count")?.textContent ?? "";
      const s = document.querySelector(".clib-showing")?.textContent ?? "";
      return c.includes("28") && s.includes("of 28");
    },
    null,
    { timeout: 25_000 },
  );
  check("6 bulk: delete drops UI total to 28 (.clib-count / .clib-showing)", dropOk, `count="${await readText(page, ".clib-count")}" showing="${await readText(page, ".clib-showing")}"`);

  const serverList = await listQuizzes(teacher, clsA.id, "?limit=60");
  const serverIds = (serverList.json?.quizzes ?? []).map((q) => q.id);
  check("6 bulk: server GET agrees total=28", serverList.status === 200 && serverList.json?.total === 28 && serverIds.length === 28, `total=${serverList.json?.total} rows=${serverIds.length}`);
  check("6 bulk: deleted ids gone server-side", selectedIds.length === 2 && selectedIds.every((id) => !serverIds.includes(id)), `deleted=[${selectedIds.join(",")}]`);

  /* ---- 7) class switcher ---- */
  await page.goto(`${APP}/#dashboard`, { waitUntil: "domcontentloaded" });
  const swVisible = await page
    .locator(".dash-switcher-btn")
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const swText = await readText(page, ".dash-switcher-btn");
  check("7 switcher: .dash-switcher-btn visible (2 classes)", swVisible, `text="${swText}"`);

  await page.locator(".dash-switcher-btn").click();
  const menuOk = await waitFor(
    page,
    () => !(document.querySelector(".dash-switcher-menu")?.classList.contains("hidden") ?? true) && document.querySelectorAll(".dash-switcher-item").length === 2,
    null,
    { timeout: 10_000 },
  );
  check("7 switcher: menu opens with both classes", menuOk, `items=${await page.locator(".dash-switcher-item").count()}`);

  await page.locator(`.dash-switcher-item[data-id="${clsB.id}"]`).click();
  const remountOk = await waitFor(page, (name) => (document.querySelector(".dash-classname")?.textContent ?? "").includes(name), clsB.name, { timeout: 25_000 });
  const meB = await teacher.get("/api/auth/me");
  check("7 switcher: clicking class B remounts dashboard as B", remountOk, `classname="${await readText(page, ".dash-classname")}"`);
  check("7 switcher: GET /auth/me reports session.cls = class B", meB.json?.session?.cls?.id === clsB.id, `cls="${meB.json?.session?.cls?.name ?? "—"}" id=${meB.json?.session?.cls?.id ?? "—"}`);

  await page.locator(".dash-viewall").click();
  const libBOk = await waitFor(
    page,
    () => location.hash === "#class-library" && (document.querySelector(".clib-count")?.textContent ?? "").includes("0") && !!document.querySelector(".clib-msg"),
    null,
    { timeout: 25_000 },
  );
  check("7 switcher: #class-library for class B shows 0", libBOk, `count="${await readText(page, ".clib-count")}" msg="${await readText(page, ".clib-msg")}"`);

  await page.reload({ waitUntil: "domcontentloaded" });
  const stillBOk = await waitFor(page, (name) => (document.querySelector(".clib-sub")?.textContent ?? "").includes(name), clsB.name, { timeout: 25_000 });
  check("7 switcher: reload keeps class B active", stillBOk, `sub="${await readText(page, ".clib-sub")}"`);

  /* ---- 8) student role gating ---- */
  await ctx.clearCookies();
  await ctx.addCookies(jarToCookies(student));
  await page.goto(`${APP}/#dashboard`, { waitUntil: "domcontentloaded" });
  /* The goto above is a same-document hash navigation (the app never re-reads
     the cookies), so force a fresh document for cloudReady() to see the
     student's session. */
  await page.reload({ waitUntil: "domcontentloaded" });
  const sDashOk = await waitFor(
    page,
    (uname) => {
      const role = document.querySelector(".dash-role")?.textContent ?? "";
      return role.includes(uname) && document.querySelectorAll(".dash-hub .qcard").length >= 1;
    },
    studentName,
    { timeout: 25_000 },
  );
  const sCards = await page.locator(".dash-hub .qcard").count();
  const sPins = await page.locator(".qcard-pin").count();
  const sDels = await page.locator(".qcard-del").count();
  check("8 student: dashboard loads own class cards", sDashOk && sCards >= 1, `cards=${sCards} role="${await readText(page, ".dash-role")}"`);
  check("8 student: no .qcard-pin / .qcard-del (role-gated)", sPins === 0 && sDels === 0, `pin=${sPins} del=${sDels}`);

  await page.locator(".dash-viewall").click();
  const sLibOk = await waitFor(
    page,
    () => location.hash === "#class-library" && document.querySelectorAll(".clib-grid .qcard").length === 24,
    null,
    { timeout: 25_000 },
  );
  const sToggle = await page.locator(".clib-select-toggle").count();
  const sBulk = await page.locator(".clib-bulk").count();
  check("8 student: library has no .clib-select-toggle / .clib-bulk", sLibOk && sToggle === 0 && sBulk === 0, `toggle=${sToggle} bulk=${sBulk} cards=${await page.locator(".clib-grid .qcard").count()}`);

  /* ---- 9) phone width 390×844 (single page: fewer renderers, same coverage).
     Swapping users needs a fresh document for cloudReady() to see the session. ---- */
  await setActiveClass(teacher, clsA.id); // teacher back to A for a populated library
  await ctx.clearCookies();
  await ctx.addCookies(jarToCookies(teacher));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/#class-library`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const phone = page;
  const phoneReady = await waitCount(phone, ".clib-grid .qcard", 24, 25_000);
  const overflow = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  const toolbarVisible = await phone.locator(".clib-toolbar").isVisible().catch(() => false);
  const searchVisible = await phone.locator(".clib-search").isVisible().catch(() => false);
  check("9 phone: no horizontal overflow at 390x844", phoneReady && overflow.sw <= overflow.iw + 1, `scrollWidth=${overflow.sw} innerWidth=${overflow.iw}`);
  check("9 phone: toolbar + search visible", toolbarVisible && searchVisible, `toolbar=${toolbarVisible} search=${searchVisible}`);

  await phone.locator('.clib-sort[data-sort="title"]').click();
  const phoneSortOk = await waitFor(
    phone,
    (exp) => {
      const cards = [...document.querySelectorAll(".clib-grid .qcard .qcard-title")];
      return cards.length === 24 && (cards[0].textContent ?? "").trim() === exp;
    },
    expectedFirstTitle,
    { timeout: 20_000 },
  );
  check("9 phone: .clib-sort click still works (24 cards, title first)", phoneSortOk, `first="${await readText(phone, ".clib-grid .qcard .qcard-title")}" active="${await phone.locator('.clib-sort[data-sort="title"]').evaluate((el) => el.classList.contains("active")).catch(() => "«missing»")}"`);

  /* ---- 10) deleting a pinned card purges it everywhere ---- */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${APP}/#dashboard`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const c3 = page.locator('[data-hub="recent"] .qcard').first();
  const c3id = await c3.getAttribute("data-qid");
  await c3.locator(".qcard-pin").click();
  const c3pinned = await waitFor(
    page,
    (qid) => !!document.querySelector(`[data-hub="pinned"] .qcard[data-qid="${qid}"]`),
    c3id,
    { timeout: 15_000 },
  );
  await page.locator(`[data-hub="pinned"] .qcard[data-qid="${c3id}"] .qcard-del`).click();
  const purged = await waitFor(
    page,
    (qid) => !document.querySelector(`.dash-hub .qcard[data-qid="${qid}"]`) && !document.querySelector('[data-hub="pinned"]'),
    c3id,
    { timeout: 15_000 },
  );
  check("10 delete: pinned card purged from the hub (no stale card)", c3pinned && purged, `qid=${c3id} pinnedSections=${await page.locator('[data-hub="pinned"]').count()}`);

  /* ---- 11) no uncaught page errors ---- */
  check("no uncaught page errors for the run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
}

try {
  await main();
} catch (e) {
  check("harness completed without throwing", false, String(e).slice(0, 240));
  console.error("pageErrors:", JSON.stringify(pageErrors));
  console.error(e);
} finally {
  clearTimeout(watchdog);
  if (b) await b.close().catch(() => {});
  await cleanupAccounts(accounts);
  console.log(results.fails ? `\n${results.fails} FAILURE(S)` : "\nALL PASS");
  process.exit(results.fails ? 1 : 0);
}
