/* admine2etest.mjs — Gauntlet admin gates: G6 (one round-trip per action),
   G7 (optimistic UI before the reply) and G8 (step-up still enforced), plus the
   real-input E2E for every admin action.
   Creates its own throwaway fixtures, drives the REAL admin panel with REAL
   (hit-tested) mouse clicks, and proves every action persists by re-reading.
   Cleans up everything it created. Safe against production (only own fixtures).

   Run:  P5Q_BASE=http://localhost:3011 node admine2etest.mjs
         P5Q_BASE=https://www.tykunanon.online node admine2etest.mjs   */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const creds = Object.fromEntries(
  readFileSync(join(root, ".admin-bootstrap.txt"), "utf8")
    .split("\n").map((l) => /^([a-z]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
if (!creds.username || !creds.password) { console.log("SKIP: .admin-bootstrap.txt missing"); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

class Client {
  constructor() { this.cookies = {}; this.xff = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`; }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  csrf() { return this.cookies.p5q_csrf ? decodeURIComponent(this.cookies.p5q_csrf) : ""; }
  absorb(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [p] = c.split(";"); const i = p.indexOf("="); if (i > 0) this.cookies[p.slice(0, i)] = p.slice(i + 1); } }
  async req(method, path, body) {
    const headers = { "Content-Type": "application/json", cookie: this.header(), "x-forwarded-for": this.xff };
    if (this.csrf()) headers["x-csrf-token"] = this.csrf();
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.absorb(res);
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  }
  admin(action, payload = {}) { return this.req("POST", "/api/admin", { action, ...payload }); }
}

const tag = randomBytes(3).toString("hex");
const ownerName = `gaunt_owner_${tag}`;
const studentName = `gaunt_student_${tag}`;
const pass = "Gauntlet123";
const owner = new Client();
const student = new Client();
const adminC = new Client();
const owner2 = new Client(); // for post-reset login check

let cls = null, quizId = null, resultId = null, ownerId = null, studentId = null;

/* remove any throwaway fixtures left by an earlier (possibly failed) run so the
   lists are deterministic and row lookups are unambiguous */
async function preClean() {
  const users = (await adminC.admin("users.list", { query: "gaunt_", limit: 200 })).json?.users ?? [];
  for (const u of users) await adminC.admin("users.delete", { id: u.id });
  const classes = (await adminC.admin("classes.list", { limit: 200 })).json?.classes ?? [];
  for (const c of classes) if (String(c.name).startsWith("Gauntlet Class")) await adminC.admin("classes.delete", { id: c.id });
}

async function setupFixtures() {
  const ro = await owner.req("POST", "/api/auth/register", { username: ownerName, password: pass });
  ownerId = ro.json?.session?.user?.id;
  const rs = await student.req("POST", "/api/auth/register", { username: studentName, password: pass });
  studentId = rs.json?.session?.user?.id;
  check("fixture: throwaway users created", !!ownerId && !!studentId, `${ownerName} / ${studentName}`);

  cls = (await owner.req("POST", "/api/classes/create", { name: `Gauntlet Class ${tag}` })).json?.cls;
  check("fixture: throwaway class created", !!cls?.id, cls?.code ?? "");

  await student.req("POST", "/api/classes/join", { code: cls.code });

  const quiz = { title: "Gauntlet Probe Quiz", sections: [{ name: "S1", questions: [{ type: "multiple", answers: [{ text: "2", correct: true }, { text: "3", correct: false }] }] }] };
  const qr = await owner.req("POST", `/api/classes/${cls.id}/quizzes`, { title: quiz.title, quiz });
  quizId = qr.json?.id;
  check("fixture: throwaway quiz created", !!quizId);

  const rr = await student.req("POST", `/api/classes/${cls.id}/results`, { quizId, quizTitle: quiz.title, answers: [{ q: 0, a: "2" }] });
  const results = (await adminC.admin("results.list", { classId: cls.id })).json?.results ?? [];
  resultId = results[0]?.id;
  check("fixture: throwaway result created", !!resultId, `submit=${rr.status}`);
}

async function adminCLogin() {
  await adminC.admin("login", { username: creds.username, password: creds.password });
  await adminC.admin("stepUp", { password: creds.password });
}

async function cleanup() {
  try {
    await adminC.admin("stepUp", { password: creds.password });
    if (cls?.id) await adminC.admin("classes.delete", { id: cls.id });
    if (ownerId) await adminC.admin("users.delete", { id: ownerId });
    if (studentId) await adminC.admin("users.delete", { id: studentId });
  } catch (e) { console.log("cleanup warning:", String(e).slice(0, 120)); }
}

/* ---------------- UI ---------------- */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const pageErrors = [];
const consoleErrors = [];
let loggedIn = false;
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && loggedIn) consoleErrors.push(m.text().slice(0, 160)); });

/* count admin round-trips (G6) and log the request/response sequence so G8 can
   assert the real 403 -> stepUp -> 200 exchange. G7 injects a response delay. */
const adminRequests = [];
const adminLog = [];
page.on("request", (r) => {
  if (!r.url().includes("/api/admin")) return;
  adminRequests.push(Date.now());
  let action = "";
  try { action = JSON.parse(r.postData() ?? "{}").action ?? ""; } catch { /* */ }
  adminLog.push({ dir: "req", action });
  if (process.env.P5Q_DEBUG) console.log(`   [req] ${action}`);
});
page.on("response", async (r) => {
  if (!r.url().includes("/api/admin")) return;
  let action = "";
  try { action = JSON.parse(r.request().postData() ?? "{}").action ?? ""; } catch { /* */ }
  adminLog.push({ dir: "res", action, status: r.status() });
  if (process.env.P5Q_DEBUG) {
    let txt = ""; try { txt = (await r.text()).slice(0, 80); } catch { /* */ }
    console.log(`   [res] ${action} -> ${r.status()} ${txt}`);
  }
});

/* G7: a switchable client-side delay on /api/admin makes the server "slow" so
   the optimistic UI can be observed before the reply arrives. Installed before
   app scripts run. */
await page.evaluateOnNewDocument(() => {
  const orig = window.fetch.bind(window);
  window.__adminDelay = 0;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const p = orig(input, init);
    // delay only the RESPONSE so the request still leaves immediately and the
    // app's promise stays pending (i.e. a slow server)
    if (window.__adminDelay && url.includes("/api/admin")) {
      return p.then((res) => new Promise((r) => setTimeout(() => r(res), window.__adminDelay)));
    }
    return p;
  };
});
const setAdminDelay = (ms) => page.evaluate((d) => { window.__adminDelay = d; }, ms);

const modalOpen = () => page.$eval(".admin-modal", (e) => !e.classList.contains("hidden")).catch(() => false);
const noticeText = async () => (await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => [])).join(" | ");
const contentHas = (s) => page.$eval(".admin-content", (e, s) => e.textContent.includes(s), s).catch(() => false);

async function settleModals(pw) {
  let seen = false, quiet = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await modalOpen()) {
      seen = true; quiet = 0;
      const input = await page.$(".admin-modal input");
      if (input) { await input.click({ clickCount: 3 }); await input.type(pw); }
      const labels = await page.$$eval(".admin-modal .sticker-btn", (els) => els.map((e) => e.textContent.trim()));
      const want = ["CONFIRM", "DONE", "STOP"].find((w) => labels.includes(w));
      if (!want) return;
      const btns = await page.$$(".admin-modal .sticker-btn");
      await btns[labels.indexOf(want)].click();
    } else {
      quiet++;
      // a modal can open LATE (after the step-up round-trip); only stop once it
      // has stayed hidden for a couple of ticks, or nothing appeared at all
      if (seen && quiet >= 2) return;
      if (!seen && quiet >= 10) return;
    }
  }
}

async function goTab(name) {
  const labels = await page.$$eval(".admin-tabs .sticker-btn", (els) => els.map((e) => e.textContent.trim()));
  const i = labels.indexOf(name);
  if (i < 0) return false;
  const before = await page.$eval(".admin-content", (e) => e.textContent).catch(() => "");
  const btns = await page.$$(".admin-tabs .sticker-btn");
  await btns[i].click();
  // wait until the tab content actually changes (stale content from the
  // previous tab is also "non-Loading", so a bare Loading-check races)
  for (let k = 0; k < 30; k++) {
    await sleep(200);
    const c = await page.$eval(".admin-content", (e) => e.textContent).catch(() => "");
    if (c && c !== before && !c.includes("Loading…")) return true;
  }
  return false;
}

/* real, hit-tested click on a button inside the row containing rowText.
   Re-resolves the handle on each attempt so a concurrent tab re-render
   (which detaches nodes) cannot break the run. */
async function clickRowButton(rowText, btnText) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const h = await page.evaluateHandle((rt, bt) => {
      const row = [...document.querySelectorAll(".admin-content .admin-row")].find((r) => r.textContent.includes(rt));
      if (!row) return null;
      const b = [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === bt);
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const box = b.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      b.dataset.hit = (top === b || b.contains(top)) ? "OK" : "FAIL";
      return b;
    }, rowText, btnText);
    const el = h.asElement();
    if (!el) { if (attempt < 3) { await sleep(400); continue; } return { found: false }; }
    const hit = await page.evaluate((e) => e.dataset.hit, el).catch(() => "FAIL");
    try {
      await el.click();
      return { found: true, hit: hit === "OK" };
    } catch {
      if (attempt < 3) { await sleep(500); continue; }
      return { found: true, hit: hit === "OK" };
    }
  }
  return { found: false };
}

/* click an action button, resolve any confirm/step-up/secret modal, then wait
   for the NEW feedback notice (proves the action finished, not just started) */
async function actRaw(rowText, btnText) {
  const before = await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => []);
  const reqStart = adminRequests.length;
  const r = await clickRowButton(rowText, btnText);
  await settleModals(creds.password);
  let notice = "";
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    const now = await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => []);
    const added = now.filter((x) => !before.includes(x));
    if (added.length) { notice = added.join(" | "); break; }
  }
  // wait for the post-action tab re-render to settle before returning
  for (let i = 0; i < 20; i++) { const c = await page.$eval(".admin-content", (e) => e.textContent).catch(() => ""); if (c && !c.includes("Loading…")) break; await sleep(200); }
  await sleep(200);
  return { ...r, notice, reqs: adminRequests.length - reqStart };
}

/* record round-trips per action so a single summary check can assert one-trip
   behaviour for every action after the stop-up exchange */
const actReqs = [];
async function act(rowText, btnText) {
  const a = await actRaw(rowText, btnText);
  actReqs.push({ btnText, reqs: a.reqs });
  return a;
}

async function runUI() {
  await page.goto(`${BASE}/ijustlovehavingtheadminpanel`, { waitUntil: "networkidle0" });
  await sleep(1400);
  const ins = await page.$$(".admin-field input");
  await ins[0].type(creds.username);
  await ins[1].type(creds.password);
  await page.evaluate(() => [...document.querySelectorAll(".sticker-btn")].find((x) => x.textContent.includes("SIGN IN"))?.click());
  for (let i = 0; i < 25; i++) { if (/ADMIN PANEL/.test(await page.$eval(".admin-screen", (e) => e.textContent).catch(() => ""))) break; await sleep(400); }
  loggedIn = true;
  check("UI: admin panel loaded", /ADMIN PANEL/.test(await page.$eval(".admin-screen", (e) => e.textContent).catch(() => "")));

  /* ---- Users ---- */
  await goTab("Users");
  // Promote is the first destructive action -> exercises the real step-up prompt
  let a = await act(studentName, "Promote");
  check("UI: Promote button present + hit-testable", a.found && a.hit, JSON.stringify({ found: a.found, hit: a.hit }));
  let prom = (await adminC.admin("users.get", { id: studentId })).json?.user?.is_admin;
  check("Users.Promote persisted (is_admin=true)", prom === true);
  const hasDemote = await page.evaluate((n) => { const row = [...document.querySelectorAll(".admin-content .admin-row")].find((x) => x.textContent.includes(n)); return !!(row && [...row.querySelectorAll("button")].some((b) => b.textContent.trim() === "Demote")); }, studentName);
  check("Users.Promote refreshed row (now shows Demote)", hasDemote);
  check("Users.Promote showed a notice", a.notice.length > 0, a.notice);

  /* G8: the first destructive action must really have been challenged and
     re-run after a step-up — 403, then stepUp 200, then the action 200. */
  const setAdminRes = adminLog.filter((x) => x.dir === "res" && x.action === "users.setAdmin").map((x) => x.status);
  check(
    "G8 destructive action required step-up (403 -> stepUp 200 -> action 200)",
    setAdminRes[0] === 403 && adminLog.some((x) => x.dir === "res" && x.action === "stepUp" && x.status === 200) && setAdminRes[setAdminRes.length - 1] === 200,
    `setAdmin statuses=${setAdminRes.join(",")} stepUp=${adminLog.some((x) => x.action === "stepUp")}`,
  );

  a = await act(studentName, "Demote");
  prom = (await adminC.admin("users.get", { id: studentId })).json?.user?.is_admin;
  check("Users.Demote persisted (is_admin=false)", prom === false);
  check("Users.Demote showed a notice", a.notice.length > 0, a.notice);

  a = await act(studentName, "Revoke");
  const sess = (await adminC.admin("sessions.list", { userId: studentId })).json?.sessions ?? [];
  check("Users.Revoke persisted (0 sessions)", sess.length === 0, `sessions=${sess.length}`);
  check("Users.Revoke showed a notice", a.notice.length > 0, a.notice);

  a = await act(studentName, "Reset pw");
  const oldLogin = await owner2.req("POST", "/api/auth/login", { username: studentName, password: pass });
  check("Users.Reset pw persisted (old password rejected)", oldLogin.status === 401, `login=${oldLogin.status}`);

  /* ---- Quizzes ---- */
  await goTab("Quizzes");
  a = await act("Gauntlet Probe Quiz", "Delete");
  const quizzes = (await adminC.admin("quizzes.list", { classId: cls.id })).json?.quizzes ?? [];
  check("Quizzes.Delete persisted (gone)", !quizzes.some((q) => q.id === quizId), `found=${a.found} hit=${a.hit}`);
  check("Quizzes.Delete showed a notice", a.notice.length > 0, a.notice);

  /* ---- Results ---- */
  await goTab("Results");
  a = await act("Gauntlet Probe", "Delete");
  const results = (await adminC.admin("results.list", { classId: cls.id })).json?.results ?? [];
  check("Results.Delete persisted (gone)", !results.some((x) => x.id === resultId));
  check("Results.Delete showed a notice", a.notice.length > 0, a.notice);

  /* ---- Sessions ---- */
  await goTab("Sessions");
  a = await act(ownerName, "Revoke user");
  const ownerSess = (await adminC.admin("sessions.list", { userId: ownerId })).json?.sessions ?? [];
  check("Sessions.Revoke user persisted (0 sessions)", ownerSess.length === 0, `sessions=${ownerSess.length}`);
  check("Sessions.Revoke user showed a notice", a.notice.length > 0, a.notice);

  /* ---- Classes ---- */
  await goTab("Classes");
  a = await act(`Gauntlet Class ${tag}`, "Clear results");
  check("Classes.Clear results showed a notice", a.notice.length > 0, a.notice);

  a = await act(`Gauntlet Class ${tag}`, "Delete");
  const classes = (await adminC.admin("classes.list")).json?.classes ?? [];
  check("Classes.Delete persisted (gone)", !classes.some((c) => c.id === cls.id), `found=${a.found} hit=${a.hit}`);
  check("Classes.Delete showed a notice", a.notice.length > 0, a.notice);
  cls = null; // already gone

  /* ---- Users: Delete + G6 single round-trip + G7 optimistic removal ---- */
  await goTab("Users");
  const beforeDel = await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => []);
  await setAdminDelay(1500);
  const hit = await clickRowButton(studentName, "Delete");
  for (let i = 0; i < 40 && !(await modalOpen()); i++) await sleep(50);
  const labels = await page.$$eval(".admin-modal .sticker-btn", (els) => els.map((e) => e.textContent.trim())).catch(() => []);
  const t0 = Date.now();
  const btns = await page.$$(".admin-modal .sticker-btn");
  await btns[labels.indexOf("CONFIRM")].click();
  let goneMs = -1;
  for (let i = 0; i < 60; i++) {
    const present = await page.evaluate((n) => [...document.querySelectorAll(".admin-content .admin-row")].some((r) => r.textContent.includes(n)), studentName);
    if (!present) { goneMs = Date.now() - t0; break; }
    await sleep(20);
  }
  check("G7 optimistic row removal before reply (API delayed 1500ms)", hit.found && goneMs >= 0 && goneMs < 250, `gone=${goneMs}ms`);
  // switch tabs while the delete is still in flight: the panel must not strand
  // "Loading…" and must render the newly selected tab once the action settles
  const classesTab = await page.$$eval(".admin-tabs .sticker-btn", (els) => els.map((e) => e.textContent.trim()));
  const tabBtns = await page.$$(".admin-tabs .sticker-btn");
  await tabBtns[classesTab.indexOf("Classes")].click();
  let delNotice = "";
  let noticeMs = -1;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const now = await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => []);
    const fresh = now.filter((x) => !beforeDel.includes(x));
    if (fresh.some((x) => /deleted/i.test(x))) { delNotice = fresh.join(" | "); noticeMs = Date.now() - t0; break; }
  }
  await setAdminDelay(0);
  let classTabShown = false;
  for (let i = 0; i < 40; i++) {
    classTabShown = await page.$eval(".admin-content", (e) => e.textContent.includes("Classes") && !e.textContent.includes("Loading…")).catch(() => false);
    if (classTabShown) break;
    await sleep(250);
  }
  check("tab switch during a pending action still renders (no stranded Loading…)", classTabShown);
  // count only this action's requests so the extra list fetch can't skew G6
  const deleteReqs = adminLog.filter((x) => x.dir === "req" && x.action === "users.delete").length;
  check("G7 reply really was delayed (notice arrived after the optimistic update)", noticeMs > 1000, `notice=${noticeMs}ms`);
  check("G6 Users.Delete is a single round-trip", deleteReqs === 1, `reqs=${deleteReqs}`);
  const users = (await adminC.admin("users.list", { query: studentName })).json?.users ?? [];
  check("Users.Delete persisted (gone)", users.length === 0);
  check("Users.Delete showed a notice", delNotice.length > 0, delNotice);
  studentId = null;

  // first destructive action legitimately includes the step-up exchange; every
  // action after it must be exactly one /api/admin round-trip
  check(
    "G6 every post-step-up action is one round-trip",
    actReqs.slice(1).every((x) => x.reqs === 1),
    actReqs.map((x) => `${x.btnText}=${x.reqs}`).join(","),
  );

  // a 403 on /api/admin is the expected step-up challenge, not an app fault
  const expectedChallenge = (s) => /Failed to load resource/.test(s) && /(401|403)/.test(s);
  check("UI: zero page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("UI: zero unexpected console errors", consoleErrors.filter((s) => !expectedChallenge(s)).length === 0, consoleErrors.filter((s) => !expectedChallenge(s)).join(" | "));
}

let setupOk = false;
try {
  await adminCLogin();
  await preClean();
  await setupFixtures();
  setupOk = true;
  await runUI();
} catch (e) {
  check("harness completed without throwing", false, String(e).slice(0, 200));
  console.error(e);
} finally {
  await cleanup();
  await browser.close();
  await sleep(300);
}

console.log(fails ? `\n${fails} ADMIN E2E FAILURES` : "\nADMIN E2E PASS");
process.exit(fails ? 1 : 0);