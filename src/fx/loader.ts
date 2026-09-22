/* ============ P5 QUIZ — HEIST LOADER ============
   The signature stripe sweep takes ~600-800ms, and that whole window used to be
   dead air: a dark veil with no indication anything was happening. Users read it
   as a missed tap and clicked again.

   This draws a Persona-5-styled progress card INSIDE the existing veil, so it
   needs no new timing logic — it appears with the wipe and dies with it. It also
   reports what is actually happening (route name), because a specific label
   reads as faster and more trustworthy than a generic spinner.

   OWNERSHIP: every call to showLoader() returns a handle, and the caller — the
   navigation that asked for it — owns that handle. There is deliberately no
   module-level "current loader": with shared state, a superseded navigation's
   teardown used to retire the *newer* navigation's card. The exit fade is not a
   timer here at all; the router hands `el` to slashWipe()'s fadeOut list so the
   card leaves with the veil it belongs to. */

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

export interface Loader {
  /** The card node, or null while the 140ms build delay is still pending. */
  readonly el: HTMLElement | null;
  /** Remove the card once its fade has been handled by the wipe timeline. */
  retire(): void;
  /** This navigation was superseded — cancel the build and drop the card now. */
  abort(): void;
}

/** Build a loader for a navigation to `route` and hand the caller its handle.
 *  Nothing appears for SHOW_DELAY_MS, so a fast route stays flicker-free. */
export function showLoader(route: string): Loader {
  const text = ROUTE_LABEL[route] ?? "WORKING";
  let node: HTMLElement | null = null;
  let buildTimer: number | null = null;

  buildTimer = window.setTimeout(() => {
    buildTimer = null;
    node = build();
    if (!node) return;
    node.querySelector(".p5-loader-title")!.textContent = text;
    // rAF so the reveal transition runs from the initial state. It closes over
    // `node`, so a stale frame can never mark a *newer* card visible.
    requestAnimationFrame(() => node?.classList.add("visible"));
  }, SHOW_DELAY_MS);

  return {
    get el() {
      return node;
    },
    retire() {
      node?.remove();
      node = null;
    },
    abort() {
      if (buildTimer !== null) {
        window.clearTimeout(buildTimer);
        buildTimer = null;
      }
      node?.remove();
      node = null;
    },
  };
}
