/* P5 Best menu remake verification. */
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

await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await sleep(2200);

// ransom lettering on big name
const ransom = await page.evaluate(() => {
  const name = document.querySelectorAll("#big-name .ch");
  const menu = document.querySelectorAll("#menu .ch");
  const variants = [...document.querySelectorAll("#big-name .ch")].filter((c) => ["box", "boxw", "red"].some((v) => c.classList.contains(v))).length;
  return { nameLetters: name.length, menuLetters: menu.length, variants };
});
check("big name ransomized (6 letters)", ransom.nameLetters === 6, String(ransom.nameLetters));
check("menu ransomized", ransom.menuLetters > 30, String(ransom.menuLetters));
check("letter variants present (box/boxw/red)", ransom.variants >= 1, String(ransom.variants));

// menu buttons anatomy
const items = await page.$$eval(".menu-item", (els) => els.map((el) => ({
  key: !!el.querySelector(".menu-key"),
  icon: !!el.querySelector(".menu-icon"),
  underline: !!el.querySelector(".menu-underline"),
  arrow: !!el.querySelector(".cursor-mark"),
  tilt: getComputedStyle(el).transform,
  sel: el.classList.contains("sel"),
})));
check("5 menu items", items.length === 5);
check("every item has key+icon+underline+arrow", items.every((i) => i.key && i.icon && i.underline && i.arrow));
check("initial selection set", items.some((i) => i.sel));
check("items have per-item tilt", items.some((i) => i.tilt !== "none"));

// selected state anatomy
const selState = await page.evaluate(() => {
  const sel = document.querySelector(".menu-item.sel");
  return {
    highlight: getComputedStyle(sel, "::before").transform,
    arrowOpacity: getComputedStyle(sel.querySelector(".cursor-mark")).opacity,
    keyOn: sel.querySelector(".menu-key").classList.contains("on"),
    iconOn: sel.querySelector(".menu-icon").classList.contains("on"),
    letterAnim: getComputedStyle(sel.querySelector(".ch")).animationName,
  };
});
check("selected: lightning bar shown", selState.highlight.includes("matrix") || selState.highlight.includes("1, 0") || selState.highlight !== "none", selState.highlight.slice(0, 40));
check("selected: arrow visible", parseFloat(selState.arrowOpacity) > 0.5);
check("selected: key + icon lit", selState.keyOn && selState.iconOn);
check("selected: letters jitter", selState.letterAnim === "jitter", selState.letterAnim);

// hover: underline draws in + icon spins
await page.hover(".menu-item:nth-child(3)");
await sleep(600);
const hoverState = await page.evaluate(() => {
  const el = document.querySelector(".menu-item:nth-child(3)");
  return {
    sel: el.classList.contains("sel"),
    underline: getComputedStyle(el.querySelector(".menu-underline")).transform,
    iconAnim: getComputedStyle(el.querySelector(".menu-icon")).transform,
  };
});
check("hover selects item", hoverState.sel);
check("hover: underline drawn", hoverState.underline !== "none" && hoverState.underline.includes("matrix"), hoverState.underline.slice(0, 30));

// HUD + clock
check("HUD top tags (2)", (await page.$$eval("#hud-top .hud-tag", (els) => els.length)) === 2);
check("HUD bottom keycaps (3)", (await page.$$eval("#hud-bottom .key", (els) => els.length)) === 3);
const clock1 = await page.$eval("#clock", (e) => e.textContent);
check("clock shows time", /^\d{1,2}:\d{2}/.test(clock1.trim()), clock1);

// background layers
const bg = await page.evaluate(() => ({
  screen: document.body.dataset.screen,
  stripes: getComputedStyle(document.querySelector("#bg-stripes")).backgroundImage.includes("linear-gradient"),
  halftone: !!document.querySelector("#bg-halftone"),
  stars: document.querySelectorAll(".bg-star").length,
  slash: !!document.querySelector("#bg-slash"),
  slashClip: getComputedStyle(document.querySelector("#bg-slash")).clipPath.slice(0, 40),
}));
check("body data-screen=home", bg.screen === "home");
check("bg: stripes + halftone + 2 stars + slash", bg.stripes && bg.halftone && bg.stars === 2 && bg.slash);
check("slash home shape", bg.slashClip.includes("58%"), bg.slashClip);

// slash retracts on sub screen
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1400);
const slashSub = await page.evaluate(() => getComputedStyle(document.querySelector("#bg-slash")).clipPath);
check("slash retracts on sub-screens", /0px 62%|0 62%|0px 100%/ .test(slashSub), slashSub.slice(0, 60));

// ransom screen titles
check("screen title ransomized", await page.$eval(".screen-title .ransom", () => true).catch(() => false));
check("screen title underline bar", await page.$eval(".screen-title", (e) => getComputedStyle(e, "::after").height !== "auto").catch(() => false));

// sprite cursor
const cursor = await page.evaluate(() => {
  const c = document.getElementById("cursor");
  return {
    exists: !!c,
    bg: c ? getComputedStyle(c).backgroundImage.slice(0, 50) : "",
    osHidden: document.body.classList.contains("cursor-on"),
  };
});
check("sprite cursor exists", cursor.exists);
check("cursor uses sprite strip", cursor.bg.includes("normal.png") || cursor.bg.includes("link.png"), cursor.bg);
check("OS cursor hidden on fine pointers", cursor.osHidden);
await page.mouse.move(700, 300);
const pos1 = await page.$eval("#cursor", (e) => e.style.backgroundPosition);
await sleep(250);
const pos2 = await page.$eval("#cursor", (e) => e.style.backgroundPosition);
check("cursor frames animate", pos1 !== pos2, `${pos1}→${pos2}`);

// parallax: moving mouse translates stripes
await page.mouse.move(100, 100);
await sleep(400);
const t1 = await page.$eval("#bg-stripes", (e) => e.style.transform);
await page.mouse.move(1200, 700);
await sleep(600);
const t2 = await page.$eval("#bg-stripes", (e) => e.style.transform);
check("parallax moves stripes", t1 !== t2, `${t1} → ${t2}`);

console.log("JS ERRORS:", errs.length ? errs.slice(0, 6) : "none");
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
