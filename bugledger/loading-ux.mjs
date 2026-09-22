/* Verify (a) lazy KaTeX still renders $…$ math, (b) the nav lock does not block
   legitimate back-to-back navigation, (c) spam clicking is absorbed. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] ?? "http://localhost:3011";
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

await browser.close();
console.log(fails === 0 ? "\nLOADING-UX SUITE PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
