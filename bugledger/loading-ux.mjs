/* Verify (a) lazy KaTeX still renders $…$ math, (b) the nav lock does not block
   legitimate back-to-back navigation, (c) spam clicking is absorbed. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/* run-suite.mjs passes the base as P5Q_BASE, not argv — without this the suite
   silently tested the default target instead of the one it was told to. */
const BASE = process.argv[2] ?? process.env.P5Q_BASE ?? "http://localhost:3011";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });

/* (a) math renders, and katex is only fetched because this quiz needs it */
{
  const page = await browser.newPage();
  const fetched = [];
  page.on("request", (r) => {
    if (/katex/i.test(r.url())) fetched.push(r.url().split("/").pop());
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = {
    title: "Math Lazy Check",
    settings: { shuffle: false, timeLimit: null },
    sections: [{ name: "S", questions: [
      { type: "multiple", question: "What is $x^2$ when $x=3$?", answers: [{ text: "$9$", correct: true }, { text: "$6$" }] },
    ] }],
  };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(2500);
  const math = await page.evaluate(() => ({
    katexNodes: document.querySelectorAll(".katex").length,
    rawDollar: (document.querySelector(".q-text-inner")?.textContent ?? "").includes("$"),
    text: document.querySelector(".q-text-inner")?.textContent?.slice(0, 40) ?? "",
  }));
  check("math renders with the lazy KaTeX loader", math.katexNodes > 0, JSON.stringify(math));
  check("katex chunk was fetched on demand", fetched.length > 0, fetched.slice(0, 3).join(","));
  await page.close();
}

/* (a2) a math-free quiz must NOT fetch katex at all */
{
  const page = await browser.newPage();
  const fetched = [];
  page.on("request", (r) => {
    if (/katex/i.test(r.url())) fetched.push(r.url());
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = {
    title: "No Math Check",
    settings: { shuffle: false, timeLimit: null },
    sections: [{ name: "S", questions: [
      { type: "multiple", question: "Plain text question?", answers: [{ text: "yes", correct: true }, { text: "no" }] },
    ] }],
  };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(2500);
  check("math-free quiz never downloads KaTeX (~261 kB saved)", fetched.length === 0, `fetchCount=${fetched.length}`);
  await page.close();
}

/* (b) legitimate back-to-back navigation still works */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#title`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const seq = [];
  for (const h of ["#settings", "#profiles", "#library", "#title"]) {
    await page.evaluate((hash) => { location.hash = hash; }, h);
    await sleep(1100);
    seq.push(await page.evaluate(() => document.querySelector(".screen")?.className?.split(" ")[1] ?? "none"));
  }
  check(
    "four sequential navigations all land",
    seq.join(",") === "settings-screen,profiles-screen,library-screen,title-screen",
    seq.join(" -> "),
  );
  await page.close();
}

/* (c) spam clicking stays contained */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = {
    title: "Spam Check",
    settings: { shuffle: false, timeLimit: null },
    sections: [{ name: "S", questions: [{ type: "multiple", question: "Q?", answers: [{ text: "a", correct: true }, { text: "b" }] }] }],
  };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  /* real pointer input: a programmatic .click() never fires pointerdown, so it
     cannot prove the acknowledgement path a real user triggers */
  const box = await page.evaluate(() => {
    const b = document.querySelectorAll(".paste-actions button")[0].getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  const ackOnPress = await page.evaluate(() =>
    document.querySelectorAll(".paste-actions button")[0].className.includes("is-busy"),
  );
  await page.mouse.up();
  for (let i = 0; i < 9; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await sleep(45);
  }
  const spam = { busyAck: ackOnPress };
  await sleep(3000);
  const after = await page.evaluate(() => ({
    screens: document.querySelectorAll(".screen").length,
    quizScreens: document.querySelectorAll(".quiz-screen").length,
    loaders: document.querySelectorAll("#veil .p5-loader").length,
    hash: location.hash,
  }));
  check("first click is acknowledged immediately (is-busy)", spam.busyAck, JSON.stringify(spam));
  check("spam produces exactly one screen", after.screens === 1 && after.quizScreens === 1, JSON.stringify(after));
  check("no loader left behind", after.loaders === 0, JSON.stringify(after));
  check("no page errors during spam", errs.length === 0, errs.join(" | "));
  await page.close();
}

/* (d) D1 — the busy mark must not outlive the press, and it must render.
   The old suite only asserted the class was ADDED, which is why a mark that
   never came off shipped green. */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#load`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const quiz = {
    title: "Busy Check",
    settings: { shuffle: false, timeLimit: null },
    sections: [{ name: "S", questions: [
      { type: "multiple", question: "Pick one?", answers: [{ text: "a", correct: true }, { text: "b" }] },
    ] }],
  };
  await page.evaluate(() => document.querySelectorAll(".load-actions .sticker-btn")[1].click());
  await sleep(400);
  await page.click(".paste-area");
  await page.type(".paste-area", JSON.stringify(quiz));
  await page.evaluate(() => document.querySelectorAll(".paste-actions button")[0].click());
  await sleep(2200);

  const box = await page.evaluate(() => {
    const b = document.querySelector(".q-answers .choice-btn").getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  const held = await page.evaluate(() => {
    const el = document.querySelector(".q-answers .choice-btn");
    return { busy: !!el?.classList.contains("is-busy"), opacity: getComputedStyle(el).opacity };
  });
  /* drag off before releasing: no click fires, so the question does not advance
     and the very same button can be re-measured afterwards */
  await page.mouse.move(20, 20);
  await page.mouse.up();
  await sleep(700);
  const settled = await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".q-answers .choice-btn")];
    return {
      busy: document.querySelectorAll(".is-busy").length,
      opacity: btns.map((b) => getComputedStyle(b).opacity),
      transform: btns.map((b) => getComputedStyle(b).transform),
    };
  });
  const identity = (t) => t === "none" || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(t);
  check("press mark renders on hold (computed opacity drops)", held.busy && Number(held.opacity) < 1, JSON.stringify(held));
  check("press mark is gone once the press ends", settled.busy === 0, JSON.stringify(settled));
  check(
    "no answer stays dimmed or skewed after being pressed",
    settled.opacity.every((o) => o === "1") && settled.transform.every(identity),
    JSON.stringify(settled),
  );
  await page.close();
}

/* (e) D2 — overlapping navigations must not fight over the screen. Previously
   the loser's teardown released the winner's lock and retired its loader, and
   two mounts raced on one `cleanup` slot.

   The first navigation's chunk is deliberately delayed so it resolves AFTER the
   one that supersedes it — that inversion is what makes the loser mount last
   and clobber the winner. Without the delay both chunks resolve together and
   the race is invisible (which is exactly why the old suite never caught it). */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (/leaderboard-.*\.js/.test(r.url())) setTimeout(() => r.continue(), 900);
    else r.continue();
  });
  await page.goto(`${BASE}/#title`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.evaluate(() => {
    location.hash = "#leaderboard"; // slow: its chunk is held for 900ms
    setTimeout(() => { location.hash = "#settings"; }, 80); // fast: arrives first
  });
  await sleep(4000);
  const a = await page.evaluate(() => {
    const s = document.querySelector(".screen");
    return {
      screens: document.querySelectorAll(".screen").length,
      cls: s?.className.split(" ").find((c) => c.endsWith("-screen")) ?? "none",
      hash: location.hash,
      dataset: document.body.dataset.screen ?? "",
      loaders: document.querySelectorAll("#veil .p5-loader").length,
      veil: getComputedStyle(document.getElementById("veil")).opacity,
    };
  });
  check("a superseded navigation cannot mount over the winner", a.cls === "settings-screen", JSON.stringify(a));
  check("overlapping navigations leave exactly one screen", a.screens === 1, JSON.stringify(a));
  check(
    "newest navigation wins; URL, dataset and mounted screen all agree",
    a.hash === `#${a.dataset}` && a.cls === `${a.dataset}-screen`,
    JSON.stringify(a),
  );
  check("a superseded navigation leaves no loader and no veil behind", a.loaders === 0 && a.veil === "0", JSON.stringify(a));

  /* interception stays on (its handler continues everything else); disabling it
     here cancels the requests already routed through it */
  await page.evaluate(() => { location.hash = "#profiles"; });
  await sleep(1800);
  const b = await page.evaluate(() => ({
    cls: document.querySelector(".screen")?.className.split(" ").find((c) => c.endsWith("-screen")) ?? "none",
    hash: location.hash,
  }));
  check("navigation still works after a supersede (no lock-out)", b.cls === "profiles-screen" && b.hash === "#profiles", JSON.stringify(b));
  await page.close();
}

/* (f) D3 — the loader must cover the veil's dark window end to end. Sampled
   against .veil-bg, not #veil: the veil's own opacity goes to 1 immediately,
   while it is still a transparent container, so sampling #veil reports "dark"
   frames the user never sees. */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#title`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.evaluate(() => {
    const veil = document.getElementById("veil");
    const bg = veil.querySelector(".veil-bg");
    window.__veil = { darkWithoutCard: 0, sawCard: 0, samples: 0 };
    window.__probe = setInterval(() => {
      const f = window.__veil;
      const dark = Number(getComputedStyle(bg).opacity) > 0.5;
      const card = !!document.querySelector("#veil .p5-loader.visible");
      f.samples++;
      if (card) f.sawCard++;
      if (dark && !card) f.darkWithoutCard++;
    }, 25);
  });
  /* a cold route, so the chunk fetch makes the transition window real */
  await page.evaluate(() => { location.hash = "#leaderboard"; });
  await sleep(3000);
  const frames = await page.evaluate(() => { clearInterval(window.__probe); return window.__veil; });
  check("loader actually appeared during the transition (non-vacuous)", frames.sawCard > 0, JSON.stringify(frames));
  check("no dark-and-empty frame during the transition", frames.darkWithoutCard === 0, JSON.stringify(frames));
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "\nLOADING-UX SUITE PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
