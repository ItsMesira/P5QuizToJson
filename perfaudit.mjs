/* ============ P5 QUIZ — LOAD-PATH PERFORMANCE AUDIT (Gauntlet harness) ============
   Deterministic before/after measurement of the P0 gates:
     G1 non-blocking boot  — time-to-title-screen while /api/** is delayed 3s
     G2 first-load bytes   — eager JS+CSS+font bytes under Fast 3G, cache off
     G3 music size         — public/audio/background.mp3 byte size
     G4 font payload       — font files fetched on an English first load
     G5 asset caching      — (--headers) Cache-Control on production

   Usage:
     P5Q_BASE=http://localhost:3011 node perfaudit.mjs --label baseline
     P5Q_BASE=http://localhost:3011 node perfaudit.mjs --label candidate --baseline .gauntlet/artifacts/baseline.json
     node perfaudit.mjs --headers https://www.tykunanon.online
*/
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const args = process.argv.slice(2);
const opt = (name, def = "") => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const has = (name) => args.includes(name);
const LABEL = opt("--label", "candidate");
const OUT = opt("--out", `.gauntlet/artifacts/${LABEL}.json`);
const BASELINE = opt("--baseline", "");
const DELAY_MS = Number(opt("--api-delay", "3000"));
const CSS_BUDGET = Number(opt("--css-budget", "0.85"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MUSIC = "public/audio/background.mp3";
const FONT_BAD = /cyrillic|greek|vietnamese|latin-ext|latin-ext/i;

/* ---------------- --headers mode: production cache headers ---------------- */
if (has("--headers")) {
  const target = opt("--headers") || BASE;
  const rootRes = await fetch(target + "/");
  const html = await rootRes.text();
  const asset = /src="([^"]*assets\/[^"]+\.js)"/.exec(html)?.[1] ?? "";
  const assetUrl = asset ? new URL(asset, target + "/").href : "";
  const assetRes = assetUrl ? await fetch(assetUrl) : null;
  const report = {
    target,
    html: { "cache-control": rootRes.headers.get("cache-control") },
    asset: { url: assetUrl, "cache-control": assetRes?.headers.get("cache-control") ?? null },
  };
  report.pass = {
    G5_asset_immutable: /immutable/.test(report.asset["cache-control"] ?? ""),
    G5_html_not_immutable: !/immutable/.test(report.html["cache-control"] ?? ""),
  };
  console.log(JSON.stringify({ label: "headers", ...report }, null, 2));
  process.exit(report.pass.G5_asset_immutable && report.pass.G5_html_not_immutable ? 0 : 1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

/* ---------------- G1: time-to-title with the API delayed ---------------- */
async function measureBoot() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/\/api\//.test(req.url())) setTimeout(() => req.continue().catch(() => {}), DELAY_MS);
    else req.continue().catch(() => {});
  });
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
  let ms = -1;
  try {
    await page.waitForFunction(
      () => !!document.querySelector("#app .screen-title, #app .title-screen, #app .menu-item"),
      { timeout: 15000, polling: 50 },
    );
    ms = Date.now() - t0;
  } catch {
    ms = -1;
  }
  await ctx.close();
  return ms;
}

/* ---------------- G2/G4: eager bytes + fonts under Fast 3G ---------------- */
async function measureBytes() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  const meta = new Map();
  const bytes = { Document: 0, Script: 0, Stylesheet: 0, Font: 0 };
  const fonts = new Set();
  client.on("Network.responseReceived", (e) => {
    meta.set(e.requestId, { url: e.response.url, type: e.type, mime: e.response.mimeType });
  });
  client.on("Network.loadingFinished", (e) => {
    const m = meta.get(e.requestId);
    if (!m) return;
    if (bytes[m.type] !== undefined) bytes[m.type] += e.encodedDataLength || 0;
    if (m.type === "Font") fonts.add(m.url.split("/").pop());
  });
  await page.goto(BASE + "/", { waitUntil: "load" }).catch(() => {});
  await sleep(4500);
  await ctx.close();
  const eagerBytes = bytes.Document + bytes.Script + bytes.Stylesheet + bytes.Font;
  return { eagerBytes, bytes, fonts: [...fonts] };
}

const bootMs = await measureBoot();
const { eagerBytes, bytes, fonts } = await measureBytes();
let musicBytes = -1;
try {
  musicBytes = statSync(MUSIC).size;
} catch {
  /* missing */
}

const report = {
  label: LABEL,
  base: BASE,
  at: new Date().toISOString(),
  g1_title_ms_api_delayed_3s: bootMs,
  g2_eager_bytes: eagerBytes,
  g2_bytes: bytes,
  g3_music_bytes: musicBytes,
  g4_font_files: fonts,
  g4_unintended_fonts: fonts.filter((f) => FONT_BAD.test(f)),
};

/* ---------------- compare against baseline ---------------- */
if (BASELINE) {
  const b = JSON.parse(readFileSync(BASELINE, "utf8"));
  report.baseline = {
    g1_title_ms_api_delayed_3s: b.g1_title_ms_api_delayed_3s,
    g2_eager_bytes: b.g2_eager_bytes,
    g2_bytes: b.g2_bytes,
    g3_music_bytes: b.g3_music_bytes,
  };
  report.pass = {
    G1_boot_under_1200ms: bootMs >= 0 && bootMs < 1200,
    G2_bytes_no_growth: eagerBytes <= b.g2_eager_bytes,
    G2_css_within_budget: b.g2_bytes?.Stylesheet ? bytes.Stylesheet <= Math.floor(b.g2_bytes.Stylesheet * CSS_BUDGET) : false,
    G3_music_le_1_5MB: musicBytes > 0 && musicBytes <= 1_500_000,
    G4_only_intended_fonts: report.g4_unintended_fonts.length === 0,
  };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.pass) process.exit(Object.values(report.pass).every(Boolean) ? 0 : 1);