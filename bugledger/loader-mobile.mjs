import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3011";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
let bad = 0;
for (const vp of [{w:320,h:568,n:"320x568"},{w:390,h:844,n:"390x844"},{w:844,h:390,n:"844x390 landscape"}]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = { title:"M", settings:{shuffle:false,timeLimit:null}, sections:[{name:"S",questions:[{type:"multiple",question:"Q?",answers:[{text:"a",correct:true},{text:"b"}]}]}] };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(420);
  const r = await page.evaluate(() => {
    const card = document.querySelector("#veil .p5-loader-card");
    if (!card) return { missing: true };
    const b = card.getBoundingClientRect();
    const kicker = card.querySelector(".p5-loader-kicker").getBoundingClientRect();
    return {
      card: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      overflowX: b.right > innerWidth + 1 || b.left < -1,
      overflowY: b.bottom > innerHeight + 1 || b.top < -1,
      kickerFits: kicker.width <= b.width + 1,
      pageScrollX: document.documentElement.scrollWidth > innerWidth + 1,
      vw: innerWidth, vh: innerHeight,
    };
  });
  const ok = !r.missing && !r.overflowX && !r.overflowY && r.kickerFits && !r.pageScrollX;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${vp.n}: ${JSON.stringify(r)}`);
  await page.screenshot({ path: `bugledger/shots/loader-${vp.w}x${vp.h}.png` });
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} FAILURE(S)` : "LOADER MOBILE PASS");
process.exit(bad ? 1 : 0);
