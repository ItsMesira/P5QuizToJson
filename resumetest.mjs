/* Resume test: answer Q1 correctly, quit mid-quiz, resume, finish — review must show Q1 as correct. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
// deterministic question order for this suite (shuffletest covers randomization)
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const quiz = {
  title: "Resume Check",
  settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "First Q?", answers: [{ text: "one", correct: true }, { text: "x" }] },
    { type: "multiple", question: "Second Q?", answers: [{ text: "two", correct: true }, { text: "y" }] },
  ] }],
};
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1000);
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
await sleep(1400);
// answer Q1 correctly
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "one").click());
await sleep(900);
await page.evaluate(() => document.querySelector(".next-btn").click());
await sleep(1200);
console.log("on Q2:", await page.$eval(".q-count", (e) => e.textContent));
// simulate browser close mid-quiz (progress was saved when advancing to Q2)
await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await sleep(1600);
// resume via title banner
const banner = await page.$eval(".resume-banner", (e) => !!e).catch(() => false);
console.log("resume banner on title:", banner);
await page.evaluate(() => document.querySelector(".resume-banner").click());
await sleep(1300);
console.log("resume chip:", await page.$eval(".resume-chip", (e) => !!e).catch(() => false));
await page.evaluate(() => document.querySelector(".resume-chip").click());
await sleep(1400);
console.log("resumed at:", await page.$eval(".q-count", (e) => e.textContent));
// finish quiz: answer Q2 correctly
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "two").click());
await sleep(900);
await page.evaluate(() => document.querySelector(".next-btn").click());
await sleep(3200);
const review = await page.evaluate(() => [...document.querySelectorAll(".review-row")].map((r) => ({
  ok: r.className.includes("ok"),
  text: r.querySelector(".review-q")?.textContent ?? "",
})));
console.log("review:", JSON.stringify(review, null, 1));
const q1ok = review.some((r) => r.text.includes("First Q?") && r.ok);
console.log("Q1 correctly marked OK in review after resume:", q1ok);
await browser.close();
process.exit(q1ok ? 0 : 1);
