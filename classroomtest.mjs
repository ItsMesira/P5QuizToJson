/* classroomtest.mjs — classroom revamp gates: the dashboard PINNED+RECENT hub,
   the #class-library screen (search/sort/paging/pin/bulk delete), the in-class
   add dialog, the class switcher, and teacher/student permissions. Throwaway
   fixtures only; cleans up after.

   Run:  P5Q_BASE=http://localhost:3011 node classroomtest.mjs            */
import puppeteer from "puppeteer-core";
import { randomBytes } from "node:crypto";

const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const HOST = new URL(BASE).hostname;
const CHROME = process.env.P5Q_CHROME ?? "/Users/blue/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };
const randIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

class Client {
  constructor() { this.cookies = {}; this.xff = randIp(); }
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
if (!cls?.id) { console.log("ABORT: no class fixture — cannot continue"); process.exit(1); }
const rs = await student.req("POST", "/api/auth/register", { username: `ct_student_${tag}`, password: pass });
await student.req("POST", "/api/classes/join", { code: cls.code });
check("fixture: student joined", !!rs.json?.session?.user?.id);

/* 30 posts would trip the 20/min per-IP quiz limit — rotate x-forwarded-for. */
let seededOk = true;
for (let i = 1; i <= 30; i++) {
  owner.xff = randIp();
  const q = quizJson(i);
  const r = await owner.req("POST", `/api/classes/${cls.id}/quizzes`, { title: q.title, quiz: q });
  if (r.status !== 200) { check(`fixture: seed quiz ${i}`, false, `status ${r.status}`); seededOk = false; break; }
}
owner.xff = randIp();
const seeded = (await owner.req("GET", `/api/classes/${cls.id}/quizzes?limit=60`)).json;
check("fixture: 30 quizzes seeded", seededOk && seeded?.total === 30, `server total=${seeded?.total}`);

/* ---- browser ---- */
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

const actAs = async (client) => {
  for (const [name, value] of Object.entries(client.cookies)) {
    await page.setCookie({ name, value, domain: HOST, path: "/" });
  }
};
const cards = (sel) => page.$$eval(sel, (els) => els.length).catch(() => -1);
const waitForCount = async (sel, n, timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await cards(sel)) === n) return true;
    await sleep(150);
  }
  return false;
};
const waitForFn = (fn, timeout, ...args) => page.waitForFunction(fn, { timeout }, ...args).then(() => true).catch(() => false);

/* ---- hub ---- */
await actAs(owner);
await page.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
const recent6 = await waitForFn(() => document.querySelectorAll('.dash-hub-section[data-hub="recent"] .qcard').length === 6, 30000);
check("hub: recent section shows exactly 6 cards", recent6, `cards=${await cards('.dash-hub-section[data-hub="recent"] .qcard')}`);
const viewAll30 = await waitForFn(() => /\(30\)/.test(document.querySelector(".dash-viewall")?.textContent ?? ""), 20000);
const viewAllText = await page.$eval(".dash-viewall", (el) => el.textContent ?? "").catch(() => "");
check("hub: VIEW ALL announces the full 30", viewAll30 && viewAllText.includes("30"), viewAllText);

/* ---- add dialog ---- */
await page.click(".dash-add");
const modalOpen = await waitForFn(() => !document.querySelector(".dash-add-modal")?.classList.contains("hidden"), 5000);
check("add: dialog opens", modalOpen);
await page.$eval(".dash-add-area", (el) => { el.value = "{ not json"; });
await page.click(".dash-add-submit");
const errOpen = await waitForFn(() => document.querySelector(".dash-add-error")?.classList.contains("open"), 5000);
check("add: invalid JSON shows .dash-add-error.open", errOpen);

const added = { ...quizJson(31), title: `Probe 31 ${tag}` };
await page.$eval(".dash-add-area", (el, json) => { el.value = json; }, JSON.stringify(added));
await page.click(".dash-add-submit");
const closed = await waitForFn(() => document.querySelector(".dash-add-modal")?.classList.contains("hidden"), 20000);
check("add: dialog closes on success", closed);
const grew31 = await waitForFn(() => /\(31\)/.test(document.querySelector(".dash-viewall")?.textContent ?? ""), 20000);
const viewAll31 = await page.$eval(".dash-viewall", (el) => el.textContent ?? "").catch(() => "");
check("add: hub total grows to 31", grew31 && viewAll31.includes("31"), viewAll31);
const inHub = await waitForFn((title) => [...document.querySelectorAll('.dash-hub-section[data-hub="recent"] .qcard-title')].some((el) => el.textContent === title), 20000, added.title);
check("add: new card appears in the recent hub", inHub, added.title);
const afterAdd = (await owner.req("GET", `/api/classes/${cls.id}/quizzes?limit=60`)).json;
check("add: persisted server-side", afterAdd?.total === 31 && (afterAdd?.quizzes ?? []).some((q) => q.title === added.title), `server total=${afterAdd?.total}`);

/* ---- class library ---- */
await page.click(".dash-viewall");
const hashOk = await waitForFn(() => location.hash === "#class-library", 10000);
check("library: VIEW ALL routes to #class-library", hashOk, await page.evaluate(() => location.hash));
const lib24 = await waitForCount(".clib-grid .qcard", 24);
check("library: page 1 renders 24 cards", lib24, `cards=${await cards(".clib-grid .qcard")}`);
const showing31 = await waitForFn(() => (document.querySelector(".clib-showing")?.textContent ?? "").includes("of 31"), 20000);
const showingText = await page.$eval(".clib-showing", (el) => el.textContent ?? "").catch(() => "");
check("library: pager announces 1–24 of 31", showing31, showingText);
const prevDisabled = await page.$eval(".clib-prev", (el) => el.disabled).catch(() => null);
check("library: prev is disabled on page 1", prevDisabled === true, `disabled=${prevDisabled}`);
await page.click(".clib-next");
const lib7 = await waitForCount(".clib-grid .qcard", 7);
check("library: next shows the remaining 7", lib7, `cards=${await cards(".clib-grid .qcard")}`);
const showingPage2 = await page.$eval(".clib-showing", (el) => el.textContent ?? "").catch(() => "");
check("library: page 2 still of 31", showingPage2.includes("of 31"), showingPage2);
await page.click(".clib-prev");
await waitForCount(".clib-grid .qcard", 24);

await page.type(".clib-search", "Probe 07");
const searchOne = await waitForCount(".clib-grid .qcard", 1, 15000);
const searchTitle = await page.$eval(".clib-grid .qcard-title", (el) => el.textContent ?? "").catch(() => "");
check("library: search narrows to Probe 07", searchOne && searchTitle === "Probe 07", `cards=${await cards(".clib-grid .qcard")} first=${searchTitle}`);
await page.$eval(".clib-search", (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
const restored = await waitForCount(".clib-grid .qcard", 24, 15000);
check("library: clearing search restores 24", restored, `cards=${await cards(".clib-grid .qcard")}`);

await page.click('.clib-sort[data-sort="title"]');
const sorted = await waitForFn(() => document.querySelector(".clib-grid .qcard-title")?.textContent === "Probe 01", 15000);
const firstTitle = await page.$eval(".clib-grid .qcard-title", (el) => el.textContent ?? "").catch(() => "");
check("library: A–Z sort puts Probe 01 first", sorted && firstTitle === "Probe 01", firstTitle);
const activeMoved = await page.$eval('.clib-sort[data-sort="title"]', (el) => el.classList.contains("active")).catch(() => false);
const newestOff = await page.$eval('.clib-sort[data-sort="newest"]', (el) => !el.classList.contains("active")).catch(() => false);
check("library: .active chip moves to A–Z", activeMoved && newestOff);

/* ---- pin (teacher) ---- */
const pinQid = await page.$eval(".clib-grid .qcard", (el) => el.getAttribute("data-qid"));
await page.click(".clib-grid .qcard-pin");
const pinnedLocally = await waitForFn((qid) => document.querySelector(`.clib-grid .qcard[data-qid="${qid}"]`)?.classList.contains("pinned"), 15000, pinQid);
const pressed = await page.$eval(`.clib-grid .qcard[data-qid="${pinQid}"] .qcard-pin`, (el) => el.getAttribute("aria-pressed")).catch(() => "");
check("pin: library card flips to .pinned", pinnedLocally && pressed === "true", `qid=${pinQid} aria-pressed=${pressed}`);
const afterPin = (await owner.req("GET", `/api/classes/${cls.id}/quizzes?limit=60`)).json;
const pinRow = (afterPin?.quizzes ?? []).find((q) => q.id === pinQid);
check("pin: server reports pinned:true", pinRow?.pinned === true, `pinned=${pinRow?.pinned}`);
await page.evaluate(() => { location.hash = "#dashboard"; });
const pinnedHub = await waitForFn((qid) => !!document.querySelector(`.dash-hub-section[data-hub="pinned"] .qcard[data-qid="${qid}"]`), 30000, pinQid);
check("pin: dashboard PINNED hub shows the card", pinnedHub);

/* ---- student (cookie swap + reload) ---- */
await actAs(student);
await page.evaluate(() => { location.hash = "#class-library"; });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".clib-grid .qcard", { timeout: 30000 }).catch(() => undefined);
const studentCards = await cards(".clib-grid .qcard");
check("student: sees the library grid", studentCards === 24, `cards=${studentCards}`);
const studentToggle = await cards(".clib-select-toggle");
const studentActions = await cards(".clib-grid .qcard-pin, .clib-grid .qcard-del");
check("student: no select toggle", studentToggle === 0, `found ${studentToggle}`);
check("student: no pin/delete controls", studentActions === 0, `found ${studentActions}`);

/* ---- teacher bulk delete ---- */
await actAs(owner);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".clib-grid .qcard", { timeout: 30000 }).catch(() => undefined);
const beforeBulk = (await owner.req("GET", `/api/classes/${cls.id}/quizzes?limit=60`)).json?.total ?? 0;
await page.click(".clib-select-toggle");
await page.waitForSelector(".clib-bulk:not(.hidden)", { timeout: 5000 }).catch(() => undefined);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".clib-grid .qcard")];
  cards[0]?.click();
  cards[1]?.click();
});
const twoSelected = await waitForFn(() => document.querySelectorAll(".clib-grid .qcard.selected").length === 2, 5000);
const bulkText = await page.$eval(".clib-bulk-count", (el) => el.textContent ?? "").catch(() => "");
check("bulk: select mode marks 2 cards", twoSelected, `selected=${await cards(".clib-grid .qcard.selected")} bulk="${bulkText}"`);
await page.click(".clib-bulk-del");
let afterBulk = beforeBulk;
for (let i = 0; i < 60; i++) {
  afterBulk = (await owner.req("GET", `/api/classes/${cls.id}/quizzes?limit=60`)).json?.total ?? afterBulk;
  if (afterBulk === beforeBulk - 2) break;
  await sleep(300);
}
check("bulk: server count drops by 2", afterBulk === beforeBulk - 2, `${beforeBulk} → ${afterBulk}`);

/* ---- class switcher ---- */
const cls2 = (await owner.req("POST", "/api/classes/create", { name: `Second Class ${tag}` })).json?.cls;
check("switcher: second class created", !!cls2?.id, cls2?.code ?? "");
await owner.req("POST", "/api/classes/mine", { classId: cls.id }); // keep the populated class active
await page.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
const switchBtn = await waitForFn(() => {
  const b = document.querySelector(".dash-switcher-btn");
  return !!b && b.getBoundingClientRect().width > 0;
}, 20000);
const switchText = await page.$eval(".dash-switcher-btn", (el) => el.textContent ?? "").catch(() => "");
check("switcher: button visible with 2 classes", switchBtn, switchText);
await page.click(".dash-switcher-btn");
await page.waitForSelector(".dash-switcher-menu:not(.hidden)", { timeout: 5000 }).catch(() => undefined);
await page.click(`.dash-switcher-item[data-id="${cls2.id}"]`);
const switched = await waitForFn((name) => document.querySelector(".dash-classname")?.textContent === name, 20000, cls2.name);
check("switcher: dashboard remounts on the other class", switched, await page.$eval(".dash-classname", (el) => el.textContent ?? "").catch(() => ""));
const meAfter = (await owner.req("GET", "/api/auth/me")).json;
check("switcher: server session follows the switch", meAfter?.session?.cls?.id === cls2.id, `cls=${meAfter?.session?.cls?.id}`);
await page.evaluate(() => { location.hash = "#class-library"; });
const zeroLib = await waitForFn(() => (document.querySelector(".clib-count")?.textContent ?? "").includes("0"), 20000);
const zeroCards = await cards(".clib-grid .qcard");
check("switcher: library lists the other class (0 quizzes)", zeroLib && zeroCards === 0, `count=${await page.$eval(".clib-count", (el) => el.textContent ?? "").catch(() => "")} cards=${zeroCards}`);

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

/* ---- cleanup (account delete cascades classes/members/quizzes) ---- */
await student.req("DELETE", "/api/auth/me");
await owner.req("DELETE", "/api/auth/me");
const gone = await owner.req("GET", "/api/auth/me");
const goneStudent = await student.req("GET", "/api/auth/me");
check("cleanup: throwaway accounts gone", gone.status === 401 && goneStudent.status === 401, `owner=${gone.status} student=${goneStudent.status}`);

await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
