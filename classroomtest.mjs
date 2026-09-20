/* classroomtest.mjs — classroom revamp gates: shelf tools (search/sort/pager,
   12-per-page), in-classroom add dialog (paste), server persistence re-read,
   visible errors, teacher delete. Throwaway fixtures only; cleans up after.

   Run:  P5Q_BASE=http://localhost:3011 node classroomtest.mjs            */
import puppeteer from "puppeteer-core";
import { randomBytes } from "node:crypto";

const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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
}

const quizJson = (n) => ({
  title: `Probe ${String(n).padStart(2, "0")}`,
  sections: [{ name: "S1", questions: [{ type: "multiple", question: `What is ${n}+1?`, answers: [{ text: "2", correct: true }, { text: "3", correct: false }] }] }],
});

const tag = randomBytes(3).toString("hex");
const pass = "Gauntlet123";
const owner = new Client();
const student = new Client();
let cls = null;

/* ---- fixtures ---- */
const ro = await owner.req("POST", "/api/auth/register", { username: `ct_owner_${tag}`, password: pass });
check("fixture: owner registered", !!ro.json?.session, `${ro.status}`);
cls = (await owner.req("POST", "/api/classes/create", { name: `Classroom Test ${tag}` })).json?.cls;
check("fixture: class created", !!cls?.id, cls?.code ?? "");
const rs = await student.req("POST", "/api/auth/register", { username: `ct_student_${tag}`, password: pass });
await student.req("POST", "/api/classes/join", { code: cls.code });
const studentId = rs.json?.session?.user?.id;
check("fixture: student joined", !!studentId);

for (let i = 1; i <= 15; i++) {
  const q = quizJson(i);
  const r = await owner.req("POST", `/api/classes/${cls.id}/quizzes`, { title: q.title, quiz: q });
  if (r.status !== 200) { check(`fixture: seed quiz ${i}`, false, `status ${r.status}`); break; }
}
const seeded = (await owner.req("GET", `/api/classes/${cls.id}/quizzes`)).json?.quizzes ?? [];
check("fixture: 15 quizzes seeded", seeded.length === 15, `got ${seeded.length}`);

/* ---- browser ---- */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

for (const [name, value] of Object.entries(owner.cookies)) {
  await page.setCookie({ name, value, domain: "localhost", path: "/" });
}
await page.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".dash-quiz", { timeout: 15000 }).catch(() => undefined);

const count = () => page.$$eval(".dash-quiz", (els) => els.length);
const pagerText = () => page.$eval(".dash-pager", (el) => el.textContent ?? "").catch(() => "");

check("shelf: first page shows 12 of 15", (await count()) === 12, `cards=${await count()}`);
check("shelf: pager announces 1–12 of 15", (await pagerText()).includes("1–12 of 15"), await pagerText());

await page.click(".dash-page-next");
await sleep(150);
check("shelf: page 2 shows the remaining 3", (await count()) === 3, `cards=${await count()}`);
await page.click(".dash-page-prev");

await page.type(".dash-search", "Probe 07");
await sleep(150);
check("shelf: search narrows to 1", (await count()) === 1, `cards=${await count()}`);
await page.$eval(".dash-search", (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
await sleep(150);
check("shelf: clearing search restores 12", (await count()) === 12, `cards=${await count()}`);

await page.select(".dash-sort", "title");
await sleep(150);
const firstTitle = await page.$eval(".dash-quiz-title", (el) => el.textContent ?? "");
check("shelf: A–Z sort puts Probe 01 first", firstTitle === "Probe 01", firstTitle);
await page.select(".dash-sort", "newest");

/* error path: invalid JSON stays visible */
await page.click(".dash-add");
await page.waitForSelector(".dash-add-modal:not(.hidden)", { timeout: 5000 });
await page.$eval(".dash-add-area", (el) => { el.value = "{ not json"; });
await page.click(".dash-add-submit");
await sleep(200);
check("add: invalid JSON shows an error", await page.$eval(".dash-add-error", (el) => el.classList.contains("open")));

/* happy path: paste adds, persists, appears without reload */
const added = { ...quizJson(99), title: `Probe 99 ${tag}` };
await page.$eval(".dash-add-area", (el, json) => { el.value = json; }, JSON.stringify(added));
await page.click(".dash-add-submit");
await sleep(600);
check("add: dialog closes on success", await page.$eval(".dash-add-modal", (el) => el.classList.contains("hidden")));
check("add: shelf count grows to 16", (await pagerText()).includes("of 16"), await pagerText());

const after = (await owner.req("GET", `/api/classes/${cls.id}/quizzes`)).json?.quizzes ?? [];
check("add: persisted server-side", after.some((q) => q.title === added.title), `server has ${after.length}`);

/* student may also add (server rule unchanged, UI reachable) */
for (const [name, value] of Object.entries(student.cookies)) {
  await page.setCookie({ name, value, domain: "localhost", path: "/" });
}
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".dash-quiz", { timeout: 15000 }).catch(() => undefined);
const studentSeesDelete = await page.$$eval(".dash-quiz-del", (els) => els.length);
check("permissions: student sees no delete buttons", studentSeesDelete === 0, `found ${studentSeesDelete}`);
await page.click(".dash-add");
await page.waitForSelector(".dash-add-modal:not(.hidden)", { timeout: 5000 });
const sAdded = { ...quizJson(98), title: `Probe 98 ${tag}` };
await page.$eval(".dash-add-area", (el, json) => { el.value = json; }, JSON.stringify(sAdded));
await page.click(".dash-add-submit");
await sleep(600);
const afterStudent = (await student.req("GET", `/api/classes/${cls.id}/quizzes`)).json?.quizzes ?? [];
check("permissions: student add persisted", afterStudent.some((q) => q.title === sAdded.title), `server has ${afterStudent.length}`);

/* teacher delete removes a card and the row */
for (const [name, value] of Object.entries(owner.cookies)) {
  await page.setCookie({ name, value, domain: "localhost", path: "/" });
}
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".dash-quiz-del", { timeout: 15000 }).catch(() => undefined);
await page.click(".dash-quiz-del");
await sleep(600);
const afterDelete = (await owner.req("GET", `/api/classes/${cls.id}/quizzes`)).json?.quizzes ?? [];
check("delete: teacher removes a quiz", afterDelete.length === afterStudent.length - 1, `server has ${afterDelete.length}`);

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

/* ---- cleanup (account delete cascades classes/members/quizzes) ---- */
await student.req("DELETE", "/api/auth/me");
await owner.req("DELETE", "/api/auth/me");
const gone = await owner.req("GET", "/api/auth/me");
check("cleanup: throwaway account gone", gone.status === 401, `status ${gone.status}`);

await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
