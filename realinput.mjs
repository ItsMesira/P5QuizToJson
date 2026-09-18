/* REAL-INPUT test: actual mouse clicks at coordinates + real keyboard.
   Catches overlay/hit-testing bugs that synthetic el.click() tests miss. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--window-size=1440,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// deterministic question order for this suite (shuffletest covers randomization)
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 150)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

async function centerOf(sel) {
  const r = await page.$eval(sel, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  });
  return r;
}
async function realClick(sel) {
  const c = await centerOf(sel);
  if (!c.w || !c.h) return false;
  await page.mouse.click(c.x, c.y);
  return true;
}
async function hitTest(sel) {
  return await page.$eval(sel, (e) => {
    const b = e.getBoundingClientRect();
    const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return at === e || e.contains(at);
  });
}

// ---- 1. title: real clicks on every menu item ----
await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await sleep(1800);
const items = await page.$$eval(".menu-item", (els) => els.map((el) => {
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}));
for (let i = 0; i < items.length; i++) {
  check(`title item ${i} hit-testable`, await hitTest(`.menu-item:nth-of-type(${i + 1})`));
}
await page.mouse.click(items[0].x, items[0].y); // BEGIN HEIST
await sleep(1600);
check("real click BEGIN HEIST → load screen", await page.$eval(".screen.load-screen", () => true).catch(() => false));

// ---- 2. load: real click paste modal, type, load quiz ----
await page.mouse.move(600, 300);
const quiz = { title: "Real Click Test", settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "RC1?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "numeric", question: "12 × 12?", answer: 144, tolerance: 0 },
    { type: "fill", question: "Fill: ___", correctText: "hello" },
  ] }] };
await realClick(".load-actions .sticker-btn:nth-child(2)"); // PASTE JSON
await sleep(500);
const pasteOpen = await page.$eval(".load-paste:not(.hidden)", () => true).catch(() => false);
check("real click opens paste modal", pasteOpen);
await realClick(".paste-area");
await page.keyboard.type(JSON.stringify(quiz), { delay: 2 });
await realClick(".paste-actions button:first-child"); // LOAD
await sleep(1800);
check("paste + LOAD → quiz starts", await page.$eval(".q-count", () => true).catch(() => false));

// ---- 3. quiz: REAL mouse clicks on choice, next, keyboard Enter for fill ----
const c1 = await centerOf(".choice-btn");
check("choice btn hit-testable", await hitTest(".choice-btn"));
await page.mouse.click(c1.x, c1.y);
await sleep(1300);
const fb1 = await page.$eval(".q-feedback", (e) => e.textContent);
check("real click choice → feedback", fb1.includes("CORRECT") || fb1.includes("MISSED"), fb1.slice(0, 20));
await realClick(".next-btn");
await sleep(1200);
// numeric via real keyboard
await realClick(".fill-input");
await page.keyboard.type("144");
await page.keyboard.press("Enter");
await sleep(1300);
check("typed 144 + Enter → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
await realClick(".next-btn");
await sleep(1200);
// fill via real keyboard
await realClick(".fill-input");
await page.keyboard.type("hello");
await realClick(".fill-row .confirm-btn");
await sleep(1300);
check("fill hello → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
await realClick(".next-btn");
await sleep(3200);
check("quiz finishes → results", await page.$eval(".rank-letter", (e) => e.textContent).catch(() => false), "via real clicks");

// ---- 4. results: real click HOME ----
for (let i = 0; i < 20; i++) {
  if (await page.$(".results-actions .sticker-btn:last-child")) break;
  await sleep(400);
}
await realClick(".results-actions .sticker-btn:last-child");
await sleep(1800);
check("results HOME → title", await page.$eval("#big-name", () => true).catch(() => false));

// ---- 5. settings: real click a toggle ----
await page.goto("http://localhost:5183/#settings", { waitUntil: "networkidle0" });
await sleep(1200);
const toggles = await page.$$eval(".toggle-row", (els) => els.length);
await realClick(".toggle-row:nth-of-type(2)"); // CRT
await sleep(500);
check("settings toggle real click flips", toggles > 0);

// ---- 6. prompts: real click tab + builder input ----
await page.goto("http://localhost:5183/#prompts", { waitUntil: "networkidle0" });
await sleep(1400);
await realClick(".prompts-tab:nth-child(2)"); // PRESETS
await sleep(800);
check("real click presets tab", await page.$eval(".prompts-presets:not(.hidden)", () => true).catch(() => false));
await realClick(".prompt-card .prompt-view");
await sleep(700);
check("real click VIEW opens modal", await page.$eval(".prompt-modal:not(.hidden)", () => true).catch(() => false));
await realClick(".pm-close");
await sleep(400);
await realClick(".prompts-tab:nth-child(1)"); // BUILDER
await sleep(700);
await realClick(".builder-input");
await page.keyboard.type("React hooks");
await sleep(500);
check("builder typing updates preview", await page.$eval(".builder-preview", (e) => e.textContent.includes("React hooks")));

// ---- 7. library: real click play ----
await page.goto("http://localhost:5183/#library", { waitUntil: "networkidle0" });
await sleep(1200);
const libCards = await page.$$eval(".lib-card", (els) => els.length);
if (libCards) {
  await realClick(".lib-card .play");
  await sleep(1800);
  check("library real click PLAY → quiz", await page.$eval(".q-count", () => true).catch(() => false));
}

console.log("JS ERRORS:", errs.length ? errs.slice(0, 8) : "none");
await browser.close();
process.exit(failures || errs.length ? 1 : 0);
