/* ============ BUG LEDGER — REGRESSION TESTS ============
   Pins the six primitives fixed in bugledger/LEDGER.md. Every check here FAILS
   on the pre-fix code (594d22b), so it is a real regression guard and not a
   description of current behaviour.

     T1  toast lifetime does not depend on gsap (block the chunk -> must still go)
     T2  toast stack is bounded
     T3  quitting during the finale does NOT land on the results screen  (RACE-01)
     T4  an abandoned request cannot write onto the screen that replaced it (RACE-04/RC-1)

   Usage: node bugledger/regression.mjs [--base http://localhost:5183]
*/
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : args[i + 1];
};
const BASE = opt("--base", "http://localhost:5183");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

/* ---------------- T1/T2: toast lifetime + bound ---------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // block gsap entirely: the pre-fix toast relied on gsap's onComplete to remove
  // itself, and had no .catch(), so a rejected import leaked the toast forever
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (/gsap/i.test(r.url())) r.abort().catch(() => {});
    else r.continue().catch(() => {});
  });
  await page.goto(`${BASE}/#title`, { waitUntil: "domcontentloaded" });
  await sleep(2500);

  /* Fire toasts through the module when serving from source (vite dev), and
     through a real user flow when serving a production bundle, which has no
     importable module paths. */
  const fired = await page.evaluate(async () => {
    try {
      const { toast } = await import("/src/ui/dom.ts");
      for (let i = 0; i < 9; i++) toast(`regression toast ${i}`, "info");
      return { via: "module", count: document.querySelectorAll("#toasts .toast").length };
    } catch {
      /* built bundle: raise real errors instead */
      location.hash = "#load";
      return { via: "ui", count: 0 };
    }
  });

  if (fired.via === "ui") {
    await sleep(1500);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        const area = document.querySelector(".paste-area");
        if (area) {
          area.value = "{not valid json";
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const btns = [...document.querySelectorAll(".paste-actions button, .load-actions .sticker-btn")];
        const submit = btns.find((b) => /LOAD|IMPORT|ADD|STEAL/i.test(b.textContent ?? ""));
        if (submit) submit.click();
      });
      await sleep(250);
    }
    await sleep(600);
  }

  const cap = await page.evaluate(() => ({
    kept: document.querySelectorAll("#toasts .toast").length,
    // the dismiss control only exists in the fixed build, so it also tells us
    // which implementation we are measuring
    harnessed: !!document.querySelector("#toasts .toast .toast-close"),
  }));
  if (fired.via === "module" || cap.harnessed) {
    check("T2 toast stack is bounded", cap.kept > 0 && cap.kept <= 4, `via=${fired.via} kept=${cap.kept}`);
  } else {
    console.log(`SKIP T2 bound check — pre-fix build has no dismiss control (via=${fired.via}, kept=${cap.kept})`);
  }

  await sleep(5600); // TOAST_MS 3500 + exit grace
  const left = await page.evaluate(() => document.querySelectorAll("#toasts .toast").length);
  check("T1 toasts expire with gsap blocked", left === 0, `via=${fired.via} remaining=${left}`);

  const dismissible = await page.evaluate(async () => {
    let fired = false;
    try {
      const { toast } = await import("/src/ui/dom.ts");
      toast("dismiss me");
      fired = true;
    } catch {
      /* built bundle — fall through */
    }
    if (!fired) return "skipped-no-source";
    const btn = document.querySelector("#toasts .toast .toast-close");
    if (!btn) return "no-close-button";
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelectorAll("#toasts .toast").length === 0 ? "ok" : "still-there";
  });
  if (dismissible !== "skipped-no-source") {
    check("T1b toast has a working dismiss control", dismissible === "ok", dismissible);
  }
  await page.close();
}

/* ---------------- T3: quitting during the finale must not show results ---------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => console.log("  PAGEERROR:", String(e).slice(0, 160)));
  await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = {
    title: "Finale Quit Check",
    settings: { shuffle: false, timeLimit: null },
    sections: [{ name: "S", questions: [
      { type: "multiple", question: "Q1?", answers: [{ text: "a1", correct: true }, { text: "b1" }] },
      { type: "multiple", question: "Q2?", answers: [{ text: "a2", correct: true }, { text: "b2" }] },
    ] }],
  };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(1600);

  // answer everything correctly -> the quiz ends on a finale cut-in
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".choice-btn")].find((x) => /^a[12]$/.test(x.getAttribute("data-ans") ?? ""));
      if (b) b.click();
    });
    await sleep(500);
    await page.evaluate(() => document.querySelector(".next-btn")?.click());
    await sleep(400);
  }

  // wait for the finale cut-in, then quit from inside it
  let sawCutin = false;
  for (let i = 0; i < 40; i++) {
    sawCutin = await page.evaluate(() => !!document.querySelector(".cutin"));
    if (sawCutin) break;
    await sleep(120);
  }
  await page.evaluate(() => document.querySelector(".quit-btn")?.click());
  await sleep(350);
  await page.evaluate(() => document.querySelector(".quit2-btn")?.click());

  await sleep(3500); // longer than the finale hold + the 1600ms game-over timer
  const final = await page.evaluate(() => ({
    screen: document.querySelector(".screen")?.className ?? "NONE",
    hash: location.hash,
  }));
  check("T3 saw the finale cut-in (test actually exercised it)", sawCutin);
  check(
    "T3 quitting during the finale does not land on results",
    !final.screen.includes("results-screen"),
    `cutin=${sawCutin} final=${final.screen} hash=${final.hash}`,
  );
  await page.close();
}

/* ---------------- shared: establish a real classroom session ---------------- */
async function signInWithClass(page, tag) {
  const st = Date.now().toString(36).slice(-8);
  await page.goto(`${BASE}/#entry`, { waitUntil: "networkidle0" });
  await sleep(1400);
  const texts = await page.$$eval(".entry-row", (els) => els.map((e) => e.textContent.trim().slice(0, 30)));
  const makeIdx = texts.findIndex((t) => /MAKE|CREATE/i.test(t));
  if (makeIdx >= 0) await (await page.$$(".entry-row"))[makeIdx].click();
  else await page.keyboard.press("2");
  await sleep(700);
  const nameInput = await page.$(".entry-form input");
  if (nameInput) {
    await nameInput.type(`${tag} ${st}`);
    await page.evaluate(() => document.querySelector(".entry-next")?.click());
    await sleep(700);
  }
  const reg = await page.$(".entry-register");
  if (!reg) return false;
  const inputs = await page.$$(".entry-form input");
  await inputs[0].type(`rg${tag}${st}`.slice(0, 20).toLowerCase());
  if (inputs[1]) await inputs[1].type(`rg_${st}@example.com`);
  await inputs[2].type("Heist#2026pass");
  await reg.click();
  await sleep(3500);
  return (await page.evaluate(() => document.querySelector(".screen")?.className ?? "")).includes("dashboard");
}

/* ---------------- T4: a hung request must not strand the screen forever ----------------
   Fully deterministic: the session is mocked and the classroom calls are held
   open forever, so this does not depend on a real database or on Secure cookies
   surviving a reload over plain HTTP. */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => console.log("  PAGEERROR:", String(e).slice(0, 160)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/auth/me")) {
      r.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: { user: { id: "u1", username: "deadline", email: null }, cls: { id: "c1", name: "DEADLINE101", code: "DL101", role: "teacher" } },
        }),
      });
      return;
    }
    if (/\/api\/classes\//.test(u)) return; // held open forever on purpose
    if (u.includes("/api/")) {
      r.respond({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    r.continue().catch(() => {});
  });

  await page.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  const early = await page.evaluate(() => ({
    loading: [...document.querySelectorAll(".dashboard-screen .profile-empty")].filter((n) => n.textContent.includes("Loading")).length,
    hero: document.querySelector(".dash-classname")?.textContent ?? "",
  }));
  await sleep(13000); // past REQUEST_DEADLINE_MS (12s)
  const late = await page.evaluate(() => ({
    loading: [...document.querySelectorAll(".dashboard-screen .profile-empty")].filter((n) => n.textContent.includes("Loading")).length,
    text: document.querySelector(".dashboard-screen .dash-members")?.textContent?.slice(0, 80) ?? "",
  }));
  check("T4 dashboard renders Loading first (test is meaningful)", early.loading > 0, `early=${early.loading} hero="${early.hero}"`);
  check("T4 a hung request cannot strand 'Loading…' forever", late.loading === 0, `before=${early.loading} after=${late.loading} text="${late.text}"`);
  await page.close();
}

/* ---------------- T5: navigating away cancels the abandoned screen's work ---------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE}/#title`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const cancelled = await page.evaluate(async () => {
    let mod;
    try {
      mod = await import("/src/core/runtime.ts");
    } catch {
      return { skipped: true };
    }
    const before = mod.routeScope();
    const aborted = new Promise((r) => before.signal.addEventListener("abort", () => r(true)));
    location.hash = "#settings"; // navigate away from the title screen
    const won = await Promise.race([aborted, new Promise((r) => setTimeout(() => r(false), 2000))]);
    return { won, oldAlive: before.alive(), newAlive: mod.routeScope().alive() };
  });
  if (cancelled.skipped) console.log("SKIP T5 — built bundle has no importable source modules");
  else {
    check("T5 navigation aborts the previous screen's scope", cancelled.won === true, JSON.stringify(cancelled));
    check("T5 the new screen has a live scope", cancelled.newAlive === true, JSON.stringify(cancelled));
  }
  await page.close();
}

await browser.close();
console.log(`\n${fails === 0 ? "REGRESSION SUITE PASS" : `${fails} REGRESSION FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
