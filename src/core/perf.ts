/* ============ P5 QUIZ — PERFORMANCE / DEVICE TIER ============ */
/*
   One place that decides how hard we are allowed to push the device, and one
   rAF scheduler so every animated layer shares a single, frame-capped loop.

   - Desktop: 60 FPS cap.
   - Phones / tablets (iPad included): 30 FPS cap.
   - Loops pause while the tab is hidden and resume on return.
   - Reduced-motion users get a near-static experience.
*/

type FrameCb = (now: number, dt: number) => void;

const hasWindow = typeof window !== "undefined";
const hasDoc = typeof document !== "undefined";

function mq(query: string): boolean {
  if (!hasWindow || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function detectCoarse(): boolean {
  if (!hasWindow) return false;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  return mq("(pointer: coarse)") || touchPoints > 1;
}

function detectMobile(): boolean {
  if (!hasWindow) return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ masquerades as desktop Safari: MacIntel + multi-touch.
  const iPadDesktopUA = /Macintosh|MacIntel/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return (
    iPadDesktopUA ||
    /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) ||
    // no mouse-style UA but a coarse primary pointer and a small-ish viewport
    (mq("(pointer: coarse)") && window.innerWidth <= 900)
  );
}

const mobile = detectMobile();
const touch = detectCoarse();
const reducedMotion = mq("(prefers-reduced-motion: reduce)");
const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 8;
const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;

// low power: phones/tablets, or a genuinely weak desktop
const lowPower = mobile || cores <= 4 || memory <= 4 || reducedMotion;

/* ---- quality budgets ---- */
const targetFps = mobile ? 30 : 60;
// canvas dpr: retina 2x on a full-screen canvas is the #1 mobile cost
const dprCap = mobile ? 1.25 : 1.5;
const maxParticles = reducedMotion ? 120 : mobile ? 220 : lowPower ? 450 : 900;
const ambientDust = !mobile && !reducedMotion; // ambient dust keeps the canvas awake forever
const cursorTrail = !mobile && !reducedMotion;
const parallax = !mobile && !reducedMotion && !mq("(pointer: coarse)");

/* ---- unified, capped frame loop ---- */
const callbacks = new Set<FrameCb>();
let rafId = 0;
let last = 0;
let running = false;
let frames = 0;

const interval = () => 1000 / targetFps;

function tick(now: number) {
  if (!running) return;
  rafId = requestAnimationFrame(tick);
  const elapsed = now - last;
  if (elapsed < interval() - 1.5) return; // frame cap
  last = now - (elapsed % interval()); // keep phase so we don't drift
  frames++;
  const dt = Math.min(0.05, elapsed / 1000);
  for (const cb of callbacks) {
    try {
      cb(now, dt);
    } catch (err) {
      console.error("[p5q] frame callback failed:", err);
    }
  }
}

function start() {
  if (running || callbacks.size === 0 || !hasWindow) return;
  running = true;
  last = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function onFrame(cb: FrameCb): () => void {
  callbacks.add(cb);
  start();
  return () => {
    callbacks.delete(cb);
    if (callbacks.size === 0) stop();
  };
}

if (hasDoc) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
    else stop();
  });
}

/* ---- resize helper (rAF-coalesced, shared) ---- */
const resizeCbs = new Set<() => void>();
let resizeQueued = false;
function flushResize() {
  resizeQueued = false;
  for (const cb of resizeCbs) {
    try {
      cb();
    } catch (err) {
      console.error("[p5q] resize callback failed:", err);
    }
  }
}
function onResize(cb: () => void): () => void {
  resizeCbs.add(cb);
  return () => resizeCbs.delete(cb);
}
if (hasWindow) {
  const queue = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(flushResize);
  };
  window.addEventListener("resize", queue, { passive: true });
  window.addEventListener("orientationchange", queue, { passive: true });
}

/* ---- expose state on <html> so CSS can downgrade too ---- */
function apply() {
  if (!hasDoc) return;
  const root = document.documentElement;
  root.dataset.perf = lowPower ? "low" : "high";
  root.classList.toggle("is-mobile", mobile);
  root.classList.toggle("is-touch", touch);
  root.classList.toggle("is-low", lowPower);
  root.classList.toggle("reduce-motion", reducedMotion);
  const updateOrientation = () => {
    const landscape = window.innerWidth > window.innerHeight;
    root.classList.toggle("is-portrait", !landscape);
    root.classList.toggle("is-landscape", landscape);
    root.classList.toggle("is-narrow", window.innerWidth <= 600);
  };
  updateOrientation();
  onResize(updateOrientation);
  // test/debug hook: read how many capped frames have been dispatched
  (window as unknown as { __p5qPerf?: unknown }).__p5qPerf = {
    perf,
    frameCount: () => frames,
  };
}

export const perf = {
  mobile,
  touch,
  coarse: touch,
  reducedMotion,
  lowPower,
  cores,
  memory,
  targetFps,
  dprCap,
  maxParticles,
  ambientDust,
  cursorTrail,
  parallax,
  onFrame,
  onResize,
  apply,
};

export { onFrame, onResize };