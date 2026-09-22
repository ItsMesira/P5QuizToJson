/* ============ P5 QUIZ — HEIST LOADER ============
   The signature stripe sweep takes ~600-800ms, and that whole window used to be
   dead air: a dark veil with no indication anything was happening. Users read it
   as a missed tap and clicked again.

   This draws a Persona-5-styled progress card INSIDE the existing veil, so it
   needs no new timing logic — it appears with the wipe and dies with it. It also
   reports what is actually happening (route name), because a specific label
   reads as faster and more trustworthy than a generic spinner. */

const ROUTE_LABEL: Record<string, string> = {
  title: "RETURNING TO THE HIDEOUT",
  load: "OPENING THE BRIEFCASE",
  library: "CHECKING THE ARCHIVE",
  quiz: "INFILTRATING THE PALACE",
  results: "TALLYING THE LOOT",
  settings: "TUNING THE GEAR",
  profiles: "CALLING THE CREW",
  leaderboard: "READING THE CHARTS",
  prompts: "FORGING THE CALLING CARD",
  entry: "CHECKING CREDENTIALS",
  dashboard: "ENTERING THE SAFE ROOM",
  admin: "OPENING THE CONTROL ROOM",
};

const SHOW_DELAY_MS = 140;

let host: HTMLElement | null = null;
let timer: number | null = null;

function build(): HTMLElement | null {
  const veil = document.getElementById("veil");
  if (!veil) return null;
  const el = document.createElement("div");
  el.className = "p5-loader";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");

  const stripes = document.createElement("div");
  stripes.className = "p5-loader-stripes";
  stripes.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.className = "p5-loader-card";

  const kicker = document.createElement("div");
  kicker.className = "p5-loader-kicker";
  kicker.textContent = "TAKING YOUR HEART";

  const title = document.createElement("div");
  title.className = "p5-loader-title";

  const bar = document.createElement("div");
  bar.className = "p5-loader-bar";
  const fill = document.createElement("i");
  bar.appendChild(fill);

  const meta = document.createElement("div");
  meta.className = "p5-loader-meta";
  const pct = document.createElement("span");
  pct.className = "p5-loader-pct";
  const dots = document.createElement("span");
  dots.className = "p5-loader-dots";
  dots.textContent = "◆ ◆ ◆ ◆ ◆";
  meta.append(pct, dots);

  card.append(kicker, title, bar, meta);
  el.append(stripes, card);
  veil.appendChild(el);
  return el;
}

/** Show the loader for a navigation to `route`. Safe to call when a transition
 *  is skipped (reduced motion) — it simply never becomes visible. */
export function showLoader(route: string): void {
  const text = ROUTE_LABEL[route] ?? "WORKING";
  hideLoader();
  timer = window.setTimeout(() => {
    timer = null;
    host = build();
    if (!host) return;
    host.querySelector(".p5-loader-title")!.textContent = text;
    // rAF so the transition runs from the initial state
    requestAnimationFrame(() => host?.classList.add("visible"));
  }, SHOW_DELAY_MS);
}

/** Retire the loader. The wipe lasts ~600ms and the bar fills over ~500ms, so
 *  the card is held briefly to avoid a jarring cut, then fully removed. */
export function hideLoader(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const el = host;
  host = null;
  if (!el) return;
  el.classList.remove("visible");
  window.setTimeout(() => el.remove(), 220);
}

/** Kept for parity with the router's transition watchdog. */
export function loaderActive(): boolean {
  return host !== null;
}
