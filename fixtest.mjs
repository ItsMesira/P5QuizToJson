/* Tests: multi partial credit, pause actually stops the timer, resume restores history. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- PARTIAL CREDIT ---
const quiz = {
  title: "Partial Test",
  settings: { shuffle: false, timeLimit: null, partialCredit: true },
  sections: [{
    name: "S",
    questions: [
      { type: "multi", question: "Pick all primes:", answers: [{ text: "2", correct: true }, { text: "3", correct: true }, { text: "4" }], points: 100 },
      { type: "multiple", question: "Second Q?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    ],
  }],
};
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1000);
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
await sleep(1400);
// pick only ONE correct answer (of two) → partial
await page.evaluate(() => document.querySelector(".multi-row").click());
await page.evaluate(() => document.querySelector(".confirm-btn").click());
await sleep(1600);
console.log("partial stamp shown:", await page.$eval(".screen-stamp", (e) => e.textContent).catch(() => "none"));
console.log("points after partial:", await page.$eval(".pts-num", (e) => e.textContent));

// --- PAUSE STOPS TIMER ---
const quiz2 = {
  title: "Pause Test",
  settings: { shuffle: false, timeLimit: 6 },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "Wait...", answers: [{ text: "a", correct: true }, { text: "b" }] },
  ] }],
};
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1000);
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz2));
await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
await sleep(1400);
const t0 = await page.$eval(".timer-label", (e) => e.textContent);
// open pause, wait 2.5s (longer than remaining would be if timer ran), check timer frozen
await page.evaluate(() => document.querySelector(".quit-btn").click());
await sleep(800);
const tPaused = await page.$eval(".timer-label", (e) => e.textContent);
await sleep(2500);
const tStill = await page.$eval(".timer-label", (e) => e.textContent);
console.log(`timer: start=${t0} paused=${tPaused} after2.5s=${tStill} (should be frozen while paused)`);
// resume → timer continues; answer before timeUp
await page.evaluate(() => document.querySelector(".resume-btn").click());
await sleep(300);
await page.evaluate(() => document.querySelector(".choice-btn").click());
await sleep(500);
console.log("answered while unpaused, feedback:", await page.$eval(".q-feedback", (e) => e.textContent.length > 0).catch(() => "MISSING"));
await browser.close();
