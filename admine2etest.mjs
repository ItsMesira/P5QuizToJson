/* admine2etest.mjs — Gauntlet gates G3 + G4 + G5.
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
async function act(rowText, btnText) {
  const before = await page.$$eval(".admin-notice", (els) => els.map((e) => e.textContent)).catch(() => []);
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
  return { ...r, notice };
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

  /* ---- Users: Delete ---- */
  await goTab("Users");
  a = await act(studentName, "Delete");
  const users = (await adminC.admin("users.list", { query: studentName })).json?.users ?? [];
  check("Users.Delete persisted (gone)", users.length === 0);
  check("Users.Delete showed a notice", a.notice.length > 0, a.notice);
  studentId = null;

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