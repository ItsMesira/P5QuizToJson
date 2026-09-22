import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3011";
/* The quiz route now renders the React calling-card deck once its chunk is warm
   (main.ts warms it ~1.2s after boot), and the hand-built card otherwise. Both
   are the same loader to the user, so this measures whichever is up rather than
   assuming one — and reports which, so a silent fallback cannot hide a lack of
   deck coverage. */
const WARM_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
let bad = 0;
for (const vp of [{w:320,h:568,n:"320x568"},{w:390,h:844,n:"390x844"},{w:844,h:390,n:"844x390 landscape"}]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(WARM_MS);                                  // let the deck island warm
  const quiz = { title:"M", settings:{shuffle:false,timeLimit:null}, sections:[{name:"S",questions:[{type:"multiple",question:"Q?",answers:[{text:"a",correct:true},{text:"b"}]}]}] };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(800);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  // whichever loader comes up: sample until one of them is present
  let r = { missing: true };
  for (let i = 0; i < 40; i++) {
    r = await page.evaluate(() => {
      const hand = document.querySelector("#veil .p5-loader-card");
      const deck = document.querySelector("[data-loader-card]");
      const el = hand ?? deck;
      if (!el) return { missing: true };
      const b = el.getBoundingClientRect();
      const kicker = document.querySelector("#veil .p5-loader-kicker")?.getBoundingClientRect() ?? null;
      const status = document.querySelector("#veil .p5-deck")?.lastElementChild?.getBoundingClientRect() ?? null;
      return {
        which: hand ? "hand" : "deck",
        card: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
        overflowX: b.right > innerWidth + 1 || b.left < -1,
        overflowY: b.bottom > innerHeight + 1 || b.top < -1,
        /* hand card only: its kicker must not overhang the card */
        kickerFits: kicker ? kicker.width <= b.width + 1 : true,
        /* deck only: the status bar sits BELOW the card and must fit too */
        statusFits: status ? status.bottom <= innerHeight + 1 : true,
        pageScrollX: document.documentElement.scrollWidth > innerWidth + 1,
        vw: innerWidth, vh: innerHeight,
      };
    });
    if (!r.missing) break;
    await sleep(30);
  }
  const ok = !r.missing && !r.overflowX && !r.overflowY && r.kickerFits && r.statusFits && !r.pageScrollX;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${vp.n} [${r.which ?? "?"}]: ${JSON.stringify(r)}`);
  await page.screenshot({ path: `bugledger/shots/loader-${vp.w}x${vp.h}.png` });
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} FAILURE(S)` : "LOADER MOBILE PASS");
process.exit(bad ? 1 : 0);
