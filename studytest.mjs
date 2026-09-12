/* Study-loop feature test: reinforce, goals, paste-AI validate, ?prompt= link */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. load + play a sample, get results, click REINFORCE
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1200);
await page.evaluate(() => document.querySelector(".sample-card").click());
await sleep(1500);
// answer everything wrong-ish quickly (just flow through)
let matchRot = 0;
for (let i = 0; i < 80; i++) {
  await sleep(400);
  if (await page.$(".next-btn:not(.hidden)")) {
    await page.evaluate(() => document.querySelector(".next-btn").click());
    continue;
  }
  const choice = await page.$(".choice-btn:not(:disabled)");
  if (choice) {
    await page.evaluate(() => document.querySelector(".choice-btn:not(:disabled)").click());
    continue;
  }
  const fill = await page.$(".fill-input");
  if (fill) {
    await page.type(".fill-input", "zzz");
    await page.evaluate(() => document.querySelector(".fill-row .confirm-btn").click());
    continue;
  }
  const multi = await page.$(".multi-row:not(.picked)");
  if (multi) {
    await page.evaluate(() => document.querySelector(".multi-row:not(.picked)").click());
    continue;
  }
  if (await page.$(".confirm-btn:not(.hidden)")) {
    await page.evaluate(() => document.querySelector(".confirm-btn:not(.hidden)").click());
    continue;
  }
  const ls = await page.$(".match-col:first-child .match-btn.selected");
  if (ls) {
    const rights = await page.$$(".match-col:last-child .match-btn:not(.paired)");
    if (rights.length) await rights[matchRot % rights.length].evaluate((el) => el.click());
    matchRot++;
  } else if (await page.$(".match-col:first-child .match-btn:not(.paired)")) {
    await page.evaluate(() => document.querySelector(".match-col:first-child .match-btn:not(.paired)").click());
  } else if (await page.$(".open-actions button")) {
    await page.evaluate(() => document.querySelector(".open-actions button").click());
  }
  if (await page.$(".rank-letter")) break;
}
await sleep(2500);
console.log("rank:", await page.$eval(".rank-letter", (e) => e.textContent).catch(() => "MISSING"));
// reinforce → prompts builder prefilled
await page.evaluate(() => document.querySelector(".reinforce-btn").click());
await sleep(2200);
console.log("reinforce → builder topic:", await page.$eval(".builder-input", (e) => e.value));
console.log("reinforce → preview has RETEST:", await page.$eval(".builder-preview", (e) => e.textContent.includes("retest")));
console.log("reinforce → notes filled:", await page.$eval(".builder-notes", (e) => e.value.length > 20));

// 2. paste AI output validation in builder
const good = { title: "AI Quiz", sections: [{ name: "S", questions: [{ type: "multiple", question: "Q?", answers: [{ text: "a", correct: true }, { text: "b" }] }] }] };
await page.click(".builder-paste .paste-area");
await page.type(".builder-paste .paste-area", JSON.stringify(good));
await page.evaluate(() => document.querySelector(".builder-paste .validate-btn").click());
await sleep(600);
console.log("validate ok → play btn:", await page.$eval(".builder-paste .play-btn:not(.hidden)", () => true).catch(() => false));
// invalid
await page.evaluate(() => {
  const ta = document.querySelector(".builder-paste .paste-area");
  ta.value = '{ bad json';
  document.querySelector(".builder-paste .validate-btn").click();
});
await sleep(600);
console.log("validate bad → error shown:", await page.$eval(".builder-paste-errors:not(.hidden)", () => true).catch(() => false));

// 3. library goal modal
await page.goto("http://localhost:5183/#library", { waitUntil: "networkidle0" });
await sleep(1200);
console.log("lib goal btn:", await page.$eval(".goal-btn", () => true).catch(() => false));
await page.evaluate(() => document.querySelector(".goal-btn").click());
await sleep(600);
console.log("goal modal open:", await page.$eval(".goal-modal:not(.hidden)", () => true).catch(() => false));
await page.evaluate(() => document.querySelector(".goal-set-btn").click());
await sleep(1200);
console.log("goal set → card shows GOAL:", await page.$eval(".lib-goal", (e) => e.textContent.includes("GOAL:")).catch(() => false));

// 4. ?prompt= link round-trip
const payload = await page.evaluate(async () => {
  const m = await import("/src/core/share.ts");
  const { encodePayload } = m;
  return encodePayload({ fields: { topic: "Ancient Rome", count: 12 }, tagline: "from link" });
});
const page2 = await browser.newPage();
await page2.goto(`http://localhost:5183/?prompt=${payload}`, { waitUntil: "networkidle0" });
await sleep(1800);
console.log("?prompt= → topic:", await page2.$eval(".builder-input", (e) => e.value).catch(() => "FAILED"));

await browser.close();
