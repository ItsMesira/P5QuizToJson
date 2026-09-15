/* P5 QUIZ — language system verification: coverage, ransom integrity, layout, persistence. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

const LOCALES = ["th", "es", "fr", "de", "ja"];
const ROUTES = ["title", "entry", "settings", "library", "profiles", "leaderboard", "load", "prompts"];

for (const loc of LOCALES) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.setViewport({ width: 1440, height: 900 });

  for (const route of ROUTES) {
    await page.goto(`http://localhost:5183/?lang=${loc}#${route}`, { waitUntil: "networkidle0" });
    await sleep(1100);
  }

  const missing = await page.evaluate(() => (window.__p5qMissingKeys ? window.__p5qMissingKeys() : ["NO-HOOK"]));
  check(`${loc}: no missing keys after walking all screens`, missing.length === 0, missing.slice(0, 8).join(" | "));

  const lang = await page.evaluate(() => document.documentElement.lang);
  check(`${loc}: <html lang> set`, lang === loc, lang);

  /* persistence: reload without param keeps the locale */
  await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
  await sleep(1400);
  const persisted = await page.evaluate(() => document.documentElement.lang);
  check(`${loc}: locale persists across reload`, persisted === loc, persisted);

  check(`${loc}: no JS errors`, errs.length === 0, errs[0] ?? "");
  await context.close();
}

/* ---------- Thai/Japanese main-menu band sweeps (row heights differ per script) ---------- */
{
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [loc, h] of [["th", 960], ["th", 900], ["th", 870], ["th", 850], ["th", 820], ["th", 801], ["ja", 900], ["ja", 820]]) {
    await page.setViewport({ width: 1440, height: h });
    await page.goto(`http://localhost:5183/?lang=${loc}#title`, { waitUntil: "networkidle0" });
    await sleep(1500);
    const r = await page.evaluate(() => {
      const menu = document.querySelector("#menu")?.getBoundingClientRect();
      const hudB = document.querySelector("#hud-bottom")?.getBoundingClientRect();
      const name = document.querySelector("#big-name")?.getBoundingClientRect();
      return {
        overlap: menu && hudB ? Math.round(menu.bottom - hudB.top) : 0,
        nameTop: Math.round(name?.top ?? 0),
        xo: document.documentElement.scrollWidth > innerWidth + 4,
      };
    });
    check(`${loc} menu clears HUD @1440x${h}`, r.overlap <= 0 && r.nameTop > 30 && !r.xo, JSON.stringify(r));
  }
  /* very short viewports may scroll instead — assert the content is reachable, HUD never hides it forever */
  await page.setViewport({ width: 844, height: 390 });
  await page.goto("http://localhost:5183/?lang=th#title", { waitUntil: "networkidle0" });
  await sleep(1500);
  const shortOk = await page.evaluate(() => {
    const scroller = document.querySelector(".title-screen");
    return !!scroller && scroller.scrollHeight > scroller.clientHeight;
  });
  check("th tiny landscape viewport falls back to scrolling", shortOk);
  await page.close();
}

/* ---------- Thai playthrough → fully localized grade screen ---------- */
{
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jsClick = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/?lang=th#load", { waitUntil: "networkidle0" });
  await sleep(1600);
  const quiz = { title: "ทดสอบภาษาไทย", sections: [{ name: "ส่วน", questions: [
    { type: "boolean", question: "คำถาม?", answers: [{ text: "จริง", correct: true }, { text: "เท็จ" }] },
    { type: "multiple", question: "อีกข้อ?", answers: [{ text: "ก", correct: true }, { text: "ข" }] },
  ] }] };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(500);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(1600);
  for (let i = 0; i < 30; i++) {
    await sleep(450);
    if (await page.$eval(".rank-letter", () => true).catch(() => false)) break;
    if (await jsClick(".next-btn:not(.hidden)")) continue;
    await jsClick(".choice-btn:not(:disabled)");
  }
  await sleep(500);
  const grade = await page.evaluate(() => {
    const lbl = document.querySelector(".rank-label");
    const sub = document.querySelector(".rank-sub");
    const aot = document.querySelector(".aot-title");
    const th = /[\u0E00-\u0E7F]/;
    return {
      label: lbl?.textContent ?? "",
      sub: sub?.textContent ?? "",
      labelThai: !!lbl && th.test(lbl.textContent ?? ""),
      subThai: !!sub && th.test(sub.textContent ?? ""),
      subClip: lbl ? lbl.scrollWidth > lbl.clientWidth + 6 : false,
      aotLH: aot ? parseFloat(getComputedStyle(aot).lineHeight) : 0,
      aotFont: aot ? parseFloat(getComputedStyle(aot).fontSize) : 0,
      xo: document.documentElement.scrollWidth > innerWidth + 4,
    };
  });
  check("th grade label localized", grade.labelThai, grade.label);
  check("th grade subtitle localized", grade.subThai, grade.sub);
  check("th grade label not clipped", !grade.subClip);
  check("th finale line-height scales with tall glyphs", grade.aotLH >= grade.aotFont * 1.2, `lh=${grade.aotLH} font=${grade.aotFont}`);
  check("th results no x-overflow", !grade.xo);
  const missing = await page.evaluate(() => window.__p5qMissingKeys?.() ?? ["NO-HOOK"]);
  check("th: no missing keys after full playthrough", missing.length === 0, missing.slice(0, 6).join(" | "));

  /* mobile results */
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1800);
  const mob = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 4);
  check("th results no x-overflow on mobile", !mob);
  await page.close();
}

/* ---------- Thai specifics: ransom graphemes + fonts ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/?lang=th#title", { waitUntil: "networkidle0" });
  await sleep(2100);
  const ransom = await page.evaluate(() => {
    const first = document.querySelector("#menu .menu-ransom");
    const spans = first ? [...first.querySelectorAll(".ch")].map((c) => c.textContent) : [];
    const combining = /^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]$/;
    const reassembled = spans.join("");
    const full = first?.textContent ?? "";
    return { count: spans.length, broken: spans.some((c) => combining.test(c)), ok: reassembled === full && full.length > 0 };
  });
  check("th: ransom keeps Thai graphemes intact", ransom.ok && !ransom.broken, JSON.stringify(ransom));
  const font = await page.evaluate(() => {
    const el = document.querySelector("#menu .menu-ransom .ch");
    return el ? getComputedStyle(el).fontFamily : "";
  });
  check("th: Kanit fallback in display stack", font.includes("Kanit"), font);
  await page.close();
}

/* ---------- layout under long strings (German is longest) ---------- */
{
  const page = await browser.newPage();
  await page.goto("http://localhost:5183/?lang=de#title", { waitUntil: "networkidle0" });
  for (const [w, h] of [[1440, 900], [1280, 720], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(1800);
    const issues = await page.evaluate(() => {
      const out = [];
      const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const menu = rect("#menu");
      const bottom = rect("#hud-bottom");
      if (menu && bottom && menu.bottom > bottom.top) out.push("menu-hud-collision");
      if (document.documentElement.scrollWidth > innerWidth + 4) out.push("x-overflow");
      const last = document.querySelector(".menu-item:last-child");
      if (last && last.getBoundingClientRect().bottom > innerHeight) out.push("last-item-cut");
      return out;
    });
    check(`de layout clean @ ${w}x${h}`, issues.length === 0, issues.join(","));
  }
  await page.goto("http://localhost:5183/?lang=de#entry", { waitUntil: "networkidle0" });
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1900);
  const entryIssues = await page.evaluate(() => {
    const out = [];
    const panel = document.querySelector(".entry-panel")?.getBoundingClientRect();
    const rows = document.querySelector(".entry-rows")?.getBoundingClientRect();
    if (panel && rows && rows.bottom > panel.bottom - 4) out.push("rows-overflow");
    if (document.documentElement.scrollWidth > innerWidth + 4) out.push("x-overflow");
    return out;
  });
  check("de entry layout clean @ 390x844", entryIssues.length === 0, entryIssues.join(","));
  await page.close();
}

/* ---------- settings picker switches language live ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/#settings", { waitUntil: "networkidle0" });
  await sleep(1800);
  await page.evaluate(() => document.querySelector('[data-lang="th"]')?.click());
  await sleep(1900);
  const lang = await page.evaluate(() => document.documentElement.lang);
  const title = await page.evaluate(() => document.querySelector(".screen-title")?.textContent ?? "");
  check("picker switches to Thai live", lang === "th" && title === "ตั้งค่า", `${lang} / ${title}`);
  await page.close();
}

console.log("DONE —", fails === 0 ? "all checks passed" : `${fails} FAILED`);
await browser.close();
process.exit(fails ? 1 : 0);
