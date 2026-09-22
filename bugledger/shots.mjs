/* What is on screen during the click->quiz window? Uses the proven paste flow
   (load -> paste -> import) and screenshots fixed times after the final click. */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] ?? "http://localhost:3011";
const OUT = "bugledger/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
await sleep(1300);

const quiz = {
  title: "Shots Probe",
  settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "Which one?", answers: [{ text: "alpha", correct: true }, { text: "beta" }] },
    { type: "multiple", question: "And this?", answers: [{ text: "gamma", correct: true }, { text: "delta" }] },
  ] }],
};
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(400);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.screenshot({ path: `${OUT}/00-before-click.png` });

/* click the import button and immediately start sampling */
await page.evaluate(() => {
  document.querySelectorAll(".paste-actions button")[0].click();
});

const seen = [];
for (const at of [0, 80, 160, 280, 420, 600, 800, 1100, 1600]) {
  const prev = seen.at(-1)?.at ?? 0;
  if (at > prev) await sleep(at - prev);
  const st = await page.evaluate(() => {
    const veilEl = document.getElementById("veil");
    const scr = document.querySelector(".screen");
    return {
      veil: Number(getComputedStyle(veilEl).opacity).toFixed(2),
      stage: scr?.className?.split(" ")[1] ?? "none",
      textLen: (scr?.textContent ?? "").trim().length,
      hasQuestion: !!document.querySelector(".q-count"),
      spinner: !!document.querySelector(".p5-loader, .loader, .loading"),
    };
  });
  seen.push({ at, ...st });
  if (at <= 420) await page.screenshot({ path: `${OUT}/${String(at).padStart(4, "0")}ms.png` });
}
console.log("t(ms)  veil  screen             textLen  question  loader");
for (const s of seen) {
  console.log(`${String(s.at).padStart(5)}  ${s.veil}  ${s.stage.padEnd(17)}  ${String(s.textLen).padStart(6)}  ${s.hasQuestion ? "YES" : "no "}      ${s.spinner ? "yes" : "no"}`);
}
await page.screenshot({ path: `${OUT}/final.png` });
await browser.close();
console.log("shots ->", OUT);
