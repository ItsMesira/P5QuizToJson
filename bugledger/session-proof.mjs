/* ============ BUG LEDGER — SESSION/BOUNCE PROOF (definitive) ============
   Establishes a session through the app's own UI (same path as authtest.mjs:
   MAKE A CLASS -> name -> CONTINUE -> CREATE ACCOUNT), logging every Set-Cookie
   header so we can tell a cookie problem from a session-restore problem.
   Then reloads #dashboard with /api/auth/me delayed and records which screen wins.

   Usage: node bugledger/session-proof.mjs [--base URL] [--delay 4000]
*/
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : args[i + 1];
};
const BASE = opt("--base", "http://localhost:3011");
const DELAY = Number(opt("--delay", "4000"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-8);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("response", async (r) => {
  if (!r.url().includes("/api/")) return;
  const sc = r.headers()["set-cookie"];
  console.log(`  [net] ${r.status()} ${r.url().replace(BASE, "")}${sc ? ` set-cookie=${sc.replace(/=[^;]+/, "=…").slice(0, 60)}` : ""}`);
});
const screenOf = () =>
  page.evaluate(() => ({
    cls: document.querySelector(".screen")?.className ?? "NONE",
    hash: location.hash,
    title: document.querySelector(".screen-title")?.textContent?.trim().slice(0, 24) ?? "",
  }));

await page.goto(`${BASE}/#entry`, { waitUntil: "networkidle0" });
await sleep(1500);
console.log("on entry root:", JSON.stringify(await screenOf()));

/* MAKE A CLASS  (hotkey 2 per uifixtest, or click) */
const texts = await page.$$eval(".entry-row", (els) => els.map((e) => e.textContent.trim().slice(0, 30)));
console.log("root rows:", JSON.stringify(texts));
const makeIdx = texts.findIndex((t) => /MAKE|CREATE/i.test(t));
if (makeIdx >= 0) await (await page.$$(".entry-row"))[makeIdx].click();
else await page.keyboard.press("2");
await sleep(800);
const nameInput = await page.$(".entry-form input");
if (nameInput) {
  await nameInput.type(`Ledger Class ${stamp}`);
  await page.evaluate(() => document.querySelector(".entry-next")?.click());
  await sleep(800);
}
console.log("after class name:", JSON.stringify(await screenOf()));

/* auth stage -> CREATE ACCOUNT */
const registerBtn = await page.$(".entry-register");
if (!registerBtn) {
  console.log("NO register form reached — evidence invalid. stage html:");
  console.log((await page.evaluate(() => document.querySelector(".entry-stage")?.outerHTML ?? "none")).slice(0, 600));
  await browser.close();
  process.exit(2);
}
const inputs = await page.$$(".entry-form input");
console.log(`auth form has ${inputs.length} inputs`);
await inputs[0].type(`sess${stamp}`);
if (inputs[1]) await inputs[1].type(`sess_${stamp}@example.com`);
await inputs[2].type("Heist#2026pass");
await registerBtn.click();
await sleep(4000);
const after = await screenOf();
console.log("after register:", JSON.stringify(after));
console.log("cookies:", (await page.cookies()).map((c) => `${c.name}(secure=${c.secure})`).join(", ") || "(none)");
if (!after.cls.includes("dashboard")) {
  console.log("=> could not establish a session through the UI; slow-session test would be invalid.");
  await browser.close();
  process.exit(3);
}
console.log("=> session established. Now testing slow /api/auth/me.");

/* slow session restore */
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.url().includes("/api/auth/me")) setTimeout(() => req.continue().catch(() => {}), DELAY);
  else req.continue().catch(() => {});
});
await page.goto(`${BASE}/#dashboard`, { waitUntil: "domcontentloaded" });
const seen = [];
for (const t of [300, 1000, 2000, 3000, 5000, 8000]) {
  await sleep(t - (seen.at(-1)?.t ?? 0));
  seen.push({ t, ...(await screenOf()) });
}
console.log(`\nreload #dashboard with /api/auth/me delayed ${DELAY}ms:`);
for (const s of seen) console.log(`  ${String(s.t).padStart(5)}ms -> ${s.cls} hash=${s.hash} "${s.title}"`);
const bounced = !seen.at(-1).cls.includes("dashboard");
console.log(`VERDICT: ${bounced ? "BOUNCED — signed-in user lost off the deep link" : "stayed on the dashboard"}`);

await browser.close();
