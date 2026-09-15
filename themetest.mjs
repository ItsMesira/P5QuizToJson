/* P5 QUIZ — theme system verification: presets, custom picker, persistence. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 150)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
const redOf = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--red").trim());
const clickTheme = (id) => page.evaluate((i) => document.querySelector(`[data-theme-id="${i}"]`)?.click(), id);

await page.goto("http://localhost:5183/#settings", { waitUntil: "networkidle0" });
await sleep(2200);

check("default theme is calling-card", (await themeOf()) === "calling-card", await themeOf());
check("theme cards render (6 incl. custom)", (await page.$$(".theme-card")).length === 6);
check("default --red is P5 crimson", (await redOf()) === "#e60012", await redOf());

for (const [id, red] of [["noir", "#c9a227"], ["azure", "#2563eb"], ["chalkboard", "#21a366"], ["vapor", "#c026d3"]]) {
  await clickTheme(id);
  await sleep(350);
  const t = await themeOf();
  const r = await redOf();
  check(`theme ${id} applies`, t === id && r === red, `${t} / ${r}`);
}

/* custom picker */
await clickTheme("custom");
await sleep(400);
check("custom box revealed", await page.evaluate(() => document.querySelector(".theme-custom")?.classList.contains("show")));
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".theme-custom input[type=color]")];
  inputs[0].value = "#00ff88";
  inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(400);
const inlineRed = await page.evaluate(() => document.documentElement.style.getPropertyValue("--red").trim());
check("custom accent applies inline", inlineRed === "#00ff88", inlineRed);
const contrastText = await page.evaluate(() => document.querySelector(".theme-contrast")?.textContent ?? "");
check("contrast readout present", /TEXT .* \d+\.\d:1/.test(contrastText), contrastText);

/* high-contrast custom: white text on dark bg should be OK */
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".theme-custom input[type=color]")];
  inputs[2].value = "#ffffff";
  inputs[2].dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
check("AA ok shown for white-on-dark", await page.evaluate(() => !!document.querySelector(".theme-contrast .ok")));

/* persistence: keep vapor → reload → still vapor */
await clickTheme("vapor");
await sleep(300);
await page.reload({ waitUntil: "networkidle0" });
await sleep(2200);
check("vapor persists across reload", (await themeOf()) === "vapor", await themeOf());
check("vapor --red after reload", (await redOf()) === "#c026d3", await redOf());

/* reset defaults restores calling-card */
await page.evaluate(() => document.querySelector(".reset-btn")?.click());
await sleep(1800);
check("reset restores calling-card", (await themeOf()) === "calling-card", await themeOf());

/* every screen still boots under a non-default theme */
await clickTheme("chalkboard");
await sleep(300);
for (const route of ["title", "load", "library", "entry", "settings", "profiles", "leaderboard", "prompts"]) {
  await page.goto(`http://localhost:5183/#${route}`, { waitUntil: "networkidle0" });
  await sleep(1100);
  const screen = await page.evaluate(() => document.querySelector(".screen")?.className ?? "NONE");
  check(`#${route} renders under chalkboard`, screen !== "NONE" && screen !== "", screen);
}

console.log("JS ERRORS:", errs.length ? errs.slice(0, 6) : "none");
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
