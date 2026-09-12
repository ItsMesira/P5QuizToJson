/* Regression: shuffled quiz answered 100% correctly must show a consistent review. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const quiz = {
  title: "Shuffle Check",
  settings: { shuffle: true, shuffleAnswers: true, timeLimit: null, partialCredit: true },
  sections: [{
    name: "S",
    questions: [
      { type: "multiple", question: "Alpha question?", answers: [{ text: "alpha", correct: true }, { text: "beta" }, { text: "gamma" }, { text: "delta" }] },
      { type: "multiple", question: "Bravo question?", answers: [{ text: "bravo", correct: true }, { text: "alpha" }, { text: "gamma" }, { text: "delta" }] },
      { type: "multiple", question: "Charlie question?", answers: [{ text: "charlie", correct: true }, { text: "beta" }, { text: "gamma" }, { text: "delta" }] },
      { type: "multiple", question: "Delta question?", answers: [{ text: "delta", correct: true }, { text: "alpha" }, { text: "beta" }, { text: "gamma" }] },
      { type: "multiple", question: "Echo question?", answers: [{ text: "echo", correct: true }, { text: "alpha" }, { text: "beta" }, { text: "gamma" }] },
      { type: "multiple", question: "Foxtrot question?", answers: [{ text: "foxtrot", correct: true }, { text: "alpha" }, { text: "beta" }, { text: "gamma" }] },
    ],
  }],
};
const expectedAnswers = {
  "Alpha question?": "alpha",
  "Bravo question?": "bravo",
  "Charlie question?": "charlie",
  "Delta question?": "delta",
  "Echo question?": "echo",
  "Foxtrot question?": "foxtrot",
};

await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1000);
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
await sleep(1500);

// play: always click the CORRECT answer for the question currently shown
let failures = 0;
for (let i = 0; i < 60; i++) {
  await sleep(350);
  if (await page.$(".rank-letter")) break;
  const next = await page.$(".next-btn:not(.hidden)");
  if (next) {
    await next.evaluate((el) => el.click());
    continue;
  }
  const state = await page.evaluate(() => ({
    q: document.querySelector(".q-text")?.textContent ?? "",
    disabled: document.querySelectorAll(".choice-btn:not(:disabled)").length,
  }));
  if (state.q && state.disabled) {
    const want = expectedAnswers[state.q.trim()];
    if (!want) {
      console.log("UNKNOWN QUESTION:", state.q);
      failures++;
      break;
    }
    const clicked = await page.evaluate((w) => {
      const btn = [...document.querySelectorAll(".choice-btn")].find((b) => b.getAttribute("data-ans") === w);
      if (btn) btn.click();
      return !!btn;
    }, want);
    if (!clicked) {
      console.log("CORRECT ANSWER BUTTON NOT FOUND for:", state.q, "wanted:", want);
      failures++;
      break;
    }
    continue;
  }
}
await sleep(3200);

const rank = await page.$eval(".rank-letter", (e) => e.textContent).catch(() => "MISSING");
console.log("rank:", rank, "| failures:", failures);

const review = await page.evaluate(() => {
  return [...document.querySelectorAll(".review-row")].map((row) => ({
    cls: row.className,
    text: row.querySelector(".review-q")?.textContent ?? "",
    answered: row.querySelectorAll(".review-a").length > 0,
    answerText: row.querySelector(".review-a")?.textContent ?? "",
  }));
});
console.log("review rows:", review.length);
let mismatch = 0;
review.forEach((r, i) => {
  const isOk = r.cls.includes("ok");
  const qText = r.text.split(" — ").slice(1).join(" — ");
  const want = expectedAnswers[qText.trim()];
  const saidLine = r.answerText.startsWith("You said:") ? r.answerText.replace("You said: ", "") : "";
  if (!isOk) {
    mismatch++;
    console.log(`ROW ${i + 1} NOT OK:`, r.text, "| answer line:", r.answerText);
  }
  if (want && saidLine && saidLine !== want) {
    mismatch++;
    console.log(`ROW ${i + 1} ANSWER MISMATCH: expected "${want}", got "${saidLine}"`);
  }
});
console.log("mismatches:", mismatch);
console.log("correct count:", review.filter((r) => r.cls.includes("ok")).length, "of", quiz.sections[0].questions.length);
await browser.close();
process.exit(failures + mismatch ? 1 : 0);
