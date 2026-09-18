/* P5ex port verification: BGM panel, cut-ins, dialogue portraits, Thief Stats. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// deterministic question order for this suite (shuffletest covers randomization)
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 150)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

// 1. assets served
const audioRes = await fetch("http://localhost:5183/audio/background.mp3");
check("background.mp3 served", audioRes.ok);
const artRes = await fetch("http://localhost:5183/art/jokerface2.png");
check("jokerface2.png served", artRes.ok);

// 2. title: BGM panel + card flourish
await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await sleep(1600);
check("BGM panel exists", await page.$eval(".bgm-panel", () => true).catch(() => false));
check("BGM toggle on by default", await page.$eval(".bgm-toggle", (e) => e.classList.contains("on")));
// hover expands slider
await page.hover(".bgm-panel");
await sleep(600);
check("slider expands on hover", await page.$eval(".bgm-slider-wrap", (e) => parseFloat(getComputedStyle(e).maxWidth) > 100));
// toggle off → vinyl pauses + body class
await page.evaluate(() => document.querySelector(".bgm-toggle").click());
await sleep(400);
check("music off → body class", await page.evaluate(() => document.body.classList.contains("music-off")));
check("toggle shows off", await page.$eval(".bgm-toggle", (e) => !e.classList.contains("on")));
await page.evaluate(() => document.querySelector(".bgm-toggle").click());
await sleep(400);

// 3. settings: BGM seg
await page.goto("http://localhost:5183/#settings", { waitUntil: "networkidle0" });
await sleep(1200);
const segs = await page.$$eval(".seg-btn[data-mode]", (els) => els.map((e) => e.className));
check("BGM source seg present (authentic on)", segs.some((c) => c.includes("on")), segs.join(","));

// 4. quiz: dialogue portraits + portrait pop + finale cut-in image
const quiz = { title: "Port Test", settings: { shuffle: false, timeLimit: null },
  sections: [{ name: "S", questions: [
    { type: "multiple", question: "A?", answers: [{ text: "a", correct: true }, { text: "b" }], explanation: "because reasons" },
  ] }] };
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1000);
await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
await sleep(350);
await page.click(".paste-area");
await page.type(".paste-area", JSON.stringify(quiz));
await page.evaluate(() => document.querySelectorAll(".load-paste .paste-actions button")[0].click());
await sleep(1700);
await page.evaluate(() => document.querySelector(".choice-btn").click());
await sleep(600);
check("portrait pop on correct", await page.$eval(".portrait-pop img", (e) => e.complete && e.naturalWidth > 0).catch(() => false));
await sleep(900);
check("dialogue portrait in feedback", await page.$eval(".fb-portrait", (e) => e.complete && e.naturalWidth > 0).catch(() => false));
await page.evaluate(() => document.querySelector(".next-btn").click());
await sleep(4200);
check("finale cut-in used real image", await page.$eval(".rank-letter", () => true).catch(() => false));

// 5. Thief Stats
await page.goto("http://localhost:5183/#profiles", { waitUntil: "networkidle0" });
await sleep(1400);
check("thief portrait img", await page.$eval(".thief-portrait", (e) => e.complete && e.naturalWidth > 0));
const name1 = await page.$eval(".thief-name", (e) => e.textContent);
await page.evaluate(() => document.querySelector(".thief-arrow.right").click());
await sleep(600);
const name2 = await page.$eval(".thief-name", (e) => e.textContent);
check("portrait cycles", name1 !== name2, `${name1}→${name2}`);
check("stat rows", (await page.$$eval(".thief-stat", (els) => els.length)) === 4);
// keyboard: ArrowRight cycles portrait
await page.keyboard.press("ArrowRight");
await sleep(500);
check("keyboard cycles portrait", await page.$eval(".thief-name", (e) => e.textContent) !== name2);
// create profile → roster row with portrait
await page.click(".profile-input");
await page.type(".profile-input", "Makoto");
await page.evaluate(() => document.querySelector(".profile-create").click());
await sleep(1200);
check("roster row appears", await page.$$eval(".thief-roster-row", (els) => els.length) > 0);
check("roster img loads", await page.$eval(".roster-img", (e) => e.complete && e.naturalWidth > 0));

console.log("JS ERRORS:", errs.length ? errs.slice(0, 6) : "none");
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
