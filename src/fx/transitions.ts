/* ============ P5 QUIZ — GSAP TRANSITION / CHOREOGRAPHY HELPERS ============ */
import gsap from "gsap";
import { audio } from "../core/audio";
import { fx } from "./particles";
import { randomPortrait } from "../core/art";
import { isHexColor } from "../core/theme";

export const RM = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- typewriter: sets text node content char by char with tick sfx ---- */
export function typewriter(
  el: HTMLElement,
  text: string,
  opts: { speed?: number; tick?: boolean; onDone?: () => void } = {},
) {
  const speed = opts.speed ?? 16;
  el.textContent = "";
  if (RM()) {
    el.textContent = text;
    opts.onDone?.();
    return;
  }
  let i = 0;
  const id = window.setInterval(() => {
    i += 1 + Math.floor(Math.random() * 2);
    el.textContent = text.slice(0, i);
    if (opts.tick !== false && i % 2 === 0) audio.sfx("tick");
    if (i >= text.length) {
      window.clearInterval(id);
      el.textContent = text;
      opts.onDone?.();
    }
  }, speed);
}

export function cancelTypewriters(scope: HTMLElement) {
  scope.querySelectorAll("[data-typing='1']").forEach((el) => {
    const full = el.getAttribute("data-full");
    if (full) (el as HTMLElement).textContent = full;
    el.removeAttribute("data-typing");
  });
}

export function type(el: HTMLElement, text: string, speed = 16, tick = true) {
  el.setAttribute("data-typing", "1");
  el.setAttribute("data-full", text);
  return typewriter(el, text, { speed, tick });
}

/* ---- slamText: word-by-word pop-in with squash ---- */
export function slamText(el: HTMLElement, opts: { stagger?: number; from?: string; dur?: number } = {}) {
  if (RM()) return gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 });
  const words = el.querySelectorAll<HTMLElement>("[data-w]");
  const targets = words.length ? words : [el];
  if (!words.length) {
    const text = el.textContent ?? "";
    el.textContent = "";
    el.setAttribute("data-w", "");
    const frag = document.createDocumentFragment();
    text.split(" ").forEach((w) => {
      const span = document.createElement("span");
      span.setAttribute("data-w", "");
      span.textContent = w;
      frag.append(span, " ");
    });
    el.append(frag);
    return gsap.fromTo(
      el.querySelectorAll("[data-w]"),
      { y: opts.from === "left" ? -30 : 26, opacity: 0, rotate: opts.from === "left" ? 8 : -8 },
      { y: 0, opacity: 1, rotate: 0, duration: opts.dur ?? 0.45, stagger: opts.stagger ?? 0.04, ease: "back.out(1.8)" },
    );
  }
  return gsap.fromTo(
    targets,
    { y: 26, opacity: 0, rotate: -8 },
    { y: 0, opacity: 1, rotate: 0, duration: opts.dur ?? 0.45, stagger: opts.stagger ?? 0.05, ease: "back.out(1.8)" },
  );
}

/* ---- glitch: rapid clip/skew jitter ---- */
export function glitch(el: HTMLElement, times = 3, dur = 0.3) {
  if (RM()) return;
  const tl = gsap.timeline();
  for (let i = 0; i < times; i++) {
    tl.to(el, {
      duration: dur / times / 2,
      x: () => (Math.random() - 0.5) * 14,
      skewX: () => (Math.random() - 0.5) * 10,
      opacity: 0.7,
      ease: "none",
    }).to(el, { duration: dur / times / 2, x: 0, skewX: 0, opacity: 1, ease: "none" });
  }
  return tl;
}

/* ---- hitStop: freeze a beat, then resume with a flash ---- */
export async function hitStop(ms = 120) {
  if (RM()) return;
  await new Promise((r) => setTimeout(r, ms));
}

/* ---- slashWipe: the signature P5 stripe sweep transition ---- */
export function slashWipe(veil: HTMLElement, dir: "in" | "out" = "in"): Promise<void> {
  return new Promise((resolve) => {
    if (RM()) {
      resolve();
      return;
    }
    const stripes = veil.querySelectorAll<HTMLElement>(".veil-stripe");
    const slash = veil.querySelector<HTMLElement>(".veil-slash");
    const bg = veil.querySelector<HTMLElement>(".veil-bg");
    veil.style.opacity = "1";
    const delays = [0, 0.05, 0.1];
    let done = false;
    let failsafe = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(failsafe);
      resolve();
    };
    const tl = gsap.timeline({ onComplete: finish });
    // watchdog: backgrounded tabs pause rAF and can strand a wipe mid-flight,
    // leaving the black veil up — force-clear instead of hanging forever
    failsafe = window.setTimeout(() => {
      if (done) return;
      console.warn("[p5q] transition stalled — force-clearing veil");
      tl.kill();
      veil.style.opacity = "0";
      finish();
    }, 1700);
    if (dir === "in") {
      audio.sfx("slash");
      fx.slashes(3);
      tl.set(veil, { opacity: 1 })
        .fromTo(bg, { opacity: 0 }, { opacity: 1, duration: 0.16 }, 0.24);
      stripes.forEach((s, i) => {
        tl.fromTo(
          s,
          { yPercent: -130 },
          { yPercent: 0, duration: 0.5, delay: delays[i], ease: "power3.inOut" },
          0,
        );
      });
      tl.fromTo(slash, { yPercent: -130, opacity: 1 }, { yPercent: 0, duration: 0.44, ease: "power2.in" }, 0.05);
    } else {
      audio.sfx("whoosh");
      stripes.forEach((s, i) => {
        tl.to(s, { yPercent: 130, duration: 0.45, delay: delays[i], ease: "power3.inOut" }, 0);
      });
      tl.to(slash, { yPercent: 130, duration: 0.4, ease: "power2.in" }, 0.04)
        .to(bg, { opacity: 0, duration: 0.22 }, 0.05)
        .set(veil, { opacity: 0 });
    }
  });
}

/* ---- comicWipe: panel-by-panel wipe (for library/menus) ---- */
export function comicWipe(el: HTMLElement, dir: "in" | "out" = "in"): Promise<void> {
  return new Promise((resolve) => {
    if (RM()) {
      resolve();
      return;
    }
    audio.sfx("whoosh");
    const tl = gsap.timeline({ onComplete: () => resolve() });
    if (dir === "in") {
      tl.fromTo(el, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.4, ease: "power3.inOut" });
    } else {
      tl.to(el, { clipPath: "inset(0 100% 0 0)", duration: 0.3, ease: "power2.in" });
    }
  });
}

/* ---- cutIn: P5 portrait freeze-frame slam (real art, CSS fallback) ---- */
export function cutIn(
  scope: HTMLElement,
  opts: { name?: string; letter?: string; color?: string; img?: string; quick?: boolean } = {},
) {
  if (RM()) return;
  audio.sfx("slash");
  const hold = opts.quick ? 0.45 : 1.1;
  const el = document.createElement("div");
  el.className = "cutin";
  // built with DOM APIs (textContent/style) — no HTML string interpolation
  const speed = document.createElement("div");
  speed.className = "cutin-speed";
  const frame = document.createElement("div");
  frame.className = "cutin-frame";
  const portrait = document.createElement("div");
  portrait.className = "cutin-portrait";
  for (const cls of ["cutin-mask", "cutin-eyes", "cutin-scarf"]) {
    const d = document.createElement("div");
    d.className = cls;
    portrait.appendChild(d);
  }
  if (opts.img) {
    const img = document.createElement("img");
    img.className = "cutin-img";
    img.src = opts.img;
    img.alt = "";
    portrait.appendChild(img);
  }
  frame.appendChild(portrait);
  if (opts.letter) {
    const letter = document.createElement("div");
    letter.className = "cutin-letter";
    if (isHexColor(opts.color)) letter.style.color = opts.color;
    letter.textContent = opts.letter;
    frame.appendChild(letter);
  }
  if (opts.name) {
    const name = document.createElement("div");
    name.className = "cutin-name";
    name.textContent = opts.name;
    frame.appendChild(name);
  }
  el.append(speed, frame);
  const img = el.querySelector<HTMLImageElement>(".cutin-img");
  if (img) {
    img.addEventListener("error", () => img.remove());
  }
  scope.appendChild(el);
  fx.slashes(6);
  fx.flash("#ffffff", 0.7);
  return new Promise<void>((resolve) => {
    const tl = gsap.timeline({ onComplete: () => resolve() });
    tl.set(el, { opacity: 1 })
      .fromTo(el.querySelector(".cutin-frame"), { scale: 3.2, rotate: 8, opacity: 0 }, { scale: 1, rotate: -3, opacity: 1, duration: 0.28, ease: "power3.out" })
      .fromTo(el.querySelector(".cutin-speed"), { opacity: 0 }, { opacity: 1, duration: 0.1 }, 0)
      .to(el.querySelector(".cutin-speed"), { opacity: 0, duration: 0.5 }, 0.3)
      .fromTo(el.querySelector(".cutin-frame"), { x: 0 }, { x: () => (Math.random() - 0.5) * 30, duration: 0.06, repeat: 5, yoyo: true, ease: "none" }, 0.3);
    if (opts.letter) {
      tl.fromTo(el.querySelector(".cutin-letter"), { scale: 2.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, ease: "back.out(2)" }, 0.32);
    }
    if (img) {
      tl.fromTo(img, { scale: 1.35, filter: "brightness(1.6)" }, { scale: 1, filter: "brightness(1)", duration: 0.34, ease: "power2.out" }, 0.3);
    }
    tl.to(el, { opacity: 0, duration: 0.18, delay: hold, onComplete: () => el.remove() });
  });
}

/* ---- portraitPop: small portrait burst at a screen point (correct answers) ---- */
export function portraitPop(scope: HTMLElement, x: number, y: number) {
  if (RM()) return;
  const p = randomPortrait();
  const el = document.createElement("div");
  el.className = "portrait-pop";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const img = document.createElement("img");
  img.src = p.src;
  img.alt = "";
  el.appendChild(img);
  scope.appendChild(el);
  img.addEventListener("error", () => el.remove());
  gsap.fromTo(el, { scale: 0.2, opacity: 0, rotate: -24 }, { scale: 1, opacity: 1, rotate: 10, duration: 0.2, ease: "back.out(2)" });
  gsap.to(el, { scale: 1.5, opacity: 0, rotate: 22, duration: 0.4, delay: 0.32, ease: "power2.in", onComplete: () => el.remove() });
}

/* ---- cardSlam: element slams in with rotation + shadow cut ---- */
export function cardSlam(el: HTMLElement, delay = 0, angle = -14) {
  if (RM()) {
    gsap.set(el, { opacity: 1 });
    return;
  }
  audio.sfx("paper");
  return gsap.fromTo(
    el,
    { x: 80, y: -140, rotate: angle, scale: 1.6, opacity: 0 },
    { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, duration: 0.5, delay, ease: "back.out(1.2)" },
  );
}

/* ---- stampIn: rubber stamp ---- */
export function stampIn(el: HTMLElement, delay = 0) {
  if (RM()) {
    gsap.set(el, { opacity: 1 });
    return;
  }
  audio.sfx("stamp");
  return gsap.fromTo(
    el,
    { scale: 2.6, opacity: 0, rotate: -18 },
    { scale: 1, opacity: 1, rotate: -8, duration: 0.22, delay, ease: "power3.out" },
  );
}

/* ---- floatUp: points text helper (DOM) ---- */
export function floatUp(scope: HTMLElement, text: string, color: string, x: number, y: number) {
  const el = document.createElement("div");
  el.className = "float-up";
  el.textContent = text;
  el.style.color = color;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  scope.appendChild(el);
  gsap.fromTo(el, { y: 0, opacity: 1, scale: 0.6 }, { y: -70, opacity: 0, scale: 1.2, duration: 1, ease: "power2.out", onComplete: () => el.remove() });
}
