/* Feature matrix: every type/mode/lifeline + validator variations. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
// this suite asserts a fixed question type order — pin authored order (shuffletest covers randomization)
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

async function loadQuiz(quiz) {
  await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
  await sleep(1000);
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(350);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(1700);
  const onQuiz = await page.$eval(".q-count", () => true).catch(() => false);
  if (!onQuiz) {
    const errors = await page.$$eval(".load-error-row", (els) => els.map((e) => e.textContent.slice(0, 80)));
    return { errors };
  }
  return { ok: true };
}

async function clickSel(sel) {
  const found = await page.$(sel);
  if (found) {
    await found.evaluate((el) => el.click());
    return true;
  }
  return false;
}

async function answerCorrect() {
  // find correct choice by matching data-ans against expected from the quiz spec? we pass per-test strategies instead
}

// ============ 1. AI-variation validator ============
const aiVariations = {
  title: "AI Variations",
  settings: { shuffle: false, timeLimit: null },
  sections: [{
    name: "S",
    questions: [
      { question: "Capital of France?", options: ["Paris", "Lyon", "Nice"], answer: "Paris" },
      { question: "2+2?", choices: ["4", "5", "6"], answer_index: 0 },
      { question: "Primes?", options: ["2", "3", "8"], correctAnswers: ["2", "3"] },
      { question: "12 × 12?", answer: "144" },
      { question: "Fill blank: ___", correctText: "hello" },
      { question: "T/F: sky is blue", options: [{ text: "True", correct: true }, { text: "False" }] },
    ],
  }],
};
const v1 = await loadQuiz(aiVariations);
check("AI variations load without validation errors", !!v1.ok, v1.errors ? v1.errors[0] : "");
if (v1.ok) {
  // Q1 multiple w/ inferred correct: click Paris
  const q1 = await page.$eval(".q-text", (e) => e.textContent.trim());
  check("Q1 detected as multiple", q1 === "Capital of France?");
  await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "Paris").click());
  await sleep(1100);
  check("Q1 Paris → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(1100);
  // Q2 answer_index
  await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "4").click());
  await sleep(1100);
  check("Q2 answer_index → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(1100);
  // Q3 correctAnswers array → multi
  const hasMulti = await page.$eval(".multi-row", () => true).catch(() => false);
  check("Q3 correctAnswers[] → multi type", hasMulti);
  await page.evaluate(() => [...document.querySelectorAll(".multi-row")].filter((r) => ["2", "3"].includes(r.getAttribute("data-ans"))).forEach((r) => r.click()));
  await clickSel(".confirm-btn");
  await sleep(1100);
  check("Q3 multi correct → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(1100);
  // Q4 string answer → fill or numeric (both acceptable; must accept 144)
  const hasNum = await page.$eval(".fill-input", () => true).catch(() => false);
  check("Q4 string answer → typed input (fill/numeric)", hasNum);
  await page.click(".fill-input");
  await page.type(".fill-input", "144");
  await clickSel(".fill-row .confirm-btn");
  await sleep(1100);
  check("Q4 144 → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(1100);
  // Q5 fill
  await page.click(".fill-input");
  await page.type(".fill-input", "hello");
  await clickSel(".fill-row .confirm-btn");
  await sleep(1100);
  check("Q5 fill hello → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(1100);
  // Q6 boolean
  await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "True").click());
  await sleep(1100);
  check("Q6 boolean → CORRECT", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT"));
  await clickSel(".next-btn");
  await sleep(3200);
  check("AI variations → rank S", (await page.$eval(".rank-letter", (e) => e.textContent).catch(() => "?")) === "S");
}

// ============ 2. order questions: scrambled display, swapping to correct wins ============
const orderQuiz = {
  title: "Order Test",
  settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "order", question: "Order them:", answers: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "E" }] },
  ] }],
};
await loadQuiz(orderQuiz);
const chipOrder = await page.$$eval(".order-chip .chip-text", (els) => els.map((e) => e.textContent));
check("order chips render", chipOrder.length === 5, chipOrder.join(","));
const correctOrder = ["A", "B", "C", "D", "E"];
const inOrder = chipOrder.join(",") === correctOrder.join(",");
// swap chips into correct order using the click-swap interaction
if (!inOrder) {
  for (let i = 0; i < 5; i++) {
    let cur = await page.$$eval(".order-chip .chip-text", (els) => els.map((e) => e.textContent));
    const j = cur.indexOf(correctOrder[i]);
    if (j === i) continue;
    await page.evaluate(([a, b]) => {
      const chips = document.querySelectorAll(".order-chip");
      chips[a].click();
      chips[b].click();
    }, [i, j]);
    await sleep(150);
  }
}
await page.evaluate(() => document.querySelector(".confirm-btn").click());
await sleep(1400);
const orderCorrect = (await page.$eval(".q-feedback", (e) => e.textContent)).includes("CORRECT");
check(`order shuffled display (${chipOrder.join(",")}) → arrange & lock → CORRECT`, orderCorrect);

// ============ 3. survival mode ============
const survivalQuiz = {
  title: "Survival Test",
  settings: { shuffle: false, timeLimit: null, mode: "survival" },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "S1?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "multiple", question: "S2?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "multiple", question: "S3?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "multiple", question: "S4?", answers: [{ text: "a", correct: true }, { text: "b" }] },
  ] }],
};
await loadQuiz(survivalQuiz);
const heartsOn = await page.$eval(".heart.on", (e) => e.textContent).catch(() => null);
check("survival shows hearts", heartsOn === "♥");
// answer wrong 3 times → game over
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "b").click());
  await sleep(1800);
  await clickSel(".next-btn");
  await sleep(1000);
}
await sleep(2500);
const overRank = await page.$eval(".rank-letter", (e) => e.textContent).catch(() => null);
check("survival game over → results", !!overRank, `rank ${overRank}`);
const unanswered = await page.$$eval(".review-row.skip", (els) => els.length);
check("unanswered questions shown as skipped (not wrong)", unanswered > 0, `${unanswered} skipped rows`);

// ============ 4. endless mode ============
const endlessQuiz = {
  title: "Endless Test",
  settings: { shuffle: false, timeLimit: null, mode: "endless" },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "E1?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "multiple", question: "E2?", answers: [{ text: "a", correct: true }, { text: "b" }] },
  ] }],
};
await loadQuiz(endlessQuiz);
// Q1 wrong, Q2 correct → Q1 re-asked (index 3)
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "b").click());
await sleep(1500);
await clickSel(".next-btn");
await sleep(1100);
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "a").click());
await sleep(1500);
await clickSel(".next-btn");
await sleep(1100);
const requiz = await page.$eval(".q-text", (e) => e.textContent.trim());
check("endless re-asks the missed question", requiz === "E1?", requiz);
// finish it correctly then all done
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "a").click());
await sleep(1500);
await clickSel(".next-btn");
await sleep(3200);
check("endless finishes", !!(await page.$eval(".rank-letter", (e) => e.textContent).catch(() => null)));

// ============ 5. lifelines ============
const lifelineQuiz = {
  title: "Lifeline Test",
  settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "L1?", answers: [{ text: "a", correct: true }, { text: "b" }, { text: "c" }, { text: "d" }], hint: "It starts with a" },
    { type: "multiple", question: "L2?", answers: [{ text: "x", correct: true }, { text: "y" }, { text: "z" }, { text: "w" }] },
  ] }],
};
await loadQuiz(lifelineQuiz);
// 50/50
await page.evaluate(() => document.querySelector('[data-lf="fifty"]').click());
await sleep(700);
const disabledAfterFifty = await page.$$eval(".choice-btn:disabled", (els) => els.length);
check("50/50 removes wrong answers", disabledAfterFifty >= 2, `${disabledAfterFifty} disabled`);
// hint
await page.evaluate(() => document.querySelector('[data-lf="hint"]').click());
await sleep(600);
check("hint shows", (await page.$eval(".q-feedback", (e) => e.textContent)).includes("starts with a"));
// flag
await page.evaluate(() => document.querySelector('[data-lf="flag"]').click());
await sleep(400);
check("flag marks button", await page.$eval('[data-lf="flag"]', (e) => e.classList.contains("flagged")));
// answer correct + skip Q2
await page.evaluate(() => [...document.querySelectorAll(".choice-btn:not(:disabled)")].find((b) => b.getAttribute("data-ans") === "a").click());
await sleep(1400);
await clickSel(".next-btn");
await sleep(1100);
await page.evaluate(() => document.querySelector('[data-lf="skip"]').click());
await sleep(3200);
const skipped = await page.$eval(".rank-letter", () => true).catch(() => false);
check("skip advances (to finish)", skipped);

// ============ 6. practice mode: no points ============
const practiceQuiz = {
  title: "Practice Test",
  settings: { shuffle: false, timeLimit: null, mode: "practice" },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "P1?", answers: [{ text: "a", correct: true }, { text: "b" }], points: 100 },
  ] }],
};
await loadQuiz(practiceQuiz);
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "a").click());
await sleep(1300);
const practicePts = await page.$eval(".pts-num", (e) => e.textContent);
check("practice mode awards no points", practicePts === "0", practicePts);

// ============ 7. feedback "end" mode ============
const endQuiz = {
  title: "End Feedback",
  settings: { shuffle: false, timeLimit: null, feedback: "end" },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "F1?", answers: [{ text: "a", correct: true }, { text: "b" }] },
  ] }],
};
await loadQuiz(endQuiz);
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "b").click());
await sleep(1000);
const noInstantFeedback = await page.$eval(".q-feedback", (e) => e.textContent.trim() === "");
check("feedback=end hides instant feedback", noInstantFeedback);

// ============ 8. negative marking ============
const negQuiz = {
  title: "Negative",
  settings: { shuffle: false, timeLimit: null, negativeMarking: true },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "N1?", answers: [{ text: "a", correct: true }, { text: "b" }], points: 100 },
  ] }],
};
await loadQuiz(negQuiz);
await page.evaluate(() => [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === "b").click());
await sleep(1300);
const negPts = await page.$eval(".pts-num", (e) => e.textContent);
check("negative marking penalizes", Number(negPts) < 0, negPts);

console.log("JS ERRORS:", errs.length ? errs.slice(0, 6) : "none");
await browser.close();
process.exit(failures || errs.length ? 1 : 0);
