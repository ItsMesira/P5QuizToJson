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
  { n: "quiz", url: "?s=quiz&quiz=/sample-quizzes/math.json" },
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


/* ---------------- quiz: every control must be reachable after scrolling ----------------
   The width sweep could not see vertical clipping: on short/landscape phones the
   question card shrank below its content and its clip-path hid answers and the
   submit button. This probe loads one question of each type and hit-tests every
   control after scrolling it into view. */
const QUIZ_VPS = [
  { n: "q320x568", w: 320, h: 568 },
  { n: "q320x448", w: 320, h: 448 }, // iPhone SE with Safari chrome showing
  { n: "q568x320", w: 568, h: 320 }, // landscape
];

function sampleQuestions() {
  const first = {};
  for (const f of ["persona5", "math", "general", "code"]) {
    try {
      const d = JSON.parse(readFileSync(`public/sample-quizzes/${f}.json`, "utf8"));
      for (const sec of d.sections ?? []) for (const q of sec.questions ?? []) if (!first[q.type]) first[q.type] = q;
    } catch { /* */ }
  }
  return first;
}

async function runQuizProbe(browser) {
  const first = sampleQuestions();
  const types = ["multiple", "boolean", "multi", "fill", "numeric", "order", "match"].filter((t) => first[t]);
  for (const vp of QUIZ_VPS) {
    const page = await browser.newPage();
    await page.emulate({ userAgent: ANDROID_UA, viewport: { width: vp.w, height: vp.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    for (const t of types) {
      const quiz = {
        title: `audit-${t}`,
        settings: { mode: "standard", timeLimit: null, shuffle: false, shuffleAnswers: false },
        sections: [{ name: "S", questions: [first[t]] }],
      };
      try {
        await page.goto(`${BASE}/?s=qz&t=${t}&v=${vp.n}#load`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
        await sleep(1000);
        await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1]?.click());
        await sleep(350);
        await page.evaluate((json) => {
          const ta = document.querySelector(".paste-area");
          if (!ta) return;
          ta.value = json;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        }, JSON.stringify(quiz));
        await page.evaluate(() => document.querySelectorAll(".load-paste .paste-actions button")[0]?.click());
        await sleep(2000);
        const r = await page.evaluate(() => {
          const stage = document.querySelector(".quiz-stage");
          if (stage) stage.scrollTop = stage.scrollHeight;
          const fails = [];
          const btns = [...document.querySelectorAll(".question-card button")].filter((b) => {
            const rr = b.getBoundingClientRect();
            return rr.width > 0 && rr.height > 0;
          });
          for (const b of btns) {
            b.scrollIntoView({ block: "center" });
            const rr = b.getBoundingClientRect();
            const top = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
            if (top !== b && !b.contains(top)) fails.push(`${(b.className || b.tagName).split(" ")[0]}@${Math.round(rr.top)}-${Math.round(rr.bottom)}`);
          }
          return { controls: btns.length, fails, onQuiz: !!stage, scroll: stage ? [stage.scrollHeight, stage.clientHeight] : null };
        });
        report.checks++;
        const bad = !r.onQuiz || r.controls === 0 || r.fails.length;
        if (bad) report.failures++;
        report.details.push({ key: `${vp.n}/quiz-${t}`, ...r, count: r.fails.length });
        if (bad) console.log(`  ${vp.n}/quiz-${t}: controls=${r.controls} fails=${r.fails.join(",")}`);
      } catch (e) {
        report.checks++;
        report.failures++;
        report.details.push({ key: `${vp.n}/quiz-${t}`, count: 1, error: String(e).slice(0, 120), fails: ["probe-error"] });
        console.log(`  ${vp.n}/quiz-${t}: ERROR ${String(e).slice(0, 100)}`);
      }
    }
    await page.close();
  }
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
  // deterministic question order for the sweep (the probe covers every type)
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })); } catch { /* */ } });
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

  /* optional: modal usability — prompt, goal and pause modals. Each must
     actually open (wrong opener selectors made an earlier version vacuous) and
     its card must fit the viewport with every button hit-testable. */
  if (has("--modals") && vp.orient === "portrait") {
    const modals = [
      {
        name: "prompt-modal", root: ".prompt-modal:not(.goal-modal)",
        open: async () => {
          await page.goto(`${BASE}/?s=pm&m=${vp.n}#prompts`, { waitUntil: "load" }).catch(() => {});
          await sleep(1500);
          await page.evaluate(() => {
            const presets = [...document.querySelectorAll(".prompts-tabs button, .seg-btn")].find((b) => b.textContent.includes("PRESETS"));
            presets?.click();
          });
          await sleep(900);
          await page.evaluate(() => document.querySelector(".prompt-view")?.click());
        },
      },
      {
        name: "goal-modal", root: ".goal-modal",
        open: async () => {
          await page.goto(`${BASE}/?s=gm&m=${vp.n}#library`, { waitUntil: "load" }).catch(() => {});
          await sleep(1500);
          await page.evaluate(() => document.querySelector(".goal-btn")?.click());
        },
      },
      {
        name: "pause-modal", root: ".pause-overlay",
        open: async () => {
          await page.goto(`${BASE}/?s=qm&m=${vp.n}&quiz=/sample-quizzes/persona5.json`, { waitUntil: "load" }).catch(() => {});
          await sleep(2500);
          await page.evaluate(() => document.querySelector(".quit-btn")?.click());
        },
      },
    ];
    for (const m of modals) {
      await m.open();
      await sleep(900);
      const isOpen = await page.$eval(m.root, (e) => !e.classList.contains("hidden") && getComputedStyle(e).display !== "none").catch(() => false);
      let r = { oversize: [], clipped: [], overflowRight: [], overflowLeft: [], small: [], docScroll: false, count: 0 };
      let badHits = [];
      if (isOpen) {
        r = await scanPersistent(page);
        badHits = await page.evaluate((sel) => {
          const bad = [];
          for (const b of document.querySelectorAll(sel + " button")) {
            const bb = b.getBoundingClientRect();
            if (bb.width === 0 || bb.height === 0) continue;
            const top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
            if (top !== b && !b.contains(top)) bad.push((b.textContent || "").trim().slice(0, 24));
          }
          return bad;
        }, m.root).catch(() => []);
      }
      report.checks++;
      const bad = (isOpen ? r.count : 1) + badHits.length;
      if (bad) report.failures++;
      report.details.push({ key: `${vp.n}/${m.name}`, open: isOpen, ...r, badHits });
      await page.evaluate((sel) => {
        const modal = document.querySelector(sel);
        const close = modal && modal.querySelector(".pm-close, .resume-btn");
        if (close) close.click();
      }, m.root).catch(() => {});
      await sleep(400);
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

if (has("--quiz")) await runQuizProbe(browser);

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