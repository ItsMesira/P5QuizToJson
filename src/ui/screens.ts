/* ============ P5 QUIZ — SCREEN ROUTER ============ */
import type { Quiz, QuizResult } from "../core/types";
import { loadSettings, storeSettings } from "../core/store";
import { validateQuiz } from "../core/validator";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { slashWipe } from "../fx/transitions";
import { ransomizeAll } from "../fx/ransom";
import { clear, toast } from "./dom";
import { applyTheme } from "../core/theme";
import { t, applyLocale } from "../core/i18n";

export const app = {
  settings: loadSettings(),
  currentQuiz: null as (Quiz & { savedId?: string; source?: string }) | null,
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
  | { name: "dashboard" };

type MountFn = (root: HTMLElement) => () => void;

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

export async function go(route: Route, opts: { instant?: boolean } = {}) {
  current = route;
  location.hash = route.name;
  document.body.dataset.screen = route.name === "title" ? "home" : route.name;
  await ensureScreen(route.name);
  if (!opts.instant) await slashWipe(veil, "in");
  try {
    cleanup?.();
  } catch (err) {
    console.error("[p5q] screen cleanup failed:", err);
  }
  cleanup = null;
  clear(stage);
  try {
    const mount = mounts[route.name];
    if (mount) {
      cleanup = mount(stage);
    }
    ransomizeAll([".screen-title"]);
  } catch (err) {
    console.error(`[p5q] screen "${route.name}" failed to mount:`, err);
    toast(t("Something broke on that screen — back to the menu"), "error");
    if (route.name !== "title") {
      try {
        clear(stage);
        current = { name: "title" };
        location.hash = "title";
        document.body.dataset.screen = "home";
        await ensureScreen("title");
        cleanup = mounts.title(stage);
        ransomizeAll([".screen-title"]);
      } catch (err2) {
        console.error("[p5q] title fallback failed:", err2);
      }
    }
  } finally {
    if (!opts.instant) await slashWipe(veil, "out");
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

export function currentRoute(): Route {
  return current;
}

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

export async function startQuiz(quiz: Quiz & { savedId?: string; source?: string }) {
  // ALWAYS normalize through the validator — raw JSON (samples, old saves,
  // resume) lacks derived fields like correctText that the engine needs.
  const v = validateQuiz(quiz);
  if (v.ok) {
    app.currentQuiz = { ...v.quiz, savedId: quiz.savedId, source: quiz.source };
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
  };
  const key = h.replace(/^#\/?/, "") as keyof typeof map;
  return map[key] ?? null;
}

window.addEventListener("hashchange", () => {
  const r = hashToRoute(location.hash);
  if (r && r.name !== current.name) void go(r);
});
