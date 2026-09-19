/* ============ P5 QUIZ — CSP ENFORCEMENT TEST (harsh) ============
   Serves the built dist/ with the EXACT Content-Security-Policy from
   vercel.json, then drives the app and fails on any CSP violation or blocked
   resource. This is what proves the header won't break production. */
import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const PORT = 5199;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const allHeaders = vercel.headers.flatMap((h) => h.headers ?? []);
const CSP = allHeaders.find((h) => h.key.toLowerCase() === "content-security-policy")?.value ?? "";
if (!CSP) {
  console.log("FAIL: no CSP in vercel.json");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  try { rel = decodeURIComponent(rel); } catch { rel = "/index.html"; }
  const setHeaders = (type) => ({
    "content-type": type,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
  });
  const file = join(dist, rel);
  try {
    const s = await stat(file);
    if (s.isFile() && (file === dist || file.startsWith(dist + sep))) {
      res.writeHead(200, setHeaders(MIME[extname(file)] ?? "application/octet-stream"));
      createReadStream(file).pipe(res);
      return;
    }
  } catch { /* fall through */ }
  // SPA fallback
  res.writeHead(200, { ...setHeaders("text/html"), "cache-control": "no-store" });
  createReadStream(join(dist, "index.html")).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = await browser.newPage();
const violations = [];
page.on("console", (m) => {
  const txt = m.text();
  if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following/i.test(txt)) violations.push(txt.slice(0, 180));
});
page.on("pageerror", (e) => violations.push("pageerror: " + String(e).slice(0, 160)));
await page.evaluateOnNewDocument(() => localStorage.setItem("p5q.settings", JSON.stringify({ alwaysShuffle: false })));

const routes = ["title", "load", "settings", "prompts", "library", "leaderboard", "profiles", "dashboard", "entry"];
for (const r of routes) {
  await page.goto(`http://localhost:${PORT}/#${r}`, { waitUntil: "networkidle0" });
  await sleep(900);
  const rendered = await page.$eval(".screen", () => true).catch(() => false);
  check(`route #${r} renders under CSP`, rendered);
}

// admin path under CSP
await page.goto(`http://localhost:${PORT}/ijustlovehavingtheadminpanel`, { waitUntil: "networkidle0" });
await sleep(1200);
check("admin path renders under CSP", await page.$eval(".admin-screen", () => true).catch(() => false));

// play a sample quiz (fonts/katex/audio/fetch paths)
await page.goto(`http://localhost:${PORT}/#load`, { waitUntil: "networkidle0" });
await sleep(1200);
const sample = await page.$(".sample-card");
if (sample) {
  await sample.click();
  await sleep(1800);
  check("sample quiz starts under CSP", await page.$eval(".q-count", () => true).catch(() => false));
}

check("no CSP violations / blocked resources", violations.length === 0, violations.slice(0, 4).join(" | "));
console.log(fails ? `\n${fails} CSP FAILURES` : "\nCSP ENFORCEMENT PASS");
await browser.close();
server.close();
process.exit(fails ? 1 : 0);