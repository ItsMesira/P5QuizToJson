/* UI audit: walks every screen, reports console errors, zero-size elements,
   overflow, empty interactive labels, and broken computed styles. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 150)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 150));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let matchRot2 = 0;

async function audit(label) {
  await sleep(1300);
  const report = await page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth > window.innerWidth + 4, issues: [] };
    const sel = "button, input, textarea, .menu-item, .lib-card, .prompt-card, .stat-card, .history-card, .review-row, .lb-row, .profile-card, .sample-card, .choice-btn, .order-chip, .match-btn, .seg-btn, .type-chip, .mini-toggle, .prompts-tab, .ransom .ch";
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest(".hidden")) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        out.issues.push(`ZERO-SIZE: ${el.className.toString().slice(0, 40)} "${el.textContent.trim().slice(0, 24)}"`);
        return;
      }
      if (r.bottom < -40 || r.top > window.innerHeight + 40) {
        // off-screen elements are ok in scroll containers; only flag fixed ones
        const st = getComputedStyle(el);
        if (st.position === "fixed") out.issues.push(`FIXED OFF-SCREEN: ${el.className.toString().slice(0, 40)}`);
      }
      if (el.tagName === "BUTTON" && !el.textContent.trim() && !el.getAttribute("aria-label")) {
        out.issues.push(`EMPTY BUTTON: ${el.className.toString().slice(0, 40)}`);
      }
      if (el.scrollWidth > el.clientWidth + 8 && !["TEXTAREA", "INPUT", "PRE"].includes(el.tagName)) {
        const st = getComputedStyle(el);
        // .menu-item decorated pseudo-element overhang is intentional
        if (!el.classList.contains("menu-item") && st.overflowX !== "hidden" && st.overflowX !== "auto" && st.overflowX !== "scroll" && !st.whiteSpace.includes("nowrap")) {
          out.issues.push(`OVERFLOW: ${el.className.toString().slice(0, 40)} "${el.textContent.trim().slice(0, 24)}"`);
        }
      }
    });
    // font sanity
    document.querySelectorAll(".ransom .ch, .p5-name-tag, .screen-title").forEach((el) => {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (!fs || fs < 8) out.issues.push(`TINY FONT: ${el.className}`);
    });
    // duplicate ids
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) out.issues.push(`DUP IDS: ${[...new Set(dupes)].join(",")}`);
    return out;
  });
  const clean = report.issues.length === 0 && !report.overflowX;
  console.log(`[${label}] ${clean ? "OK" : ""}${report.overflowX ? " X-OVERFLOW" : ""}${report.issues.length ? ` ${report.issues.length} issue(s)` : ""}`);
  report.issues.slice(0, 6).forEach((i) => console.log("   -", i));
}

// title
await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await audit("title");
// load
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await audit("load");
// library (needs a saved quiz → load sample first in same session)
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1100);
await page.evaluate(() => document.querySelector(".sample-card").click());
await sleep(1500);
await page.goto("http://localhost:5183/#library", { waitUntil: "networkidle0" });
await audit("library");
// library goal modal
await page.evaluate(() => document.querySelector(".goal-btn").click());
await audit("library-goal-modal");
await page.evaluate(() => document.querySelector(".goal-modal .pm-close").click());
// prompts builder
await page.goto("http://localhost:5183/#prompts", { waitUntil: "networkidle0" });
await audit("prompts-builder");
// prompts presets
await page.evaluate(() => document.querySelectorAll(".prompts-tab")[1].click());
await audit("prompts-presets");
// prompt modal
await page.evaluate(() => document.querySelector(".prompt-card .prompt-view").click());
await audit("prompt-modal");
await page.evaluate(() => document.querySelector(".pm-close").click());
// history
await page.evaluate(() => document.querySelectorAll(".prompts-tab")[2].click());
await audit("prompts-history");
// settings
await page.goto("http://localhost:5183/#settings", { waitUntil: "networkidle0" });
await audit("settings");
// profiles
await page.goto("http://localhost:5183/#profiles", { waitUntil: "networkidle0" });
await audit("profiles");
// leaderboard
await page.goto("http://localhost:5183/#leaderboard", { waitUntil: "networkidle0" });
await audit("leaderboard");
// quiz screen mid-game
await page.goto("http://localhost:5183/#load", { waitUntil: "networkidle0" });
await sleep(1100);
await page.evaluate(() => document.querySelector(".sample-card").click());
await audit("quiz-screen");
// results — play through fast
for (let i = 0; i < 100; i++) {
  await sleep(380);
  if (await page.$(".next-btn:not(.hidden)")) {
    await page.evaluate(() => document.querySelector(".next-btn").click());
    continue;
  }
  const c = await page.$(".choice-btn:not(:disabled)");
  if (c) {
    await page.evaluate(() => document.querySelector(".choice-btn:not(:disabled)").click());
    continue;
  }
  const multi = await page.$(".multi-row:not(.picked)");
  if (multi) {
    await page.evaluate(() => document.querySelector(".multi-row:not(.picked)").click());
    continue;
  }
  const fill = await page.$(".fill-input");
  if (fill) {
    await page.type(".fill-input", "42");
    await page.evaluate(() => document.querySelector(".fill-row .confirm-btn").click());
    continue;
  }
  if (await page.$(".confirm-btn:not(.hidden)")) {
    await page.evaluate(() => document.querySelector(".confirm-btn:not(.hidden)").click());
    continue;
  }
  const open = await page.$(".open-actions button");
  if (open) {
    await page.evaluate(() => document.querySelector(".open-actions button").click());
    continue;
  }
  const ls = await page.$(".match-col:first-child .match-btn.selected");
  if (ls) {
    const rights = await page.$$(".match-col:last-child .match-btn:not(.paired)");
    if (rights.length) await rights[matchRot2 % rights.length].evaluate((el) => el.click());
    matchRot2++;
  } else if (await page.$(".match-col:first-child .match-btn:not(.paired)")) {
    await page.evaluate(() => document.querySelector(".match-col:first-child .match-btn:not(.paired)").click());
  }
  if (await page.$(".rank-letter")) break;
}
await sleep(3000);
await audit("results");
// mobile viewport audit
await page.setViewport({ width: 390, height: 844 });
await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
await audit("MOBILE-title");
await page.goto("http://localhost:5183/#prompts", { waitUntil: "networkidle0" });
await audit("MOBILE-prompts");
await page.goto("http://localhost:5183/#library", { waitUntil: "networkidle0" });
await audit("MOBILE-library");

console.log("\nJS ERRORS:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();
