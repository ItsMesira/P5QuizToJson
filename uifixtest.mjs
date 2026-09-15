/* P5 QUIZ — UI fix verification: menu geometry sweep, entry back/ESC chain,
   veil watchdog, signed-in-without-class dashboard. */
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

/* ---------- 1. main menu geometry sweep ---------- */
{
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  const sizes = [[320, 568], [375, 667], [414, 896], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [1920, 1080], [1440, 700]];
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h });
    await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
    await sleep(1600);
    const issues = await page.evaluate(() => {
      const out = [];
      const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const overlap = (a, c, n) => { if (a && c && a.right > c.left + 1 && a.left < c.right - 1 && a.bottom > c.top + 1 && a.top < c.bottom - 1) out.push("overlap:" + n); };
      overlap(rect("#hud-top"), rect("#menu"), "hudtop-menu");
      overlap(rect("#hud-bottom"), rect("#menu"), "hudbottom-menu");
      overlap(rect("#tagline"), rect("#menu"), "tagline-menu");
      overlap(rect("#hud-top"), rect("#intro-eyebrow"), "hudtop-eyebrow");
      overlap(rect("#hud-top"), rect("#big-name"), "hudtop-name");
      if (document.documentElement.scrollWidth > innerWidth + 4) out.push("x-overflow");
      const last = document.querySelector(".menu-item:last-child");
      if (last && last.getBoundingClientRect().bottom > innerHeight) out.push("last-item-cut");
      return out;
    });
    check(`menu geometry clean @ ${w}x${h}`, issues.length === 0, issues.join(","));
  }
  check("menu hint says 1-6", await page.evaluate(() => document.getElementById("hud-bottom").textContent.includes("1-6")));
  check("menu sweep: no JS errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------- 2. entry back button + ESC chain ---------- */
{
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/#entry", { waitUntil: "networkidle0" });
  await sleep(1800);
  check("entry root has BACK TO MENU", await page.evaluate(() => !!document.querySelector(".entry-back-menu")));

  await page.evaluate(() => [...document.querySelectorAll(".entry-btn")].find((b) => b.textContent.includes("JOIN A CLASS"))?.click());
  await sleep(800);
  const inJoin = await page.evaluate(() => !!document.querySelector(".entry-next") && !!document.querySelector(".entry-sub"));
  check("JOIN sub-stage opened", inJoin);
  await page.keyboard.press("Escape");
  await sleep(800);
  check("ESC steps sub-stage back to root", await page.evaluate(() => !!document.querySelector(".entry-rows")));
  await page.keyboard.press("Escape");
  await sleep(1900);
  const routed = await page.evaluate(() => document.querySelector(".screen")?.className ?? "NONE");
  check("ESC from root escapes to title menu", routed.includes("title-screen"), routed);

  await page.goto("http://localhost:5183/#entry", { waitUntil: "networkidle0" });
  await sleep(1700);
  await page.evaluate(() => document.querySelector(".entry-back-menu")?.click());
  await sleep(1900);
  const routed2 = await page.evaluate(() => document.querySelector(".screen")?.className ?? "NONE");
  check("BACK TO MENU button routes to title", routed2.includes("title-screen"), routed2);
  check("entry flow: no JS errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------- 3. veil watchdog (stalled transition recovery) ---------- */
{
  const page = await browser.newPage();
  await page.goto("http://localhost:5183/#title", { waitUntil: "networkidle0" });
  await sleep(1600);
  await page.evaluate(() => { document.getElementById("veil").style.opacity = "1"; });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await sleep(3200);
  const op = await page.evaluate(() => getComputedStyle(document.getElementById("veil")).opacity);
  check("stuck veil force-cleared after tab wake", op === "0", `opacity=${op}`);
  await page.close();
}

/* ---------- 4. signed in but no class → NO CLASSROOM YET ---------- */
{
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/auth/me")) {
      req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: { user: { id: "u1", username: "demo", email: null }, cls: null } }),
      });
    } else if (url.includes("/api/")) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    } else {
      req.continue();
    }
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/#dashboard", { waitUntil: "networkidle0" });
  await sleep(2800);
  const state = await page.evaluate(() => ({
    screen: document.querySelector(".screen")?.className ?? "NONE",
    title: document.querySelector(".dash-empty-title")?.textContent ?? "",
    cols: !!document.querySelector(".dash-columns"),
    back: !!document.querySelector(".back-btn"),
  }));
  check("refresh #dashboard keeps session (no bounce to entry)", state.screen.includes("dashboard-screen"), state.screen);
  check("no-class dashboard shows NO CLASSROOM YET panel", state.title === "NO CLASSROOM YET", state.title);
  check("no-class dashboard hides member columns + keeps back button", !state.cols && state.back);
  await page.evaluate(() => document.querySelector(".back-btn")?.click());
  await sleep(1900);
  const after = await page.evaluate(() => document.querySelector(".screen")?.className ?? "NONE");
  check("no-class dashboard back button works", after.includes("title-screen"), after);
  await context.close();
}

/* ---------- 5. classroom revamp: hover, hotkeys, double-submit, inline errors ---------- */
{
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/#entry", { waitUntil: "networkidle0" });
  await sleep(2100);

  const t0 = await page.evaluate(() => getComputedStyle(document.querySelector(".entry-row")).transform);
  await page.hover(".entry-row");
  await sleep(400);
  const t1 = await page.evaluate(() => getComputedStyle(document.querySelector(".entry-row")).transform);
  check("entry row hover transform applies after intro", t0 !== t1, `${t0} -> ${t1}`);

  await page.keyboard.press("2");
  await sleep(600);
  check("hotkey 2 opens MAKE A CLASS", await page.evaluate(() => !!document.querySelector(".entry-next")));
  await page.keyboard.press("Escape");
  await sleep(600);
  check("ESC returns to root rows", await page.evaluate(() => !!document.querySelector(".entry-rows")));

  for (const [w, h] of [[1440, 900], [1280, 720], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(1900);
    const issues = await page.evaluate(() => {
      const out = [];
      const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const panel = rect(".entry-panel");
      const rb = rect(".entry-rows");
      if (rb && panel && rb.bottom > panel.bottom - 4) out.push("rows-overflow");
      if (panel && (panel.bottom > innerHeight + 2 || panel.left < -2)) out.push("panel-offscreen");
      if (document.documentElement.scrollWidth > innerWidth + 4) out.push("x-overflow");
      return out;
    });
    check(`classroom layout clean @ ${w}x${h}`, issues.length === 0, issues.join(","));
  }
  check("classroom revamp: no JS errors", errs.length === 0, errs[0] ?? "");
  await page.close();
}

/* ---------- 6. auth double-submit lock + inline error ---------- */
{
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  let loginCalls = 0;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().includes("/api/auth/login")) {
      loginCalls++;
      setTimeout(() => req.respond({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "bad credentials" }) }), 700);
    } else if (req.url().includes("/api/")) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    } else req.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:5183/#entry", { waitUntil: "networkidle0" });
  await sleep(2100);
  await page.evaluate(() => [...document.querySelectorAll(".entry-row")].find((r) => r.textContent.includes("LOG IN"))?.click());
  await sleep(700);
  await page.evaluate(() => {
    const inputs = document.querySelectorAll(".entry-form input");
    inputs[0].value = "phantom_test";
    inputs[2].value = "longpassword123";
  });
  await page.evaluate(() => { const btn = document.querySelector(".entry-login"); btn.click(); btn.click(); btn.click(); });
  await sleep(1700);
  check("triple-click sends exactly 1 login request", loginCalls === 1, String(loginCalls));
  check("inline error shown on bad login", (await page.evaluate(() => document.querySelector(".entry-error")?.textContent ?? "")).length > 3);
  await page.evaluate(() => { const i = document.querySelector(".entry-form input"); i.dispatchEvent(new Event("input", { bubbles: true })); });
  check("typing clears the inline error", await page.evaluate(() => document.querySelector(".entry-error")?.classList.contains("hidden") ?? false));
  await context.close();
}

console.log("DONE —", fails === 0 ? "all checks passed" : `${fails} FAILED`);
await browser.close();
process.exit(fails ? 1 : 0);
