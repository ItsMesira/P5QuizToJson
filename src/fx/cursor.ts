/* ============ P5 QUIZ — 30-FRAME SPRITE CURSOR (P5 Best port) ============ */
import { RM } from "./transitions";

let started = false;

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
  let frame = 0;
  let last = 0;
  let visible = false;

  window.addEventListener(
    "mousemove",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        cur.style.display = "block";
        visible = true;
      }
      const t = e.target as HTMLElement | null;
      const overLink = !!t?.closest?.(
        "a,button,.card,.menu-item,.back-hint,.contact-chip,.p5-item,.choice-btn,.multi-row,.order-chip,.match-btn,.sample-card,.lib-card,.prompt-card,.toggle-row,.seg-btn,.type-chip,.mini-toggle,.lifeline,.sticker-btn,.resume-banner,.resume-chip",
      );
      cur.classList.toggle("link", overLink);
    },
    { passive: true },
  );

  document.documentElement.addEventListener("mouseleave", () => {
    cur.style.display = "none";
    visible = false;
  });

  const tick = (ts: number) => {
    if (ts - last >= 50) {
      frame = (frame + 1) % 30;
      last = ts;
      cur.style.backgroundPosition = `${-frame * 48}px 0`;
    }
    cur.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
