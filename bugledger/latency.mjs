/* ============ LATENCY PROBE ============
   Measures what the user actually waits for when they click PLAY, and how much
   of it is my instrumentation vs real work. Also counts what a double/triple
   click does to the DOM (the "spam click breaks the UI" report).

   Usage: node bugledger/latency.mjs [--base URL] [--runs 3]
*/
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : args[i + 1];
};
const BASE = opt("--base", "http://localhost:3011");
const RUNS = Number(opt("--runs", "3"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

/* ---- 1. click -> first question pixels, from the library ---- */
for (let run = 1; run <= RUNS; run++) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const cache = run === 1 ? "cold (new profile)" : "warm (same profile)";
  await page.evaluateOnNewDocument(() => {
    window.__marks = [];
    const mark = (n) => window.__marks.push({ n, t: performance.now() });
    window.__mark = mark;
    // first paint of the quiz screen
    new MutationObserver(() => {
      if (document.querySelector(".q-count") && !window.__qSeen) {
        window.__qSeen = true;
        mark("firstQuestionVisible");
      }
      if (document.querySelector(".screen.quiz-screen") && !window.__quizSeen) {
        window.__quizSeen = true;
        mark("quizScreenMounted");
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  // seed a saved quiz so the library has a PLAY button
  await page.goto(`${BASE}/#library`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.evaluate(() => {
    const quiz = {
      title: "Latency Probe",
      settings: { shuffle: false, timeLimit: null },
      sections: [{ name: "S", questions: [
        { type: "multiple", question: "Q1?", answers: [{ text: "a", correct: true }, { text: "b" }] },
        { type: "multiple", question: "Q2?", answers: [{ text: "a", correct: true }, { text: "b" }] },
      ] }],
    };
    const entry = { id: "probe1", quiz, savedAt: Date.now(), source: "probe" };
    localStorage.setItem("p5q.quizzes", JSON.stringify([entry]));
  });

  await page.goto(`${BASE}/#library`, { waitUntil: "networkidle0" });
  await sleep(1500);

  const result = await page.evaluate(async () => {
    const t0 = performance.now();
    window.__marks.length = 0;
    window.__mark("click");
    const play = [...document.querySelectorAll("button")].find((b) => /PLAY/i.test(b.textContent ?? ""));
    if (!play) return { error: "no PLAY button found" };
    play.click();
    // busy-wait a little to let microtasks flush, then sample
    const samples = [];
    for (const at of [0, 50, 100, 200, 400, 800, 1200, 2000, 3000]) {
      await new Promise((r) => setTimeout(r, at - (performance.now() - t0) > 0 ? at - (performance.now() - t0) : 0));
      samples.push({
        at: Math.round(performance.now() - t0),
        quiz: !!document.querySelector(".screen.quiz-screen"),
        question: !!document.querySelector(".q-count"),
        veil: getComputedStyle(document.getElementById("veil")).opacity,
        anyBtnDisabled: [...document.querySelectorAll("button")].some((b) => b.disabled),
      });
    }
    return { samples, marks: window.__marks.map((m) => ({ n: m.n, t: Math.round(m.t - t0) })) };
  });

  console.log(`\n--- run ${run} [${cache}] ---`);
  if (result.error) { console.log("  ", result.error); await page.close(); continue; }
  for (const s of result.samples) {
    console.log(`  ${String(s.at).padStart(5)}ms  quiz=${s.quiz ? "Y" : "n"} question=${s.question ? "Y" : "n"} veil=${s.veil} disabledBtn=${s.anyBtnDisabled ? "Y" : "n"}`);
  }
  console.log("  marks:", JSON.stringify(result.marks));
  await page.close();
}

/* ---- 2. what does spam-clicking do? ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await page.goto(`${BASE}/#library`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.evaluate(() => {
    const quiz = {
      title: "Spam Probe",
      settings: { shuffle: false, timeLimit: null },
      sections: [{ name: "S", questions: [{ type: "multiple", question: "Q?", answers: [{ text: "a", correct: true }, { text: "b" }] }] }],
    };
    localStorage.setItem("p5q.quizzes", JSON.stringify([{ id: "spam1", quiz, savedAt: Date.now(), source: "probe" }]));
  });
  await page.goto(`${BASE}/#library`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const spam = await page.evaluate(async () => {
    const play = [...document.querySelectorAll("button")].find((b) => /PLAY/i.test(b.textContent ?? ""));
    if (!play) return { error: "no PLAY button" };
    for (let i = 0; i < 8; i++) { play.click(); await new Promise((r) => setTimeout(r, 60)); }
    await new Promise((r) => setTimeout(r, 4000));
    return {
      screens: document.querySelectorAll(".screen").length,
      stageChildren: document.getElementById("app")?.children.length ?? -1,
      quizScreens: document.querySelectorAll(".quiz-screen").length,
      veils: document.querySelectorAll("#veil").length,
      hash: location.hash,
      quizVisible: !!document.querySelector(".screen.quiz-screen"),
    };
  });
  console.log("\n--- spam click (8 rapid clicks) ---");
  console.log("  ", JSON.stringify(spam));
  console.log("   pageerrors:", errs.length ? errs.join(" | ") : "none");
  await page.close();
}

await browser.close();
