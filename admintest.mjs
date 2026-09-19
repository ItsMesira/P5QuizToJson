/* Admin panel UI: path routing, login, forced password-change gate, and that
   it is not reachable without credentials. Requires devapi on 3011 + a fresh
   `npm run build`, and .admin-bootstrap.txt (seeded admin). */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const creds = Object.fromEntries(
  readFileSync(join(root, ".admin-bootstrap.txt"), "utf8")
    .split("\n")
    .map((l) => /^([a-z]+):\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
if (!creds.username || !creds.password) {
  console.log("SKIP: .admin-bootstrap.txt missing username/password");
  process.exit(0);
}

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

// 1. anonymous visitor only ever sees the login form (no data)
const p = await browser.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
await p.goto(`${BASE}/ijustlovehavingtheadminpanel`, { waitUntil: "networkidle0" });
await sleep(1500);
check("admin path routes to the panel", await p.$eval(".admin-screen", () => true).catch(() => false));
check("shows login when unauthenticated", await p.$eval(".admin-screen", (e) => e.textContent.includes("ADMIN LOGIN")).catch(() => false));
check("no admin data leaked to anon", !(await p.$eval(".admin-screen", (e) => e.textContent.includes("System") || e.textContent.includes("Users")).catch(() => false)));

// 2. wrong password rejected
const inputs = await p.$$(".admin-field input");
await inputs[0].type(creds.username);
await inputs[1].type("definitely-wrong-9999");
await p.evaluate(() => { const b = [...document.querySelectorAll(".sticker-btn")].find((x) => x.textContent.includes("SIGN IN")); if (b) b.click(); });
await sleep(900);
check("wrong password keeps login screen", await p.$eval(".admin-screen", (e) => e.textContent.includes("ADMIN LOGIN")).catch(() => false));

// 3. correct password → admin panel loads (no forced change)
await p.goto(`${BASE}/ijustlovehavingtheadminpanel`, { waitUntil: "networkidle0" });
await sleep(1200);
const ins2 = await p.$$(".admin-field input");
await ins2[0].type(creds.username);
await ins2[1].type(creds.password);
await p.evaluate(() => { const b = [...document.querySelectorAll(".sticker-btn")].find((x) => x.textContent.includes("SIGN IN")); if (b) b.click(); });
await sleep(600);
let text = "";
for (let i = 0; i < 20; i++) {
  text = await p.$eval(".admin-screen", (e) => e.textContent).catch(() => "");
  if (/ADMIN PANEL/.test(text)) break;
  await sleep(500);
}
check("admin panel loads after login", /ADMIN PANEL/.test(text) && /Users/.test(text), text.slice(0, 60));
check("no page errors", errs.length === 0, errs.join(" | "));

console.log(fails ? `\n${fails} ADMIN UI FAILURES` : "\nADMIN UI PASS");
await browser.close();
process.exit(fails ? 1 : 0);