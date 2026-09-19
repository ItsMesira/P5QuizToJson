/* Regression: explanations show after answering in BOTH feedback modes; the
   correct-answer reveal / highlight stays instant-only. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mk = (feedback) => ({
  title: "Expl " + feedback,
  settings: { shuffle: false, shuffleAnswers: false, timeLimit: null, feedback },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "Q one?", explanation: "EXPL_ONE", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "multiple", question: "Q two?", explanation: "EXPL_TWO", answers: [{ text: "c", correct: true }, { text: "d" }] },
  ] }],
});

async function load(quiz) {
  await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
  await sleep(900);
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(350);
  await page.evaluate((json) => {
    const ta = document.querySelector(".paste-area");
    ta.value = json;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, JSON.stringify(quiz));
  await sleep(200);
  await page.evaluate(() => document.querySelector(".paste-actions .paste-load").click());
  await sleep(1500);
}

async function answer(data) {
  await page.evaluate((want) => {
    const b = [...document.querySelectorAll(".choice-btn")].find((x) => x.getAttribute("data-ans") === want);
    if (b) b.click();
  }, data);
  await sleep(900);
}

async function read() {
  return page.evaluate(() => ({
    expl: [...document.querySelectorAll(".fb-expl")].map((e) => e.textContent.trim()),
    card: document.querySelector(".fb-card")?.className ?? "",
    head: document.querySelector(".fb-head")?.textContent ?? "",
    correctLine: !!document.querySelector(".fb-correct"),
  }));
}

// 1. instant + correct → explanation + CORRECT head
await load(mk("instant"));
await answer("a");
let r = await read();
check("instant correct: explanation shown", r.expl.includes("EXPL_ONE"), JSON.stringify(r.expl));
check("instant correct: keeps CORRECT reveal", r.correctLine === false && /CORRECT/.test(r.head), r.head);

// 2. end + correct → explanation still shown, no answer reveal
await load(mk("end"));
await answer("a");
r = await read();
check("end correct: explanation shown", r.expl.includes("EXPL_ONE"), JSON.stringify(r.expl));
check("end correct: neutral EXPLANATION head", /EXPLANATION/.test(r.head), r.head);
check("end correct: no correct-answer reveal", r.correctLine === false, r.card);

// 3. end + wrong → explanation shown, no answer reveal
await load(mk("end"));
await answer("b");
r = await read();
check("end wrong: explanation shown", r.expl.includes("EXPL_ONE"), JSON.stringify(r.expl));
check("end wrong: no correct-answer reveal", r.correctLine === false, r.card);

// 4. instant + wrong → missed card with answer + explanation
await load(mk("instant"));
await answer("b");
r = await read();
check("instant wrong: missed card w/ answer", /wrong/.test(r.card) && r.correctLine, r.card);
check("instant wrong: explanation shown", r.expl.includes("EXPL_ONE"), JSON.stringify(r.expl));

console.log(failures ? `\n${failures} FAILURES` : "\nEXPLANATION TEST PASS");
await browser.close();
process.exit(failures ? 1 : 0);