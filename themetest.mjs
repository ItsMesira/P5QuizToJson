/* P5 QUIZ — theme system verification: presets, custom picker, persistence. */
import puppeteer from "puppeteer-core";
const CHROME = process.env.P5Q_CHROME ?? "/Users/blue/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
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

check("default theme is studio", (await themeOf()) === "studio", await themeOf());
check("three appearance cards render", (await page.$$(".theme-card")).length === 3);
check("default --red is Studio saffron", (await redOf()) === "#ffb829", await redOf());

for (const [id, red] of [["calling-card", "#e60012"], ["azure", "#2563eb"]]) {
  await clickTheme(id);
  await sleep(350);
  const t = await themeOf();
  const r = await redOf();
  check(`theme ${id} applies`, t === id && r === red, `${t} / ${r}`);
}

/* the themed home must carry its art, the unthemed default must not */
await clickTheme("calling-card");
await sleep(300);
const crimsonArt = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-art").trim());
check("crimson exposes theme art", crimsonArt.includes("/themes/crimson/" ), crimsonArt);
await clickTheme("studio");
await sleep(300);
const studioArt = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-art").trim());
check("studio exposes no theme art", studioArt === "none", studioArt);

/* persistence: keep azure → reload → still azure */
await clickTheme("azure");
await sleep(300);
await page.reload({ waitUntil: "networkidle0" });
await sleep(2200);
check("azure persists across reload", (await themeOf()) === "azure", await themeOf());
check("azure --red after reload", (await redOf()) === "#2563eb", await redOf());

/* reset defaults restores studio */
await page.evaluate(() => document.querySelector(".reset-btn")?.click());
await sleep(1800);
check("reset restores studio", (await themeOf()) === "studio", await themeOf());

/* every screen still boots under a themed surface */
await clickTheme("calling-card");
await sleep(300);
for (const route of ["title", "load", "library", "entry", "settings", "profiles", "leaderboard", "prompts"]) {
  await page.goto(`http://localhost:5183/#${route}`, { waitUntil: "networkidle0" });
  await sleep(1100);
  const screen = await page.evaluate(() => document.querySelector(".screen")?.className ?? "NONE");
  check(`#${route} renders under calling-card`, screen !== "NONE" && screen !== "", screen);
}

console.log("JS ERRORS:", errs.length ? errs.slice(0, 6) : "none");
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
