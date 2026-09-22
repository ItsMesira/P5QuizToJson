/* ============ P5 QUIZ — SCREEN ROUTER ============ */
import type { Quiz, QuizResult } from "../core/types";
import { loadSettings, storeSettings } from "../core/store";
import { validateQuiz } from "../core/validator";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { slashWipe, abortWipe } from "../fx/transitions";
import { showLoader, type Loader } from "../fx/loader";
import { ransomizeAll } from "../fx/ransom";
import { clear, toast } from "./dom";
import { applyTheme } from "../core/theme";
import { routeScope, resetRouteScope, type Scope } from "../core/runtime";
import { t, applyLocale } from "../core/i18n";

export const app = {
  settings: loadSettings(),
  currentQuiz: null as (Quiz & { savedId?: string; source?: string; quizId?: string }) | null,
  lastResult: null as QuizResult | null,
  profile: null as string | null,
};

export function applyGlobalSettings() {
  audio.applySettings(app.settings);
  fx.setCrt(app.settings.crt);
  fx.setParticles(app.settings.particles);
  applyTheme(app.settings);
  applyLocale(app.settings);
  document.body.classList.toggle("music-off", !app.settings.music);
  if (app.settings.fullscreen) {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => undefined);
  }
  storeSettings(app.settings);
}

export type Route =
  | { name: "title" }
  | { name: "load" }
  | { name: "library" }
  | { name: "quiz" }
  | { name: "results" }
  | { name: "settings" }
  | { name: "profiles" }
  | { name: "leaderboard" }
  | { name: "prompts" }
  | { name: "entry" }
  | { name: "dashboard" }
  | { name: "admin" };

/* Mount functions receive a scope describing the screen's lifetime. Cleanup is
   called BEFORE the scope is cancelled, so teardown may still use the DOM; the
   cancel then aborts every in-flight request and owned timer the screen made. */
type MountFn = (root: HTMLElement, scope: Scope) => () => void;

const mounts: Record<Route["name"], MountFn> = {} as Record<Route["name"], MountFn>;

export function registerScreen(name: Route["name"], fn: MountFn) {
  mounts[name] = fn;
}

/* Screens are code-split: each module registers itself on first import, so the
   initial bundle only carries the router + FX. The import overlaps the wipe. */
const loaders: Record<Route["name"], () => Promise<unknown>> = {
  title: () => import("./title"),
  load: () => import("./load"),
  library: () => import("./library"),
  quiz: () => import("./quizscreen"),
  results: () => import("./results"),
  settings: () => import("./settings"),
  profiles: () => import("./profiles"),
  leaderboard: () => import("./leaderboard"),
  prompts: () => import("./prompts"),
  entry: () => import("./entry"),
  dashboard: () => import("./dashboard"),
  admin: () => import("./admin"),
};

/* A route chunk can 404 when a tab outlives a deploy: its hashed filename is
   gone from the new deployment, so the dynamic import fails and the screen
   would be left blank (a black page with just the class badge). Recover by
   pulling the current build once; guard against a reload loop. */
const RELOAD_FLAG = "p5q.build-reload";
let reloadPending = false;

function recoverFromStaleBuild(err: unknown) {
  console.error("[p5q] screen chunk failed to load:", err);
  if (reloadPending) return;
  reloadPending = true;
  try {
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      location.reload();
      return;
    }
  } catch {
    /* storage unavailable — fall through to the toast */
  }
  toast(t("This page is out of date — reload to continue"), "error");
}

// Vite fires this on window when a preloaded chunk (JS or CSS) fails
window.addEventListener("vite:preloadError", (e) => recoverFromStaleBuild(e));

async function ensureScreen(name: Route["name"]) {
  if (mounts[name]) return;
  const load = loaders[name];
  if (!load) return;
  try {
    await load();
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* ignore */
    }
  } catch (err) {
    recoverFromStaleBuild(err);
  }
}

let cleanup: (() => void) | null = null;
let current: Route = { name: "title" };
const stage = document.getElementById("app")!;
const veil = document.getElementById("veil")!;

/* ---------- navigation model ----------
   Every "start" action (PLAY, LOAD, sample, class quiz) funnels through go().
   A transition takes ~600-800ms, so two clicks used to run the whole handler
   twice: two dynamic imports, two mounts, two wipes fighting over the same
   veil, and two writers racing on the single `cleanup` slot.

   Exactly one navigation is in flight, held in `active`. A new navigation
   aborts the old one synchronously, before its first await, so the loser
   returns at its next checkpoint having touched no shared state. The previous
   booleans could only absorb a repeat tap on the SAME route, which is why the
   browser Back button (a different route) corrupted the screen: it released the
   newer navigation's lock and retired its loader. */
interface Nav {
  gen: number;
  route: Route;
  instant: boolean;
  loader: Loader | null;
  aborted: boolean;
}

let navGen = 0;
let active: Nav | null = null;
let navWatchdog: number | null = null;

const isCurrent = (n: Nav) => active === n && !n.aborted;

function clearWatchdog() {
  if (navWatchdog !== null) {
    window.clearTimeout(navWatchdog);
    navWatchdog = null;
  }
}

/** Cancel a navigation. It will not commit, and it tears down only its OWN
 *  loader and its own in-flight wipe — never those of whatever superseded it. */
function abortNav(n: Nav) {
  if (n.aborted) return;
  n.aborted = true;
  n.loader?.abort();
  n.loader = null;
  abortWipe();
  if (active === n) active = null;
}

/* Navigation must never lock the app out: if a mount hangs in a way the
   checkpoints do not cover, the watchdog genuinely cancels it. It must ABORT
   rather than merely clear flags — a stalled navigation that kept running used
   to clobber whatever came after it. */
const NAV_LOCK_MAX_MS = 4000;

function armNavWatchdog(nav: Nav) {
  clearWatchdog();
  navWatchdog = window.setTimeout(() => {
    navWatchdog = null;
    if (!isCurrent(nav)) return;
    console.warn("[p5q] navigation timed out — aborting");
    abortNav(nav);
  }, NAV_LOCK_MAX_MS);
}

/** True while a navigation is in flight. */
export function isNavigating(): boolean {
  return active !== null;
}

/* ---------- tap acknowledgement ----------
   The control under the finger is marked the moment it is pressed, so the tap
   is visibly acknowledged in the same frame instead of ~600ms later when the
   new screen arrives. This is the whole cure for "I thought I missed it".

   pointerdown (not click) because it fires BEFORE activation, so marking the
   control cannot suppress the action the user is performing. The mark is
   deliberately inert: no `disabled`, which would swallow the in-flight click.

   The mark's lifetime is the PRESS, not the navigation. Removing it on
   navigation (which is what this used to do) meant every control that does not
   navigate — quiz answers, settings toggles, modal buttons, toast dismiss —
   stayed dimmed and skewed for the rest of the screen's life. */
const CONTROL_SELECTOR = "button, .sticker-btn, .lib-btn, .entry-row";
/* long enough that a 60ms tap is still seen, short enough never to stick */
const PRESS_HOLD_MS = 200;

let pressed: HTMLElement | null = null;
let pressedAt = 0;
let releaseTimer: number | null = null;
let lastPointerTarget: Element | null = null;

function controlFor(target: EventTarget | null): HTMLElement | null {
  const c = (target as Element | null)?.closest?.(CONTROL_SELECTOR) as HTMLElement | null;
  return c && !c.classList.contains("hidden") ? c : null;
}

function press(c: HTMLElement) {
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  pressed?.classList.remove("is-busy");
  pressed = c;
  pressedAt = performance.now();
  c.classList.add("is-busy"); // same frame — the original cure, untouched
}

function endPress() {
  if (!pressed) return;
  const el = pressed;
  pressed = null;
  const wait = Math.max(0, PRESS_HOLD_MS - (performance.now() - pressedAt));
  if (wait === 0) {
    el.classList.remove("is-busy");
    return;
  }
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null;
    el.classList.remove("is-busy");
  }, wait);
}

document.addEventListener(
  "pointerdown",
  (e) => {
    lastPointerTarget = e.target as Element | null;
    const c = controlFor(e.target);
    if (c) press(c);
  },
  { capture: true, passive: true },
);
/* A key press means the interaction in flight is no longer the pointer one, so
   the recorded pointer target must stop counting as "what the user just
   pressed". This is what makes the choice in acknowledgeClick() deterministic
   instead of a guess. */
document.addEventListener("keydown", () => {
  lastPointerTarget = null;
}, { capture: true, passive: true });
window.addEventListener("pointerup", endPress, { capture: true, passive: true });
window.addEventListener("pointercancel", endPress, { capture: true, passive: true });

/** A tap the router absorbed still has to look like it landed.
 *
 *  The pointer target comes FIRST, and that ordering is the whole point. What
 *  the user pressed is the thing that should light up, and `lastPointerTarget`
 *  is exactly that — recorded by the pointerdown that caused this navigation.
 *  Consulting `document.activeElement` first is wrong, not merely redundant:
 *  Safari does not focus a button on click, so activeElement is either <body>
 *  (which never falls through, being truthy — the original bug) or, worse, a
 *  control the user focused earlier and did not press. Chrome focuses on
 *  mousedown, so it cannot reproduce that, which is why this needs fixing by
 *  construction rather than by testing on a real device.
 *
 *  The keydown listener above is what keeps the keyboard path working: with a
 *  null pointer target there is no recent press, so the focused control is
 *  correctly used instead. */
function acknowledgeClick() {
  const c = controlFor(lastPointerTarget) ?? controlFor(document.activeElement);
  if (!c) return;
  press(c);
  endPress(); // press + immediate release: floors at PRESS_HOLD_MS
}

/** Drop any in-flight navigation bookkeeping. Boot calls this so the first
 *  route is never refused; nothing is mounted yet, so there is nothing to tear
 *  down. The watchdog aborts its own navigation first, so this only clears. */
export function resetNavigationLock() {
  clearWatchdog();
  active = null;
}

/** The ONLY writer of shared screen state — `current`, `dataset.screen`, the
 *  stage's children, `cleanup`, and the route scope. It is reachable only
 *  through isCurrent(), so a superseded navigation can never run it. */
async function commit(nav: Nav): Promise<void> {
  try {
    cleanup?.();
  } catch (err) {
    console.error("[p5q] screen cleanup failed:", err);
  }
  cleanup = null;
  clear(stage);
  /* Everything the previous screen started (fetches, timers, listeners, rAF
     loops) is cancelled here. Without this, a late continuation wrote into a
     detached tree and failed silently. */
  resetRouteScope();
  let cancelled = false;
  routeScope().onCancel(() => {
    cancelled = true;
  });
  const scope: Scope = {
    get signal() {
      return routeScope().signal;
    },
    alive: () => !cancelled && routeScope().alive(),
    onCancel: (fn) => routeScope().onCancel(fn),
  };

  /* The mounted truth. go() writes the hash eagerly (Back must work during a
     transition), so this follows the commit instead — which is what guarantees
     that at rest, with nothing in flight, URL and screen always agree. */
  current = nav.route;

  try {
    const mount = mounts[nav.route.name];
    if (mount) cleanup = mount(stage, scope);
    ransomizeAll([".screen-title"]);
  } catch (err) {
    console.error(`[p5q] screen "${nav.route.name}" failed to mount:`, err);
    toast(t("Something broke on that screen — back to the menu"), "error");
    if (nav.route.name === "title") return;
    /* Fall back directly rather than by calling go(): a recursive go() would
       abort `nav` mid-flight. Re-point nav at the title route first, so the
       hashchange this fires is recognised as our own write, not a new trip. */
    try {
      clear(stage);
      nav.route = { name: "title" };
      current = nav.route;
      document.body.dataset.screen = "home";
      location.hash = "title";
      await ensureScreen("title");
      if (mounts.title) cleanup = mounts.title(stage, scope);
      ransomizeAll([".screen-title"]);
    } catch (err2) {
      console.error("[p5q] title fallback failed:", err2);
    }
  }
}

export async function go(route: Route, opts: { instant?: boolean } = {}) {
  /* Repeat tap on the control the user already hit: acknowledge it so the click
     is never silently dropped, and ignore the duplicate. This sits BEFORE the
     abort below, so spam stays absorbed instead of restarting the transition. */
  if (active && !opts.instant && active.route.name === route.name) {
    acknowledgeClick();
    return;
  }

  /* Newest wins, synchronously, before any await. The previous navigation is
     dead from this line on: it can neither commit nor retire OUR loader. */
  if (active) abortNav(active);

  const nav: Nav = { gen: ++navGen, route, instant: !!opts.instant, loader: null, aborted: false };
  active = nav;
  armNavWatchdog(nav);

  /* The URL is the navigation's public record and the Back button must keep
     working during a transition, so it is written eagerly. Nothing else is —
     except `data-screen`, which only CSS reads (the ambient slash retracting on
     sub-screens). That is a transition-INTENT signal, so it must fire when the
     navigation starts, not when it finishes: committing it with the mount made
     every data-screen-keyed animation begin ~800ms late, after the transition
     it was supposed to accompany. The newest navigation writes it last and the
     newest commits, so at rest it still names the mounted route. */
  if (location.hash.slice(1) !== route.name) location.hash = route.name;
  document.body.dataset.screen = route.name === "title" ? "home" : route.name;

  /* The loader fills the wipe window (~600-800ms) with a named progress card
     instead of dead air. A skipped transition (reduced motion / instant) never
     shows it, and the 140ms delay means fast routes stay flicker-free.

     Each setLoaderPhase below marks a milestone this function GENUINELY reaches,
     in order — the deck advances on real progress, never on a timer. Routes with
     no phase table ignore all of this (the handle clamps to a single card). */
  if (!opts.instant) nav.loader = showLoader(route.name);
  nav.loader?.setPhase(0);

  await ensureScreen(route.name);
  if (!isCurrent(nav)) return; // superseded during the chunk import
  nav.loader?.setPhase(1); // the screen's chunk is in memory

  if (!opts.instant) await slashWipe(veil, "in");
  if (!isCurrent(nav)) return; // superseded during the wipe
  nav.loader?.setPhase(2); // the transition itself is done

  try {
    await commit(nav);
    if (!isCurrent(nav)) return;
    nav.loader?.setPhase(3); // the screen is mounted
    /* The loader rides the veil's own fade, so retiring it here cannot leave a
       dead tail after the new screen is already up. */
    if (!opts.instant) {
      await slashWipe(veil, "out", { fadeOut: nav.loader?.el ? [nav.loader.el] : [] });
    }
  } finally {
    /* Only the owner releases: a stale navigation must never retire the loader
       or clear the slot belonging to the one that superseded it. */
    const loader = nav.loader;
    nav.loader = null;
    if (active === nav) {
      active = null;
      clearWatchdog();
    }
    loader?.retire();
  }
}

/* failsafe: if the black veil is still up seconds after the tab wakes up,
   force it away so a stalled transition can never strand a black screen */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  window.setTimeout(() => {
    if (Number(getComputedStyle(veil).opacity) > 0.98) {
      console.warn("[p5q] veil stuck after tab return — force clearing");
      veil.style.opacity = "0";
    }
  }, 2500);
});

/* ---------- class badge (persistent classroom indicator) ---------- */
import { cloud } from "../core/api";

export function updateClassBadge() {
  const badge = document.getElementById("class-badge");
  if (!badge) return;
  const cls = cloud.session?.cls;
  if (cls) {
    badge.classList.remove("hidden");
    badge.querySelector<HTMLElement>(".cb-name")!.textContent = cls.name;
    badge.querySelector<HTMLElement>(".cb-code")!.textContent = cls.code;
    badge.querySelector<HTMLElement>(".cb-role")!.textContent = cls.role === "teacher" ? "★" : "🎓";
  } else {
    badge.classList.add("hidden");
  }
}

export function initClassBadge() {
  const badge = document.getElementById("class-badge");
  if (!badge || badge.getAttribute("data-wired")) return;
  badge.setAttribute("data-wired", "1");
  badge.setAttribute("aria-label", t("Open classroom"));
  badge.addEventListener("click", () => {
    void go(cloud.session ? { name: "dashboard" } : { name: "entry" });
  });
  window.addEventListener("p5q-session", () => updateClassBadge());
  updateClassBadge();
}

export async function startQuiz(quiz: Quiz & { savedId?: string; source?: string; quizId?: string }) {
  // ALWAYS normalize through the validator — raw JSON (samples, old saves,
  // resume) lacks derived fields like correctText that the engine needs.
  const v = validateQuiz(quiz);
  if (v.ok) {
    app.currentQuiz = { ...v.quiz, savedId: quiz.savedId, source: quiz.source, quizId: quiz.quizId };
  } else {
    toast(t("Quiz has problems — reload the JSON"), "error");
    app.currentQuiz = quiz;
  }
  await go({ name: "quiz" });
}

export function hashToRoute(h: string): Route | null {
  const map: Record<string, Route> = {
    title: { name: "title" },
    load: { name: "load" },
    library: { name: "library" },
    quiz: { name: "quiz" },
    results: { name: "results" },
    settings: { name: "settings" },
    profiles: { name: "profiles" },
    leaderboard: { name: "leaderboard" },
    prompts: { name: "prompts" },
    entry: { name: "entry" },
    dashboard: { name: "dashboard" },
    admin: { name: "admin" },
  };
  const key = h.replace(/^#\/?/, "") as keyof typeof map;
  return map[key] ?? null;
}

window.addEventListener("hashchange", () => {
  const r = hashToRoute(location.hash);
  if (!r) return;
  /* Compare against the newest REQUESTED route, not the mounted one. The hash is
     written eagerly but `current` only follows the commit, so mid-transition the
     two legitimately disagree — comparing against `current` would swallow a Back
     press made during a transition, and the pending navigation would then
     re-write the hash and win. */
  if (r.name === (active?.route.name ?? current.name)) return;
  void go(r);
});
