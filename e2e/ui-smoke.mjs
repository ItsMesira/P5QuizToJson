/* ============ P5 QUIZ — BROWSER SMOKE (login-free) ============ */
/* Short Playwright smoke of the built app served by devapi (dist/), using the
   system Chrome via channel:"chrome" (no browser download). No login, no
   fixtures. Proves: title renders, #load shows sample cards, the paste overlay
   opens, a sample starts a question screen, and the pause → ABANDON HEIST path
   returns to the title. Selector choices are logged (role/text vs CSS).

   Must finish in <60s.

   Run:  P5Q_BASE=http://localhost:3013 node e2e/ui-smoke.mjs                */

import { BASE, browser, check, results, sleep } from "./lib.mjs";

/* Hard budget guard: the deliverable promises <60s. */
const watchdog = setTimeout(() => {
  console.log("FAIL smoke exceeded the 60s budget");
  process.exit(1);
}, 58_000);

const selectorLog = [];
const note = (s) => selectorLog.push(s);

/* Resolve a control by role → text → CSS (first that exists), recording which
   rung of the ladder was used so the report can flag CSS fallbacks. */
async function pick(page, label, spec, { waitMs = 20_000 } = {}) {
  const candidates = [];
  if (spec.role) candidates.push({ kind: "role", via: `getByRole(${spec.role}, ${spec.name})`, loc: page.getByRole(spec.role, { name: spec.name }) });
  if (spec.text) candidates.push({ kind: "text", via: `getByText(${spec.text})`, loc: page.getByText(spec.text) });
  if (spec.css) candidates.push({ kind: "css", via: `locator(${spec.css})`, loc: page.locator(spec.css) });

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      let n = 0;
      try {
        n = await c.loc.count();
      } catch {
        continue;
      }
      if (n > 0) {
        const entry = `${label}: ${c.kind} (${c.via})${c.kind === "css" ? "  [CSS FALLBACK]" : ""}`;
        note(entry);
        return c.loc.first();
      }
    }
    await sleep(150);
  }
  note(`${label}: NOT FOUND (tried ${candidates.map((c) => c.via).join(", ")})`);
  return null;
}

let b = null;
try {
  b = await browser();
  const page = await b.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  /* 1) title screen */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const titleTag = await pick(page, "title 'P5 QUIZ'", { text: /P5 QUIZ/, css: "#hud-top .hud-tag" });
  const docTitle = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(
    "title renders (contains 'P5 QUIZ')",
    !!titleTag && /P5 QUIZ/.test(docTitle) && bodyText.includes("P5 QUIZ"),
    `document.title="${docTitle}"`,
  );

  /* 2) load screen via hash + sample cards */
  await page.goto(`${BASE}/#load`, { waitUntil: "domcontentloaded" });
  const cards = page.locator(".sample-card");
  let cardCount = 0;
  try {
    await cards.first().waitFor({ state: "visible", timeout: 20_000 });
    cardCount = await cards.count();
  } catch {
    /* leave count at 0 */
  }
  note("sample cards: CSS (.sample-card)  [task-specified selector, not a fallback]");
  check("load screen (#load) shows ≥4 sample cards", cardCount >= 4, `count=${cardCount}`);

  /* 3) paste overlay opens */
  const pasteBtn = await pick(page, "paste button", {
    role: "button",
    name: /PASTE JSON/i,
    text: /PASTE JSON/i,
    css: ".load-actions .sticker-btn:nth-child(2)",
  });
  let pasteOpen = false;
  if (pasteBtn) {
    await pasteBtn.click();
    try {
      await page.locator(".load-paste:not(.hidden)").first().waitFor({ state: "visible", timeout: 10_000 });
      pasteOpen = true;
    } catch {
      /* leave closed */
    }
  }
  note("paste overlay: CSS (.load-paste:not(.hidden))  [state check, no dialog role]");
  check("'📋 PASTE JSON' opens the paste overlay", !!pasteBtn && pasteOpen, `found=${!!pasteBtn}`);

  /* close the fixed overlay so it cannot intercept the sample click */
  const cancel = await pick(page, "paste cancel", {
    role: "button",
    name: /^CANCEL$/i,
    text: /^CANCEL$/i,
    css: ".load-paste .paste-actions .paste-cancel",
  });
  if (cancel) {
    await cancel.click();
    await page.locator(".load-paste:not(.hidden)").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }

  /* 4) first sample starts a question screen */
  let questionShown = false;
  try {
    await cards.first().click({ timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const t = document.querySelector(".quiz-screen .q-text");
        const answers = document.querySelectorAll(".quiz-screen .q-answers button");
        return !!t && (t.textContent || "").trim().length > 0 && answers.length > 0;
      },
      null,
      { timeout: 25_000 },
    );
    questionShown = true;
  } catch {
    /* leave false */
  }
  note("question screen: CSS state (.quiz-screen .q-text non-empty + .q-answers button)  [state check]");
  check("starting the first sample opens a question screen", questionShown, `url=${page.url()}`);

  /* 5) pause → ABANDON HEIST → back to title */
  const quit = await pick(page, "pause/quit button", { role: "button", name: /pause or quit/i, css: ".quit-btn" });
  let paused = false;
  if (quit) {
    await quit.click();
    try {
      await page.locator(".pause-overlay:not(.hidden)").waitFor({ state: "visible", timeout: 10_000 });
      paused = true;
    } catch {
      /* leave false */
    }
  }
  check("quiz pause overlay opens", !!quit && paused, `found=${!!quit}`);

  const abandon = paused
    ? await pick(page, "abandon button", { role: "button", name: /ABANDON HEIST/i, text: /ABANDON HEIST/i, css: ".quit2-btn" })
    : null;
  let backHome = false;
  if (abandon) {
    await abandon.click();
    try {
      await page.locator("#hud-top .hud-tag").first().waitFor({ state: "visible", timeout: 20_000 });
      backHome = true;
    } catch {
      /* leave false */
    }
  }
  check("quit → ABANDON HEIST returns to the title screen", backHome, `url=${page.url()}`);

  check("no uncaught page errors during the smoke", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  check("smoke harness completed without throwing", false, String(e).slice(0, 200));
  console.error(e);
} finally {
  clearTimeout(watchdog);
  if (b) await b.close().catch(() => {});
  console.log("\n--- selector log (which rung of role/text/css was used) ---");
  for (const s of selectorLog) console.log(s);
  console.log(results.fails ? `\n${results.fails} FAILURE(S)` : "\nALL PASS");
  process.exit(results.fails ? 1 : 0);
}
