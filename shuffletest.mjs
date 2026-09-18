/* P5 QUIZ — always-randomize verification.
   A quiz whose JSON explicitly sets shuffle:false must still be randomized when
   the ALWAYS RANDOMIZE setting is on (questions AND choices), the toggle off
   must restore the authored order, and resume must reproduce the same shuffle. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5183";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};

const PROBE = {
  title: "Shuffle Probe",
  passScore: 70,
  // the quiz author disabled shuffling on purpose — the app toggle must override it
  settings: { shuffle: false, shuffleAnswers: false },
  sections: [
    {
      name: "S1",
      questions: [1, 2, 3, 4].map((n) => ({
        type: "multiple",
        question: `Probe Q${n}`,
        answers: ["A", "B", "C", "D"].map((c) => ({ text: `${c}${n}`, correct: c === "A" })),
      })),
    },
  ],
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

/* seed localStorage before any app script runs */
async function newPage(page, { shuffle, fresh }) {
  await page.evaluateOnNewDocument(
    (quiz, opts) => {
      localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: opts.shuffle }));
      localStorage.setItem("p5q.quizzes", JSON.stringify([{ id: "shuffle-probe", quiz, savedAt: Date.now(), source: "test" }]));
      if (opts.fresh) localStorage.removeItem("p5q.progress");
    },
    PROBE,
    { shuffle, fresh },
  );
  return page;
}

async function startProbe(page) {
  await page.goto(`${BASE}/#library`, { waitUntil: "load" });
  await page.waitForSelector(".lib-btn.play", { timeout: 8000 });
  await page.click(".lib-btn.play");
  await page.waitForSelector(".choice-btn", { timeout: 8000 });
  await sleep(300);
}

const readQ = (page) =>
  page.evaluate(() => ({
    text: document.querySelector(".q-text")?.textContent?.trim() ?? "",
    choices: [...document.querySelectorAll(".choice-btn")].map((b) => b.getAttribute("data-ans")),
  }));

/* ---------- 1. toggle ON: randomized despite JSON shuffle:false ---------- */
const runs = [];
for (let i = 0; i < 8; i++) {
  const page = await newPage(await browser.newPage(), { shuffle: true, fresh: true });
  await startProbe(page);
  runs.push(await readQ(page));
  await page.close();
}
check("JSON says shuffle:false", PROBE.settings.shuffle === false);
check(
  "question order is randomized (toggle ON)",
  new Set(runs.map((r) => r.text)).size > 1,
  `${new Set(runs.map((r) => r.text)).size} unique first-questions in ${runs.length} runs`,
);
const byText = new Map();
for (const r of runs) {
  const key = r.text;
  if (!byText.has(key)) byText.set(key, new Set());
  byText.get(key).add(r.choices.join(","));
}
const choiceVaries = [...byText.values()].some((s) => s.size > 1);
check("choice order is randomized (toggle ON)", choiceVaries, `${[...byText.values()].filter((s) => s.size > 1).length} question(s) with differing choices`);

/* ---------- 2. toggle OFF: authored order preserved ---------- */
{
  const page = await newPage(await browser.newPage(), { shuffle: false, fresh: true });
  await startProbe(page);
  const q = await readQ(page);
  await page.close();
  const page2 = await newPage(await browser.newPage(), { shuffle: false, fresh: true });
  await startProbe(page2);
  const q2 = await readQ(page2);
  await page2.close();
  check("toggle OFF keeps authored question order", q.text === "Probe Q1" && q2.text === "Probe Q1", `${q.text} / ${q2.text}`);
  check("toggle OFF keeps authored choice order", q.choices.join(",") === "A1,B1,C1,D1" && q2.choices.join(",") === "A1,B1,C1,D1", q.choices.join(","));
}

/* ---------- 3. resume reproduces the same shuffle ---------- */
{
  const pageA = await newPage(await browser.newPage(), { shuffle: true, fresh: true });
  await startProbe(pageA);
  await pageA.click(".choice-btn"); // answer Q0
  await pageA.waitForSelector(".next-btn:not(.hidden)", { timeout: 8000 });
  await pageA.click(".next-btn");
  await sleep(500);
  const q1 = await readQ(pageA);
  check("advanced to a second question", !!q1.text && q1.text !== "", q1.text);
  await pageA.close();

  // a fresh page: progress survives, so the quiz resumes the same attempt
  const pageB = await browser.newPage();
  await pageB.goto(`${BASE}/#library`, { waitUntil: "load" });
  await pageB.waitForSelector(".lib-btn.play", { timeout: 8000 });
  await pageB.click(".lib-btn.play");
  await pageB.waitForSelector(".choice-btn", { timeout: 8000 });
  await sleep(400);
  const resumed = await readQ(pageB);
  await pageB.close();
  check("resume shows the same question", resumed.text === q1.text, `${q1.text} -> ${resumed.text}`);
  check("resume shows the same choice order", resumed.choices.join(",") === q1.choices.join(","), `${q1.choices.join(",")} -> ${resumed.choices.join(",")}`);
}

await browser.close();
console.log(fails === 0 ? "\nDONE — always-randomize works" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);