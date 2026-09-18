/* P5 QUIZ — mobile/tablet responsive + performance-cap verification.
   Sweeps real device ratios (portrait + landscape), checks for overflow and
   clipped controls, verifies touch targets, and asserts the frame caps
   (60fps desktop / 30fps mobile) actually hold. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5183";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--mute-audio"],
});

async function openDevice(dev) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.emulate({
    userAgent: dev.ua,
    viewport: {
      width: dev.w,
      height: dev.h,
      deviceScaleFactor: dev.dpr ?? 2,
      isMobile: true,
      hasTouch: true,
    },
  });
  return { page, errs };
}

/* ---------- 1. device/ratio sweep ---------- */
const DEVICES = [
  { name: "Galaxy Fold narrow 280x653", w: 280, h: 653, ua: ANDROID_UA, dpr: 2.5 },
  { name: "iPhone SE 320x568", w: 320, h: 568, ua: IPHONE_UA, dpr: 2 },
  { name: "Android small 360x640", w: 360, h: 640, ua: ANDROID_UA, dpr: 2 },
  { name: "iPhone 12 390x844", w: 390, h: 844, ua: IPHONE_UA, dpr: 3 },
  { name: "iPhone Plus 414x896", w: 414, h: 896, ua: IPHONE_UA, dpr: 3 },
  { name: "iPhone Max 430x932", w: 430, h: 932, ua: IPHONE_UA, dpr: 3 },
  { name: "Android 412x915", w: 412, h: 915, ua: ANDROID_UA, dpr: 2.6 },
  { name: "SE landscape 568x320", w: 568, h: 320, ua: IPHONE_UA, dpr: 2 },
  { name: "Pixel landscape 740x360", w: 740, h: 360, ua: ANDROID_UA, dpr: 2 },
  { name: "iPhone landscape 844x390", w: 844, h: 390, ua: IPHONE_UA, dpr: 3 },
  { name: "Fold open 673x841", w: 673, h: 841, ua: ANDROID_UA, dpr: 2 },
  { name: "iPad mini 768x1024", w: 768, h: 1024, ua: IPAD_UA, dpr: 2 },
  { name: "iPad Air 820x1180", w: 820, h: 1180, ua: IPAD_UA, dpr: 2 },
  { name: "iPad landscape 1024x768", w: 1024, h: 768, ua: IPAD_UA, dpr: 2 },
  { name: "iPad Pro landscape 1180x820", w: 1180, h: 820, ua: IPAD_UA, dpr: 2 },
];

for (const dev of DEVICES) {
  const { page, errs } = await openDevice(dev);
  await page.goto(`${BASE}/#title`, { waitUntil: "load" });
  await sleep(1500);
  const r = await page.evaluate(() => {
    const out = { overflow: false, cut: false, mobile: false, perf: "", issues: [] };
    out.overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
    out.mobile = document.documentElement.classList.contains("is-mobile");
    out.perf = document.documentElement.dataset.perf ?? "";
    const rect = (s) => {
      const e = document.querySelector(s);
      return e ? e.getBoundingClientRect() : null;
    };
    const menu = rect("#menu");
    const hudB = rect("#hud-bottom");
    const last = document.querySelector(".menu-item:last-child");
    if (last && last.getBoundingClientRect().bottom > window.innerHeight + 1) out.cut = true;
    if (menu && hudB && hudB.height > 0 && menu.bottom > hudB.top + 2) out.issues.push("menu-hud");
    const name = rect("#big-name");
    if (name && name.right > window.innerWidth + 2) out.issues.push("name-x");
    const tag = rect("#tagline");
    if (tag && tag.right > window.innerWidth + 2) out.issues.push("tagline-x");
    return out;
  });
  const ok = !r.overflow && !r.cut && r.issues.length === 0 && r.mobile && r.perf === "low" && errs.length === 0;
  check(
    `layout @ ${dev.name}`,
    ok,
    [r.overflow && "x-overflow", r.cut && "menu-cut", ...r.issues, !r.mobile && "no-is-mobile", r.perf !== "low" && `perf=${r.perf}`, errs[0]].filter(Boolean).join(","),
  );
  await page.close();
}

/* ---------- 2. every screen: no horizontal overflow on a phone & an iPad ---------- */
const SCREENS = ["title", "load", "library", "settings", "profiles", "leaderboard", "prompts", "entry", "dashboard"];
for (const dev of [
  { name: "phone 390x844", w: 390, h: 844, ua: IPHONE_UA, dpr: 3 },
  { name: "phone landscape 844x390", w: 844, h: 390, ua: IPHONE_UA, dpr: 3 },
  { name: "iPad 820x1180", w: 820, h: 1180, ua: IPAD_UA, dpr: 2 },
]) {
  const { page, errs } = await openDevice(dev);
  const issues = [];
  for (const s of SCREENS) {
    await page.goto(`${BASE}/#${s}`, { waitUntil: "load" });
    await sleep(950);
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const els = [...document.querySelectorAll(".screen *")];
      let widest = null;
      let maxRight = window.innerWidth + 2;
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > maxRight + 1) {
          maxRight = b.right;
          widest = el.className || el.tagName;
        }
      }
      return { over: de.scrollWidth > window.innerWidth + 2, widest, screen: document.body.dataset.screen };
    });
    if (r.over) issues.push(`${s}:x-overflow(${String(r.widest).slice(0, 40)})`);
  }
  check(`no screen overflows @ ${dev.name}`, issues.length === 0, issues.join(" ") || errs[0] || "");
  check(`no JS errors @ ${dev.name}`, errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------- 3. touch targets ---------- */
{
  const { page, errs } = await openDevice({ w: 390, h: 844, ua: IPHONE_UA, dpr: 3 });
  await page.goto(`${BASE}/#settings`, { waitUntil: "load" });
  await sleep(1200);
  const small = await page.evaluate(() => {
    const out = [];
    const want = [...document.querySelectorAll("button, .sticker-btn, .seg-btn, .type-chip, .mini-toggle, input[type=range]")];
    for (const el of want) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.height < 26 || b.width < 22) out.push(`${el.className || el.tagName}:${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return out;
  });
  check("touch targets are not hairline", small.length === 0, small.slice(0, 4).join(" ") || errs[0] || "");
  await page.close();
}

/* ---------- 4. frame caps ---------- */
// measure entirely inside the page against ONE reference to the perf module,
// so a late module swap can never mix two counters
async function sampleFps(page, ms = 1600) {
  await sleep(400);
  return page.evaluate(async (dur) => {
    const P = window.__p5qPerf;
    if (!P) return { fps: -1, target: -1 };
    const f0 = P.frameCount();
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, dur));
    const elapsed = performance.now() - t0;
    return { fps: (P.frameCount() - f0) / (elapsed / 1000), target: P.perf.targetFps };
  }, ms);
}

{
  // desktop
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#title`, { waitUntil: "load" });
  await sleep(1400);
  const tier = await page.evaluate(() => ({
    perf: document.documentElement.dataset.perf,
    mobile: document.documentElement.classList.contains("is-mobile"),
    fps: window.__p5qPerf?.perf?.targetFps,
    ambient: getComputedStyle(document.querySelector("#bg-stripes"), "::before").animationName,
  }));
  let fps = await sampleFps(page);
  for (let i = 0; i < 2 && !(fps.target === 60 && fps.fps >= 52 && fps.fps <= 64); i++) fps = await sampleFps(page);
  check("desktop tier is high", tier.perf === "high" && !tier.mobile, JSON.stringify(tier));
  check("desktop keeps ambient drift", tier.ambient !== "none", tier.ambient);
  check("desktop capped at 60fps", fps.target === 60 && fps.fps >= 52 && fps.fps <= 64, `target=${fps.target} ${fps.fps.toFixed(1)}fps`);
  check("desktop: no JS errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

{
  // mobile
  const { page, errs } = await openDevice({ w: 390, h: 844, ua: IPHONE_UA, dpr: 3 });
  await page.goto(`${BASE}/#title`, { waitUntil: "load" });
  await sleep(1400);
  const tier = await page.evaluate(() => ({
    perf: document.documentElement.dataset.perf,
    mobile: document.documentElement.classList.contains("is-mobile"),
    fps: window.__p5qPerf?.perf?.targetFps,
  }));
  let fps = await sampleFps(page);
  for (let i = 0; i < 2 && !(fps.target === 30 && fps.fps >= 24 && fps.fps <= 33); i++) fps = await sampleFps(page);
  check("mobile tier is low", tier.perf === "low" && tier.mobile, JSON.stringify(tier));
  check("mobile capped at 30fps", fps.target === 30 && fps.fps >= 24 && fps.fps <= 33, `target=${fps.target} ${fps.fps.toFixed(1)}fps`);
  // the downgrades must actually reach the compositor, not just set a dataset flag
  await page.goto(`${BASE}/#load`, { waitUntil: "load" });
  await sleep(1000);
  const css = await page.evaluate(() => ({
    blur: getComputedStyle(document.querySelector(".load-head")).backdropFilter,
    ambient: getComputedStyle(document.querySelector("#bg-stripes"), "::before").animationName,
    blend: getComputedStyle(document.querySelector("#bg-halftone")).mixBlendMode,
  }));
  check("mobile: blur backdrops removed", css.blur === "none", css.blur);
  check("mobile: ambient drift disabled", css.ambient === "none", css.ambient);
  check("mobile: halftone blend removed", css.blend === "normal", css.blend);
  check("mobile: no JS errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "\nDONE — all mobile/perf checks passed" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);