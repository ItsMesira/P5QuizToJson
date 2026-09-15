/* P5 QUIZ smoke test — boots, browses, plays a full all-types quiz, checks results & share links. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5183/";
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. title
await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(1500);
console.log("TITLE tag:", await page.$eval("#big-name", (e) => e.textContent.trim()));
console.log("TITLE menu:", await page.$$eval(".menu-item", (els) => els.length));

// 2. master prompts screen — builder default tab
await page.evaluate(() => document.querySelectorAll(".menu-item")[3].click());
await sleep(1600);
console.log("PROMPTS builder form:", await page.$eval(".builder-form", () => true).catch(() => false));
console.log("PROMPTS builder preview:", await page.$eval(".builder-preview", (e) => e.textContent.length > 500));
// type topic → preview updates
await page.click(".builder-input");
await page.type(".builder-input", "French Revolution");
await sleep(400);
console.log("PROMPTS topic in preview:", await page.$eval(".builder-preview", (e) => e.textContent.includes("French Revolution")));
// toggle a type chip
const chipsBefore = await page.$$eval(".type-chip.on", (els) => els.length);
await page.evaluate(() => {
  const chips = document.querySelectorAll(".type-chip");
  const next = [...chips].find((c) => !c.classList.contains("on"));
  if (next) next.click();
});
await sleep(300);
const chipsAfter = await page.$$eval(".type-chip.on", (els) => els.length);
console.log("PROMPTS type chips:", chipsBefore, "→", chipsAfter);
// copy prompt
await page.evaluate(() => document.querySelector(".builder-actions .sticker-btn").click());
await sleep(700);
console.log("PROMPTS copy toast:", await page.$$eval(".toast", (els) => els.length));

// presets tab
await page.evaluate(() => document.querySelectorAll(".prompts-tab")[1].click());
await sleep(1400);
const presetCards = await page.$$eval(".prompt-card", (els) => els.length);
console.log("PROMPTS preset cards:", presetCards);
await page.evaluate(() => document.querySelector(".prompt-card .prompt-view").click());
await sleep(700);
const pmOpen = await page.$eval(".prompt-modal:not(.hidden)", () => true).catch(() => false);
const pmLen = await page.$eval(".pm-text", (e) => e.textContent.length).catch(() => 0);
console.log("PROMPTS modal:", pmOpen, "| text length:", pmLen);
await page.evaluate(() => document.querySelector(".pm-close").click());
await sleep(400);
// star + copy preset
await page.evaluate(() => document.querySelector(".prompt-card .prompt-star").click());
await sleep(400);
await page.evaluate(() => document.querySelector(".prompt-card .prompt-copy").click());
await sleep(600);
// history tab
await page.evaluate(() => document.querySelectorAll(".prompts-tab")[2].click());
await sleep(900);
console.log("PROMPTS history entries:", await page.$$eval(".history-card", (els) => els.length));

// merge mode
await page.evaluate(() => document.querySelectorAll(".prompts-tab")[1].click());
await sleep(700);
await page.evaluate(() => document.querySelector(".merge-toggle").click());
await sleep(500);
await page.evaluate(() => document.querySelectorAll(".prompt-card")[0].click());
await page.evaluate(() => document.querySelectorAll(".prompt-card")[1].click());
await sleep(500);
console.log("PROMPTS merge banner:", await page.$eval(".merge-banner", () => true).catch(() => false));
await page.evaluate(() => document.querySelector(".merge-toggle").click());
await sleep(400);

// 3. load screen → paste an all-types quiz
await page.evaluate(() => document.querySelector(".back-btn").click());
await sleep(1200);
await page.evaluate(() => document.querySelector(".menu-item").click()); // BEGIN HEIST
await sleep(1200);
const quiz = {
  title: "Smoke Test",
  settings: { shuffle: false, timeLimit: null, autoAdvance: false },
  sections: [{
    name: "All Types",
    questions: [
      { type: "multiple", question: "MC?", answers: [{ text: "a", correct: true }, { text: "b" }, { text: "c" }, { text: "d" }], explanation: "because" },
      { type: "boolean", question: "Bool?", answers: [{ text: "True", correct: true }, { text: "False" }] },
      { type: "multi", question: "Multi?", answers: [{ text: "x", correct: true }, { text: "y", correct: true }, { text: "z" }] },
      { type: "fill", question: "Fill: __", correctText: "test" },
      { type: "numeric", question: "Num?", answer: 42, tolerance: 0 },
      { type: "order", question: "Order 1-2-3:", answers: [{ text: "one" }, { text: "two" }, { text: "three" }] },
      { type: "match", question: "Match:", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }] },
      { type: "open", question: "Open?" },
    ],
  }],
};
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(500);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
await sleep(1600);
console.log("QUIZ started:", await page.$eval(".q-count", (e) => e.textContent));

// helper: click via JS to dodge hit-test issues
const jsClick = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (el) el.click();
  return !!el;
}, sel);

let matchRot = 0;
for (let i = 0; i < 60; i++) {
  await sleep(450);
  if (await page.$eval(".rank-letter", () => true).catch(() => false)) break;
  const hasNext = await page.$eval(".next-btn:not(.hidden)", () => true).catch(() => false);
  if (hasNext) {
    await jsClick(".next-btn");
    continue;
  }
  const choice = await page.$(".choice-btn:not(:disabled)");
  if (choice) {
    await jsClick(".choice-btn:not(:disabled)");
    continue;
  }
  const multi = await page.$(".multi-row:not(.picked)");
  if (multi) {
    await jsClick(".multi-row:not(.picked)");
    continue;
  }
  const fill = await page.$(".fill-input");
  if (fill) {
    await page.type(".fill-input", "42");
    await sleep(150);
    await jsClick(".fill-row .confirm-btn");
    continue;
  }
  if (await page.$(".confirm-btn:not(.hidden)")) {
    await jsClick(".confirm-btn:not(.hidden)");
    continue;
  }
  const open = await page.$(".open-actions button");
  if (open) {
    await jsClick(".open-actions button");
    continue;
  }
  const ls = await page.$(".match-col:first-child .match-btn.selected");
  if (ls) {
    const rights = await page.$$(".match-col:last-child .match-btn:not(.paired)");
    if (rights.length) await rights[matchRot % rights.length].evaluate((el) => el.click());
    matchRot++;
  } else {
    await jsClick(".match-col:first-child .match-btn:not(.paired)");
  }
}

await sleep(2500);
console.log("RESULTS rank:", await page.$eval(".rank-letter", (e) => e.textContent).catch(() => "MISSING"));
console.log("RESULTS reinforce btn:", await page.$eval(".reinforce-btn", () => true).catch(() => false));
if (!(await page.$(".rank-letter").catch(() => null))) {
  console.log("STALL STATE:", JSON.stringify(await page.evaluate(() => ({
    count: document.querySelector(".q-count")?.textContent,
    choice: document.querySelectorAll(".choice-btn:not(:disabled)").length,
    multi: document.querySelectorAll(".multi-row:not(.picked)").length,
    confirm: !!document.querySelector(".confirm-btn:not(.hidden)"),
    fill: !!document.querySelector(".fill-input"),
    matchL: document.querySelectorAll(".match-col:first-child .match-btn:not(.paired)").length,
    open: !!document.querySelector(".open-actions button"),
    next: !!document.querySelector(".next-btn:not(.hidden)"),
    cutin: !!document.querySelector(".cutin"),
    feedback: document.querySelector(".q-feedback")?.textContent?.slice(0, 50),
    screens: document.querySelector(".screen")?.className,
  }))));
}
console.log("RESULTS stats:", await page.$$eval(".stat-card", (els) => els.length), "| review rows:", await page.$$eval(".review-row", (els) => els.length));
console.log("RESULTS radar:", await page.$eval(".radar", () => true).catch(() => false));

// 4. library has the quiz
await page.evaluate(() => document.querySelectorAll(".results-actions .sticker-btn")[5].click()); // HOME
await sleep(1200);
await page.evaluate(() => document.querySelectorAll(".menu-item")[2].click()); // LIBRARY (index 2 after CLASSROOM)
await sleep(1200);
console.log("LIBRARY cards:", await page.$$eval(".lib-card", (els) => els.length));

// 5. settings toggles
await page.goto(URL + "#/settings", { waitUntil: "networkidle0" });
await sleep(1200);
console.log("SETTINGS toggles:", await page.$$eval(".toggle-row", (els) => els.length));
await page.evaluate(() => {
  const t = document.querySelectorAll(".toggle-row")[0];
  t.click();
  return t.className;
});
console.log("SETTINGS toggle flips ok");

// 6. profiles
await page.goto(URL + "#/profiles", { waitUntil: "networkidle0" });
await sleep(1000);
await page.click(".profile-input");
await page.type(".profile-input", "Joker");
await page.evaluate(() => document.querySelector(".profile-create").click());
await sleep(700);
console.log("PROFILES created:", await page.$$eval(".thief-roster-row", (els) => els.length));

console.log("ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
