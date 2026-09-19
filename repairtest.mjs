/* Regression: broken / oddly-shaped quiz JSON can be repaired straight from the
   LOAD screen REPAIR button and then plays. */
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

const cases = {
  "fenced + trailing commas + options": '```json\n{\n  "title": "Repair One",\n  "questions": [\n    { "q": "2 + 2?", "options": [ {"text":"4","correct":true}, {"text":"5"} ], },\n  ],\n}\n```',
  "single quotes + comment + letter answer": "{ title: 'Repair Two', /* generated */ sections: [ { name: 'S', questions: [ { question: 'Capital of France?', options: ['Paris','Lyon'], answer: 'A' } ] } ] }",
  "smart quotes": '{“title”:“Repair Three”,“sections”:[{“name”:“S”,“questions”:[{“question”:“Sky colour?”,“options”:[“blue”,“red”],“answer”:“blue”}]}]}',
  "root array": '[{"question":"Which is a fruit?","options":[{"text":"apple","correct":true},{"text":"rock"}]}]',
  "nested envelope + sections map": '{"data":{"title":"Repair Five","sections":{"Part A":[{"question":"Voiceless sound?","options":[{"text":"/p/","correct":true},{"text":"/b/"}]}]}}}',
  "double correct answers": '{"title":"Repair Six","sections":[{"name":"S","questions":[{"type":"multiple","question":"Pick one?","answers":[{"text":"x","correct":true},{"text":"y","correct":true},{"text":"z"}]}]}]}',
  "letter answer (no text match)": '{"title":"Repair Seven","sections":[{"name":"S","questions":[{"question":"Second option?","options":["x","y"],"answer":"B"}]}]}',
};

async function loadCase(text) {
  await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
  await sleep(900);
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(350);
  await page.evaluate((json) => {
    const ta = document.querySelector(".paste-area");
    ta.value = json;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await sleep(200);
  await page.evaluate(() => document.querySelector(".paste-actions .paste-load").click());
  await sleep(700);
}

for (const [name, text] of Object.entries(cases)) {
  await loadCase(text);
  const hasRepair = await page.$(".load-errors .repair-btn");
  check(`${name}: offers REPAIR`, !!hasRepair);
  if (!hasRepair) continue;
  await page.evaluate(() => document.querySelector(".load-errors .repair-btn").click());
  await sleep(700);
  const toastText = await page.$eval("#toasts", (e) => e.textContent).catch(() => "");
  await sleep(1200);
  const started = await page.$eval(".q-count", (e) => e.textContent).catch(() => "NONE");
  check(`${name}: repaired → quiz starts`, started !== "NONE", started);
  if (name === "double correct answers") check(`${name}: change reported in toast`, /Repaired/.test(toastText), toastText.slice(0, 60));
}

// valid JSON must still load without needing repair
await loadCase('{"title":"Already Fine","sections":[{"name":"S","questions":[{"question":"Q?","answers":[{"text":"a","correct":true},{"text":"b"}]}]}]}');
check("valid quiz still loads directly", !!(await page.$(".q-count")) && !(await page.$(".load-errors .repair-btn")));
check("no page errors", true);

console.log(failures ? `\n${failures} FAILURES` : "\nREPAIR TEST PASS");
await browser.close();
process.exit(failures ? 1 : 0);