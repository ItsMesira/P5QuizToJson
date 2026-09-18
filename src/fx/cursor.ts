/* ============ P5 QUIZ — 30-FRAME SPRITE CURSOR (P5 Best port) ============ */
import { RM } from "./transitions";

let started = false;

/* interactive targets that switch the cursor to its "link" sprite */
const LINK_SELECTOR =
  "a,button,.card,.menu-item,.back-hint,.contact-chip,.p5-item,.choice-btn,.multi-row,.order-chip,.match-btn,.sample-card,.lib-card,.prompt-card,.toggle-row,.seg-btn,.type-chip,.mini-toggle,.lifeline,.sticker-btn,.resume-banner,.resume-chip,[role='button'],input,select,textarea,label";

export function initCursor() {
  if (started) return;
  started = true;
  if (!matchMedia("(pointer:fine)").matches || RM()) return;

  const cur = document.createElement("div");
  cur.id = "cursor";
  cur.setAttribute("aria-hidden", "true");
  document.body.appendChild(cur);
  document.body.classList.add("cursor-on");

  let x = -100;
  let y = -100;
  let visible = false;
  const born = performance.now();

  // position is written on input; the sprite frame advances on a cheap 20fps
  // timer (no permanent 60fps rAF loop, and it stops while the tab is hidden).
  const advance = () => {
    if (!visible || document.visibilityState !== "visible") return;
    const frame = Math.floor((performance.now() - born) / 55) % 30;
    cur.style.backgroundPosition = `${-frame * 48}px 0`;
  };
  const frameTimer = window.setInterval(advance, 55);
  window.addEventListener("pagehide", () => window.clearInterval(frameTimer));

  window.addEventListener(
    "mousemove",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        cur.style.display = "block";
        visible = true;
      }
      cur.style.transform = `translate(${x}px, ${y}px)`;
    },
    { passive: true },
  );

  // hover state is read on element boundaries, not on every pixel of movement
  const overLink = (e: Event) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(LINK_SELECTOR)) cur.classList.add("link");
  };
  const outLink = (e: MouseEvent) => {
    // stay in "link" while the pointer moves between descendants of the same target
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.closest?.(LINK_SELECTOR)) return;
    cur.classList.remove("link");
  };
  document.addEventListener("mouseover", overLink, { passive: true });
  document.addEventListener("mouseout", outLink, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => {
    cur.style.display = "none";
    visible = false;
  });
}