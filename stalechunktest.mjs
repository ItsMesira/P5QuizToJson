/* P5 QUIZ — stale-build recovery.
   A tab that outlives a deploy asks for a route chunk whose hash no longer
   exists, so the dynamic import fails and the screen goes blank (black page
   with just the class badge). The router must reload once to fetch the current
   build, and must not enter a reload loop if the chunk is genuinely gone. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5183";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

async function open({ abortAll }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  let aborted = 0;
  let navs = 0;
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const chunk = /\/assets\/dashboard-.*\.js/.test(u) || /\/src\/ui\/dashboard\.ts/.test(u);
    if (chunk && (abortAll || aborted === 0)) { aborted++; req.abort("failed"); return; }
    if (u.includes("/api/auth/me")) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { user: { id: "u1", username: "blue", email: null }, cls: { id: "c1", name: "MEP4", code: "AWW7XC", role: "teacher" } } }) });
    } else if (u.includes("/api/")) {
      req.respond({ status: 200, contentType: "application/json", body: "{}" });
    } else req.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  // remember any toast that appears (they auto-dismiss quickly)
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    const watch = () => {
      const root = document.getElementById("toasts");
      if (!root) return;
      new MutationObserver(() => root.querySelectorAll(".toast").forEach((t) => window.__toasts.push(t.textContent))).observe(root, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
    else watch();
  });
  await page.goto(`${BASE}/#dashboard`, { waitUntil: "load" });
  return { ctx, page, getAborted: () => aborted, getNavs: () => navs };
}

/* 1. stale chunk → reload → dashboard appears */
{
  const { ctx, page, getAborted, getNavs } = await open({ abortAll: false });
  await sleep(5200);
  const st = await page.evaluate(() => ({
    screen: document.querySelector(".screen")?.className ?? "NONE",
    hero: document.querySelector(".dash-classname")?.textContent ?? "",
  }));
  check("stale chunk recovers to the dashboard", st.screen.includes("dashboard-screen") && st.hero === "MEP4", JSON.stringify(st));
  check("recovery reloads exactly once", getNavs() === 2 && getAborted() === 1, `navs=${getNavs()} aborted=${getAborted()}`);
  await ctx.close();
}

/* 2. chunk genuinely missing → one reload, then a toast (no loop) */
{
  const { ctx, page, getAborted, getNavs } = await open({ abortAll: true });
  await sleep(5200);
  // toasts auto-dismiss, so read everything that ever appeared
  const st = await page.evaluate(() => {
    const seen = [];
    const root = document.getElementById("toasts");
    if (root) root.querySelectorAll(".toast").forEach((t) => seen.push(t.textContent));
    return { screen: document.querySelector(".screen")?.className ?? "NONE", seen, recorded: window.__toasts ?? [] };
  });
  const said = [st.seen.join(" "), (st.recorded ?? []).join(" ")].join(" ");
  check("missing chunk does not loop reloading", getNavs() <= 3, `navs=${getNavs()} aborted=${getAborted()}`);
  check("missing chunk surfaces a message", /out of date|reload/i.test(said), `screen=${st.screen} toasts=${JSON.stringify(said.slice(0, 120))}`);
  await ctx.close();
}

await browser.close();
console.log(fails === 0 ? "\nDONE — stale-build recovery works" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);