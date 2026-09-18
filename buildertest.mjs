/* P5 QUIZ — Master Prompt builder layout guard.
   Regression: the two inputs in .field-row-2 had an intrinsic 230px each and
   spilled out of the 430px form column into the preview panel, and the whole
   builder-grid overflowed the viewport on phones (clipping the preview).
   This asserts the builder fits at every width, with a long unbreakable token. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5183";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIDTHS = [1440, 1180, 1024, 900, 768, 600, 480, 414, 390, 360, 320, 280];

let fails = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

for (const w of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 860, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#prompts`, { waitUntil: "load" });
  await page.waitForSelector(".builder-preview", { timeout: 8000 });
  await page.click(".builder-form .builder-input");
  await page.type(".builder-form .builder-input", "SUPERCALIFRAGILISTICEXPIALIDOCIOUS_AND_A_LONG_UNBREAKABLE_TOKEN_1234567890");
  await sleep(700);
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const over = (s) => {
      const e = document.querySelector(s);
      return e ? Math.round(e.getBoundingClientRect().right - vw) : null;
    };
    const grid = document.querySelector(".builder-grid");
    const preview = document.querySelector(".builder-preview");
    const form = document.querySelector(".builder-form");
    // the two-up fields must stay inside the form column (the original bug)
    const fieldOverflow = [...document.querySelectorAll(".builder-form .field-row-2 .builder-input")]
      .some((i) => i.getBoundingClientRect().right > form.getBoundingClientRect().right + 1);
    return {
      doc: document.documentElement.scrollWidth - vw,
      grid: grid ? grid.scrollWidth - grid.clientWidth : null,
      panel: over(".builder-right"),
      warn: over(".builder-warn"),
      previewClip: preview ? preview.scrollWidth - preview.clientWidth : null,
      tabs: over(".prompts-tabs"),
      title: over(".screen-title"),
      fieldOverflow,
    };
  });
  const ok =
    r.doc <= 1 && r.grid <= 1 && r.panel <= 1 && (r.warn === null || r.warn <= 1) &&
    r.previewClip <= 1 && r.tabs <= 1 && r.title <= 1 && !r.fieldOverflow;
  check(`builder fits @ ${w}px`, ok, JSON.stringify(r));
  await page.close();
}

/* prompt modal on a phone must wrap, not clip */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#prompts`, { waitUntil: "load" });
  await page.waitForSelector(".builder-preview", { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /PRESETS/i.test(b.textContent))?.click());
  await page.waitForSelector(".prompt-card", { timeout: 8000 });
  await page.click(".prompt-card");
  await page.waitForSelector(".prompt-modal", { timeout: 8000 });
  await sleep(600);
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const body = document.querySelector(".pm-body");
    const text = document.querySelector(".pm-text");
    const modal = document.querySelector(".prompt-modal");
    return {
      modal: modal ? Math.round(modal.getBoundingClientRect().right - vw) : null,
      body: body ? body.scrollWidth - body.clientWidth : null,
      text: text ? text.scrollWidth - text.clientWidth : null,
    };
  });
  check("prompt modal wraps @390px", r.modal <= 1 && r.body <= 1 && r.text <= 1, JSON.stringify(r));
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "\nDONE — builder fits on all widths" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);