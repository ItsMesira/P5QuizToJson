/* ============ P5 QUIZ — HEIST LOADER ============
   The signature stripe sweep takes ~600-800ms, and that whole window used to be
   dead air: a dark veil with no indication anything was happening. Users read it
   as a missed tap and clicked again.

   OWNERSHIP: every call to showLoader() returns a handle, and the caller — the
   navigation that asked for it — owns that handle. There is deliberately no
   module-level "current loader": with shared state, a superseded navigation's
   teardown used to retire the *newer* navigation's card. The exit fade is not a
   timer here at all; the router hands `el` to slashWipe()'s fadeOut list so the
   card leaves with the veil it belongs to.

   TWO RENDERERS, ONE CONTRACT:

   - The hand-built card below is the DEFAULT and the immediate one. It is
     synchronous, dependency-free and always available, so nothing about the
     existing behaviour or timing changes.

   - The React "calling card" deck (src/fx/loader-island.tsx) renders the routes
     that have a real multi-step progression, and only once its chunk is warm.
     It is never awaited: if it is not already loaded, this navigation keeps the
     hand card rather than delaying the thing the loader exists to cover. main.ts
     warms it on idle after first paint, so in practice it is ready by the first
     quiz start. React, framer-motion and Tailwind's CSS stay out of the eager
     bundle because the only path to them is that dynamic import.

   Phases are reported by the router from the awaits it genuinely performs — see
   setLoaderPhase in ui/screens.ts. Nothing here advances on a timer. */

export interface DeckPhase {
  /** Stable key — drives the deck's transition identity. */
  id: string;
  tag: string;
  title: string;
}

export interface DeckState {
  phases: DeckPhase[];
  activeIndex: number;
  progress: number | null;
  status: string;
}

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

const STATUS_TEXT = "PROCESSING ASSETS…";

/* Phase progressions for routes that genuinely have multiple awaited steps.
   Each card is a milestone the router actually reaches, in order:

     0  the quiz is validated and handed over
     1  ensureScreen() — the quiz screen chunk is downloading
     2  slashWipe("in") — the transition itself
     3  commit() — the screen is mounting

   A route with no entry here keeps the single hand-built card: inventing extra
   steps for a screen that loads in one hop would be the loader lying about what
   it is doing. */
const PHASES: Record<string, DeckPhase[]> = {
  quiz: [
    { id: "briefcase", tag: "PHASE 01", title: "Opening the Briefcase" },
    { id: "card", tag: "PHASE 02", title: "Forging the Calling Card" },
    { id: "palace", tag: "PHASE 03", title: "Infiltrating the Palace" },
    { id: "heart", tag: "PHASE 04", title: "Taking Your Heart" },
  ],
};

const SHOW_DELAY_MS = 140;

/* ---- the React island, loaded at most once ------------------------------ */

type IslandModule = typeof import("./loader-island");

let island: IslandModule | null = null;
let islandLoad: Promise<void> | null = null;
let islandFailed = false;

/** Fetch the deck island ahead of time. Safe to call repeatedly. */
export function warmLoader(): Promise<void> {
  if (!islandLoad && !islandFailed) {
    islandLoad = import("./loader-island")
      .then((m) => {
        island = m;
      })
      .catch(() => {
        /* The hand card is a complete loader on its own — a missing island is a
           downgrade, never a failure the user should see. */
        islandFailed = true;
      });
  }
  return islandLoad ?? Promise.resolve();
}

/* ---- the hand-built card (default renderer) ----------------------------- */

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
  /** Report real progress through this screen's phases. Ignored once retired. */
  setPhase(index: number, progress?: number | null): void;
  /** Remove the card once its fade has been handled by the wipe timeline. */
  retire(): void;
  /** This navigation was superseded — cancel the build and drop the card now. */
  abort(): void;
}

/** Build a loader for a navigation to `route` and hand the caller its handle.
 *  Nothing appears for SHOW_DELAY_MS, so a fast route stays flicker-free. */
export function showLoader(route: string): Loader {
  const label = ROUTE_LABEL[route] ?? "WORKING";
  const phases = PHASES[route] ?? null;
  const deck = phases && island ? island : null;
  const total = phases?.length ?? 1;

  let node: HTMLElement | null = null;
  let buildTimer: number | null = null;
  let dead = false;
  let index = 0;
  let progress: number | null = phases ? null : null;

  const renderDeck = () => {
    if (!deck || !node || !phases) return;
    const state: DeckState = { phases, activeIndex: index, progress, status: STATUS_TEXT };
    deck.renderDeck(node, state);
  };

  buildTimer = window.setTimeout(() => {
    buildTimer = null;
    if (dead) return;

    if (deck && phases) {
      /* The island takes over the same wrapper class the hand card uses, so the
         veil's reveal transition, the tests' selectors and the router's fadeOut
         all keep working unchanged. */
      const veil = document.getElementById("veil");
      if (!veil) return;
      const host = document.createElement("div");
      host.className = "p5-loader";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      veil.appendChild(host);
      node = host;
      renderDeck();
      requestAnimationFrame(() => host.classList.add("visible"));
      return;
    }

    node = build();
    if (!node) return;
    node.querySelector(".p5-loader-title")!.textContent = label;
    // rAF so the reveal transition runs from the initial state. It closes over
    // `node`, so a stale frame can never mark a *newer* card visible.
    requestAnimationFrame(() => node?.classList.add("visible"));
  }, SHOW_DELAY_MS);

  const retire = () => {
    dead = true;
    const n = node;
    node = null;
    if (deck && n) deck.disposeDeck(); // before detaching, so React unmounts cleanly
    n?.remove();
  };

  return {
    get el() {
      return node;
    },
    setPhase(i: number, p?: number | null) {
      if (dead) return;
      index = Math.max(0, Math.min(i, total - 1));
      /* No explicit progress means derive it from milestones actually reached,
         never from elapsed time: 2 of 4 real steps done reads 50%. */
      progress = p !== undefined ? p : total > 1 ? (index / (total - 1)) * 100 : null;
      if (deck && node) {
        renderDeck();
      } else if (node && phases) {
        /* Hand-card fallback still reports the true phase, so the label never
           contradicts what the app is doing. */
        const t = node.querySelector(".p5-loader-title");
        if (t) t.textContent = phases[index]?.title.toUpperCase() ?? label;
      }
    },
    retire,
    abort() {
      if (buildTimer !== null) {
        window.clearTimeout(buildTimer);
        buildTimer = null;
      }
      retire();
    },
  };
}
