/* ============ P5 QUIZ — MOBILE LAYOUT AUDIT (Gauntlet harness) ============
   Sweeps every screen across phone portrait + landscape viewports and reports
   UI that is visibly too big, clipped off-screen, or unreachable — the things
   `mobtest.mjs` misses because `overflow-x:hidden` hides them from scrollWidth.

   Usage:
     P5Q_BASE=http://localhost:3011 node mobileaudit.mjs --label baseline
     P5Q_BASE=http://localhost:3011 node mobileaudit.mjs --label candidate
     P5Q_BASE=http://localhost:3011 node mobileaudit.mjs --label baseline --modals --rotate --resize
*/
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const args = process.argv.slice(2);
const opt = (n, d = "") => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(n);
const LABEL = opt("--label", "baseline");
const OUTDIR = `.gauntlet/artifacts/mobile`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { n: "p320x568", w: 320, h: 568, ua: ANDROID_UA, dpr: 2, orient: "portrait" },
  { n: "p360x640", w: 360, h: 640, ua: ANDROID_UA, dpr: 2, orient: "portrait" },
  { n: "p390x844", w: 390, h: 844, ua: IPHONE_UA, dpr: 3, orient: "portrait" },
  { n: "p414x896", w: 414, h: 896, ua: IPHONE_UA, dpr: 3, orient: "portrait" },
  { n: "l568x320", w: 568, h: 320, ua: IPHONE_UA, dpr: 2, orient: "landscape" },
  { n: "l740x360", w: 740, h: 360, ua: ANDROID_UA, dpr: 2, orient: "landscape" },
  { n: "l844x390", w: 844, h: 390, ua: IPHONE_UA, dpr: 3, orient: "landscape" },
];

const SCREENS = [
  { n: "title", url: "?s=title#title" },
  { n: "load", url: "?s=load#load" },
  { n: "library", url: "?s=library#library" },
  { n: "settings", url: "?s=settings#settings" },
  { n: "profiles", url: "?s=profiles#profiles" },
  { n: "leaderboard", url: "?s=leaderboard#leaderboard" },
  { n: "prompts", url: "?s=prompts#prompts" },
  { n: "entry", url: "?s=entry#entry" },
  { n: "quiz", url: "?s=quiz&quiz=/sample-quizzes/persona5.json" },
];

/* visible, user-facing content only — decorative bleed is allowed off-screen */
const DECOR = /(^|[\s])(bg-|veil-)|#ambient|#veil|#fx-canvas|#toasts|bg-star|bg-stripes|bg-halftone|bg-vignette|bg-slash|hud-tag|entry-deco|thief-deco|deco-word|stripe|slash|halftone|vignette|ransom-deco/;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
mkdirSync(join(OUTDIR, LABEL), { recursive: true });

/* credentials for the admin panel (optional) */
let creds = null;
try {
  creds = Object.fromEntries(readFileSync(join(root, ".admin-bootstrap.txt"), "utf8").split("\n")
    .map((l) => /^([a-z]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
} catch { /* no creds — admin screen skipped */ }

async function scan(page, decorAllowed = true) {
  return page.evaluate((decorSrc, allowDecor) => {
    const decor = new RegExp(decorSrc);
    const vw = window.innerWidth, vh = window.innerHeight;
    const out = { oversize: [], overflowRight: [], overflowLeft: [], clipped: [], docScroll: false, errors: [] };
    const visible = (el) => {
      try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch { /* */ }
      const r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    };
    const clippedByAncestor = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "hidden" || ox === "clip") return true;
        p = p.parentElement;
      }
      return false;
    };
    // only elements that actually paint: own text, a background, or a border.
    // transparent wrapper boxes (whose children carry the content) are skipped
    // so a transparent button bleeding off-screen is not a false positive.
    const paints = (el) => {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg && bg !== "transparent" && !/^rgba\([^)]*,\s*0(\.0+)?\)$/.test(bg)) return true;
      for (const s of ["Top", "Right", "Bottom", "Left"]) if (parseFloat(cs["border" + s + "Width"]) > 0) return true;
      return false;
    };
    const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className || "").split(" ").filter(Boolean).slice(0, 2).join(".")}`;
    for (const el of document.querySelectorAll("#app *, .admin-screen *, .pm-overlay *")) {
      if (!visible(el) || !paints(el)) continue;
      const cls = String(el.className || "");
      if (allowDecor && decor.test(cls)) continue;
      const r = el.getBoundingClientRect();
      const item = { sel: label(el), w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left) };
      if (r.width > vw + 2) out.oversize.push(item);
      if (r.right > vw + 2) (clippedByAncestor(el) ? out.clipped : out.overflowRight).push(item);
      if (r.left < -2) (clippedByAncestor(el) ? out.clipped : out.overflowLeft).push(item);
    }
    out.docScroll = document.documentElement.scrollWidth > vw + 1;
    const dedupe = (arr) => [...new Map(arr.map((x) => [x.sel + "|" + x.right, x])).values()].slice(0, 8);
    const small = [];
    for (const el of document.querySelectorAll("button, a, .sticker-btn, .seg-btn, .type-chip, .mini-toggle")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) small.push({ sel: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    out.small = dedupe(small);
    out.oversize = dedupe(out.oversize); out.overflowRight = dedupe(out.overflowRight);
    out.overflowLeft = dedupe(out.overflowLeft); out.clipped = dedupe(out.clipped);
    out.small = dedupe(out.small);
    out.count = out.oversize.length + out.overflowRight.length + out.overflowLeft.length + out.clipped.length + out.small.length + (out.docScroll ? 1 : 0);
    return out;
  }, DECOR.source, decorAllowed);
}

const report = { label: LABEL, base: BASE, at: new Date().toISOString(), viewports: {}, failures: 0, checks: 0, details: [] };

async function scanPersistent(page) {
  const a = await scan(page);
  await sleep(450);
  const b = await scan(page);
  const key = (x) => `${x.sel}|${x.right}|${x.left}`;
  const keep = (xs, ys) => xs.filter((x) => ys.some((y) => key(y) === key(x)));
  const out = {
    oversize: keep(a.oversize, b.oversize),
    overflowRight: keep(a.overflowRight, b.overflowRight),
    overflowLeft: keep(a.overflowLeft, b.overflowLeft),
    clipped: keep(a.clipped, b.clipped),
    small: keep(a.small, b.small),
    docScroll: a.docScroll && b.docScroll,
  };
  out.count = out.oversize.length + out.overflowRight.length + out.overflowLeft.length + out.clipped.length + out.small.length + (out.docScroll ? 1 : 0);
  return out;
}

async function runScreen(page, vp, screen) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  let r = null;
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    try {
      await page.goto(`${BASE}/${screen.url}`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await sleep(screen.n === "quiz" ? 2500 : 1300);
      r = await scanPersistent(page);
    } catch (e) {
      // the SPA can navigate mid-scan (detached frame); retry the screen once
      if (attempt === 1) throw e;
      await sleep(700);
    }
  }
  r.errors = errs;
  const key = `${vp.n}/${screen.n}`;
  report.checks++;
  report.details.push({ key, ...r });
  if (r.count > 0 || errs.length) report.failures++;
  await page.screenshot({ path: join(OUTDIR, LABEL, `${vp.n}-${screen.n}.png`) }).catch(() => {});
  return r;
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.emulate({ userAgent: vp.ua, viewport: { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true } });
  report.viewports[vp.n] = { orient: vp.orient, screens: {} };
  for (const screen of SCREENS) {
    const r = await runScreen(page, vp, screen);
    report.viewports[vp.n].screens[screen.n] = { count: r.count, oversize: r.oversize, clipped: r.clipped, overflowRight: r.overflowRight, overflowLeft: r.overflowLeft, small: r.small, docScroll: r.docScroll, errors: r.errors.length };
  }

  /* admin panel (mobile) — needs creds */
  if (creds?.username) {
    await page.goto(`${BASE}/ijustlovehavingtheadminpanel`, { waitUntil: "load" }).catch(() => {});
    await sleep(1400);
    const ins = await page.$$(".admin-field input");
    if (ins.length >= 2) {
      await ins[0].type(creds.username);
      await ins[1].type(creds.password);
      await page.evaluate(() => [...document.querySelectorAll(".sticker-btn")].find((x) => x.textContent.includes("SIGN IN"))?.click());
      await sleep(2500);
      const r = await scan(page);
      report.checks++;
      report.details.push({ key: `${vp.n}/admin`, ...r });
      if (r.count > 0 || r.errors.length) report.failures++;
      await page.screenshot({ path: join(OUTDIR, LABEL, `${vp.n}-admin.png`) }).catch(() => {});
      report.viewports[vp.n].screens.admin = { count: r.count, oversize: r.oversize, clipped: r.clipped, docScroll: r.docScroll, errors: r.errors.length };
    }
  }

  /* optional: modal usability (prompt modal) */
  if (has("--modals") && vp.orient === "portrait") {
    await page.goto(`${BASE}/?s=modal&m=${vp.n}#prompts`, { waitUntil: "load" }).catch(() => {});
    await sleep(1500);
    // the prompt cards live under the PRESETS tab, not the default BUILDER tab
    await page.evaluate(() => {
      const presets = [...document.querySelectorAll(".prompts-tabs button, .seg-btn")].find((b) => b.textContent.includes("PRESETS"));
      presets?.click();
    });
    await sleep(900);
    const opened = await page.evaluate(() => {
      const card = document.querySelector(".prompt-card");
      if (!card) return false;
      card.click();
      return true;
    });
    await sleep(900);
    if (opened) {
      const r = await scanPersistent(page);
      const badHits = await page.evaluate(() => {
        const bad = [];
        for (const b of document.querySelectorAll(".pm-overlay button, .pm-actions button, .pm-close")) {
          const bb = b.getBoundingClientRect();
          if (bb.width === 0 || bb.height === 0) continue;
          const top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
          if (top !== b && !b.contains(top)) bad.push((b.textContent || "").trim().slice(0, 24));
        }
        return bad;
      });
      report.checks++;
      const bad = r.count + badHits.length;
      if (bad) report.failures++;
      report.details.push({ key: `${vp.n}/modal`, ...r, badHits });
    }
  }

  /* optional: rotation + URL-bar height change */
  if (has("--rotate") || has("--resize")) {
    await page.goto(`${BASE}/#title`, { waitUntil: "load" }).catch(() => {});
    await sleep(1000);
    if (has("--rotate")) {
      await page.setViewport({ width: vp.h, height: vp.w, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
      await sleep(900);
      const r = await scan(page);
      report.viewports[vp.n].rotate = { count: r.count, oversize: r.oversize, clipped: r.clipped, docScroll: r.docScroll };
      if (r.count > 0) report.failures++;
      report.checks++;
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
      await sleep(700);
      const r2 = await scan(page);
      report.viewports[vp.n].rotateBack = { count: r2.count };
      if (r2.count > 0) report.failures++;
      report.checks++;
    }
    if (has("--resize")) {
      await page.setViewport({ width: vp.w, height: Math.max(320, vp.h - 120), deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
      await sleep(900);
      const r = await scan(page);
      report.viewports[vp.n].urlBarShrunk = { count: r.count, oversize: r.oversize, clipped: r.clipped, docScroll: r.docScroll };
      if (r.count > 0) report.failures++;
      report.checks++;
    }
  }
  await page.close();
}

await browser.close();
writeFileSync(join(OUTDIR, `${LABEL}.json`), JSON.stringify(report, null, 2) + "\n");
console.log(`# mobileaudit ${LABEL}: ${report.failures}/${report.checks} checks with violations`);
for (const [vp, v] of Object.entries(report.viewports)) {
  for (const [s, x] of Object.entries(v.screens)) {
    if (x.count) console.log(`  ${vp}/${s}: count=${x.count} oversize=${x.oversize.length} clipped=${x.clipped.length} small=${x.small?.length ?? 0} right=${x.overflowRight?.length ?? 0} docScroll=${x.docScroll}`);
  }
  if (v.rotate?.count) console.log(`  ${vp}/rotate: count=${v.rotate.count}`);
  if (v.rotateBack?.count) console.log(`  ${vp}/rotateBack: count=${v.rotateBack.count}`);
  if (v.rotateBack?.count) console.log(`  ${vp}/rotateBack: count=${v.rotateBack.count}`);
  if (v.urlBarShrunk?.count) console.log(`  ${vp}/urlBarShrunk: count=${v.urlBarShrunk.count}`);
}
process.exit(report.failures ? 1 : 0);