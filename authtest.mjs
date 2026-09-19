/* Classroom/auth e2e test.
   Requires: `vercel dev` running (or any host serving the app + /api),
   plus a real DATABASE_URL. Skips gracefully when the API is unreachable. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.P5Q_BASE ?? "http://localhost:3000";

let r;
try {
  r = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
} catch {
  console.log("SKIP: API not reachable — start `vercel dev` or `node devapi.mjs` with DATABASE_URL set.");
  process.exit(0);
}
if (r.status >= 500) {
  console.log(`SKIP: API unhealthy (${r.status}) — check DATABASE_URL and server logs.`);
  process.exit(0);
}
/* 401 here is EXPECTED (anonymous probe) — the API is alive. */

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const watchPage = (p, tag) => {
  p.on("response", (res) => {
    const u = res.url();
    if (/api\/(classes|auth)\//.test(u)) {
      console.log(`[${tag} req] ${res.request().method()} ${u.replace(/https?:\/\/[^/]+/, "")} -> ${res.status()}`);
    }
  });
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[${tag} console ${m.type()}]`, m.text().slice(0, 300));
  });
  p.on("pageerror", (e) => console.log(`[${tag} pageerror]`, e.message.slice(0, 300)));
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* poll-based waits: remote DB latency must never flake the suite */
const waitFor = async (page, sel, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.$(sel)) return true;
    await sleep(250);
  }
  return false;
};
const waitForNot = async (page, sel, text, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await page.$eval(sel, (e) => e.textContent ?? "").catch(() => null);
    if (v !== null && !v.includes(text)) return true;
    await sleep(250);
  }
  return false;
};
const tryRegister = async (page, label) => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const btn = await page.$(".entry-register");
    if (btn) await btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (await page.$eval(".dashboard-screen", () => true).catch(() => false)) return true;
      if (!(await page.$(".entry-register"))) {
        /* page left the entry screen mid-poll — give the dashboard a beat */
        await sleep(1500);
        return await page.$eval(".dashboard-screen", () => true).catch(() => false);
      }
      await sleep(300);
    }
    if (attempt === 1) {
      console.log(`  (${label} register likely rate-limited — waiting 65s and retrying)`);
      await sleep(65000);
    }
  }
  return false;
};

let fails = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

const suffix = Date.now().toString(36).slice(-6);
const teacher = `teacher_${suffix}`;
const student = `student_${suffix}`;

// ---- teacher: make a class ----
const t1 = await browser.newPage();
watchPage(t1, "teacher");
await t1.goto(`${BASE}/#entry`, { waitUntil: "networkidle0" });
await sleep(1600);
check("entry screen shows", await t1.$eval(".entry-screen", () => true).catch(() => false));
// MAKE A CLASS → name → CREATE ACCOUNT
await t1.evaluate(() => [...document.querySelectorAll(".entry-btn")].find((b) => b.textContent.includes("MAKE A CLASS")).click());
await sleep(700);
await t1.click(".entry-form input");
await t1.type(".entry-form input", "Test Class 101");
await t1.evaluate(() => document.querySelector(".entry-next").click());
await sleep(700);
await t1.click(".entry-form input");
await t1.type(".entry-form input", teacher);
const passInputs = await t1.$$(".entry-form input");
await passInputs[2].click();
await passInputs[2].type("Heist#2026pass");
check("teacher lands in dashboard", await tryRegister(t1, "teacher"));
const code = await t1.$eval(".dash-code-value", (e) => e.textContent.trim()).catch(() => null);
if (!code) {
  console.log("ABORT: no class code — teacher dashboard missing class; can't run student flow.");
  await browser.close();
  process.exit(1);
}
check("class code shown", /^[A-Z0-9]{4,8}$/.test(code ?? ""), code);
check("class badge visible", await t1.$eval("#class-badge:not(.hidden)", () => true).catch(() => false));

// teacher adds a quiz from the device flow (load → paste)
await t1.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
await sleep(1200);
await t1.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await t1.click(".paste-area");
const quiz = { title: `Cloud Quiz ${suffix}`, sections: [{ name: "S", questions: [{ type: "boolean", question: "C?", answers: [{ text: "True", correct: true }, { text: "False" }] }] }] };
await t1.type(".paste-area", JSON.stringify(quiz));
await t1.evaluate(() => document.querySelectorAll(".load-paste .paste-actions button")[0].click());
await waitFor(t1, ".q-count", 10000);
check("quiz loads", await t1.$eval(".q-count", () => true).catch(() => false));

// ---- student: join-first flow ----
const s1 = await browser.newPage();
watchPage(s1, "student");
await s1.goto(`${BASE}/#entry`, { waitUntil: "networkidle0" });
await sleep(1500);
await s1.evaluate(() => [...document.querySelectorAll(".entry-btn")].find((b) => b.textContent.includes("JOIN A CLASS")).click());
await sleep(700);
await s1.click(".entry-code");
await s1.type(".entry-code", code);
await s1.evaluate(() => document.querySelector(".entry-next").click());
await sleep(700);
// join FIRST, then register (the required order)
const sInputs = await s1.$$(".entry-form input");
await sInputs[0].click();
await sInputs[0].type(student);
await sInputs[2].click();
await sInputs[2].type("Heist#2026pass");
check("student joined via code", await tryRegister(s1, "student"));
check("student sees the class name", await s1.$eval(".dash-classname", (e) => e.textContent.includes("Test Class 101")).catch(() => false));

// class shelf: student sees the teacher's quiz (wait for the fetch to land)
await waitForNot(s1, ".dash-quizzes", "Loading…", 15000);
const shelfTitles = await s1.$$eval(".dash-quiz-title", (els) => els.map((e) => e.textContent));
check("class shelf shows teacher quiz", shelfTitles.includes(`Cloud Quiz ${suffix}`), JSON.stringify(shelfTitles));

// student plays class quiz + submits result
await waitFor(s1, ".dash-quiz-play", 12000);
const playBtn = await s1.$(".dash-quiz-play");
check("class shelf has a playable quiz", !!playBtn);
if (playBtn) await playBtn.click();
await waitFor(s1, ".q-count", 10000);
const plays = !!playBtn && (await s1.$eval(".q-count", () => true).catch(() => false));
check("student plays class quiz", plays);
if (plays) {
  await s1.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "True").click());
  await sleep(1200);
  await s1.evaluate(() => document.querySelector(".next-btn").click());
  await waitFor(s1, ".rank-letter", 15000);
  check("student reaches results", await s1.$eval(".rank-letter", (e) => e.textContent).catch(() => false));
}

// teacher sees student score on dashboard leaderboard
await t1.goto(`${BASE}/#dashboard`, { waitUntil: "networkidle0" });
await waitForNot(t1, ".dash-board", "Loading…", 15000);
const boardText = await t1.$eval(".dash-board", (e) => e.textContent).catch(() => "");
check("teacher sees student score", boardText.includes(student), boardText.slice(0, 60));

// ---- security: routes reject unauthenticated access ----
const anon = await fetch(`${BASE}/api/classes/mine`);
check("auth required (401 without session)", anon.status === 401, String(anon.status));
const anonQuiz = await fetch(`${BASE}/api/classes/${code}/quizzes`);
check("class routes reject anon", anonQuiz.status === 401 || anonQuiz.status === 400, String(anonQuiz.status));

// ---- logout destroys session ----
await s1.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
await waitFor(s1, ".dash-logout", 10000);
await s1.evaluate(() => document.querySelector(".dash-logout").click());
await waitFor(s1, ".entry-screen", 10000);
check("logout → entry screen", await s1.$eval(".entry-screen", () => true).catch(() => false));
const postLogout = await s1.evaluate(async () => {
  const r = await fetch("/api/auth/me", { credentials: "same-origin" });
  return r.status;
});
check("session dead after logout (401)", postLogout === 401, String(postLogout));

console.log(fails ? `${fails} FAILURES` : "ALL CLASSROOM TESTS PASS");
await browser.close();
process.exit(fails ? 1 : 0);
