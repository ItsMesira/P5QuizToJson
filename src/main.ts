/* ============ P5 QUIZ — BOOT ============ */
/* Font subsets: latin-only for the display/body/mono faces; Kanit keeps its
   full package CSS because fontsource's per-subset files carry no
   unicode-range (which would make the browser download Thai glyphs for English
   text). The combined Kanit CSS has proper unicode-range, so Thai loads only
   when Thai text is actually rendered. */
import "@fontsource/archivo-black/latin.css";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/700.css";
import "@fontsource/barlow-condensed/latin-400.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/p5.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/responsive.css";

import { fx } from "./fx/particles";
import { perf } from "./core/perf";
import { initCursor } from "./fx/cursor";
import { h } from "./ui/dom";
import { go, hashToRoute, applyGlobalSettings, initClassBadge, app } from "./ui/screens";
import { audio } from "./core/audio";
import { validateQuiz } from "./core/validator";
import { saveQuiz } from "./core/store";
import { decodeQuizLink, fetchRemoteQuiz, decodePayload } from "./core/share";
import { toast } from "./ui/dom";
import type { Quiz } from "./core/types";
import { t, detectLocale } from "./core/i18n";
import { isValidTheme } from "./core/theme";

// UI screens are code-split by the router (see ui/screens.ts) — not imported here.

/* ---------- ambient background (P5 Best layers) ---------- */
function buildAmbient() {
  const amb = document.getElementById("ambient")!;
  amb.innerHTML = `
    <div class="bg-layer" id="bg-stripes"></div>
    <svg class="bg-star" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,0 60,35 98,35 68,57 78,94 50,72 22,94 32,57 2,35 40,35"/>
    </svg>
    <svg class="bg-star s2" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,0 60,35 98,35 68,57 78,94 50,72 22,94 32,57 2,35 40,35"/>
    </svg>
    <div class="bg-layer" id="bg-halftone"></div>
    <div class="bg-layer" id="bg-vignette"></div>
    <div id="bg-slash" aria-hidden="true"></div>
  `;
  // parallax (ported from P5 Best view.js) — desktop pointers only; the shared
  // scheduler pauses it when the tab is hidden and it idles once it has settled.
  if (perf.parallax) {
    const stripes = amb.querySelector("#bg-stripes") as HTMLElement;
    const halftone = amb.querySelector("#bg-halftone") as HTMLElement;
    const slash = amb.querySelector("#bg-slash") as HTMLElement;
    const stars = [...amb.querySelectorAll<HTMLElement>(".bg-star")];
    let tx = 0, ty = 0, cx = 0, cy = 0;
    window.addEventListener("mousemove", (e) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    perf.onFrame(() => {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      if (Math.abs(tx - cx) < 0.0008 && Math.abs(ty - cy) < 0.0008) {
        cx = tx;
        cy = ty;
        // already settled — no visual change worth a write this frame
        if (stripes.dataset.settled === "1") return;
        stripes.dataset.settled = "1";
      } else {
        stripes.dataset.settled = "0";
      }
      stripes.style.transform = `translate(${cx * 22}px, ${cy * 14}px)`;
      halftone.style.transform = `translate(${cx * -34}px, ${cy * -22}px)`;
      slash.style.transform = `translate(${cx * 8}px, ${cy * 5}px)`;
      stars.forEach((a) => (a.style.translate = `${cx * 18}px ${cy * 12}px`));
    });
  }
}

/* ---------- veil panels (P5 stripe sweep) ---------- */
function buildVeil() {
  const veil = document.getElementById("veil")!;
  veil.append(
    h("div", { class: "veil-bg" }),
    h("div", { class: "veil-stripe s0" }),
    h("div", { class: "veil-stripe s1" }),
    h("div", { class: "veil-stripe s2" }),
    h("div", { class: "veil-slash" }),
  );
}

/* ---------- boot ---------- */
perf.apply();
buildAmbient();
buildVeil();
fx.init(document.getElementById("fx-canvas") as HTMLCanvasElement);
fx.app = document.getElementById("app");
initCursor();
initClassBadge();
applyGlobalSettings();

/* restore the cloud session (cookie-based) in the background — it must never
   block first paint. Only the account screens (#dashboard/#entry) wait for it;
   the class badge updates itself via the "p5q-session" event. The 2.5s cap is a
   guard for slow/cold APIs so the account screens can't hang forever. */
const sessionReady = Promise.race([
  import("./core/api").then(({ cloudReady }) => cloudReady()),
  new Promise((r) => setTimeout(r, 2500)),
]);

/* first gesture unlocks audio */
const unlockAudio = () => {
  audio.unlock();
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
};
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

/* ---------- URL params: ?q= (share link), ?raw=, ?quiz= (url) ---------- */
async function handleParams() {
  const params = new URLSearchParams(location.search);

  /* ?lang=es / ?theme=vapor — share links can pin language + theme */
  const langP = params.get("lang");
  if (langP) {
    app.settings.lang = detectLocale(langP);
    applyGlobalSettings();
  }
  const themeP = params.get("theme");
  if (themeP && isValidTheme(themeP)) {
    app.settings.theme = themeP;
    applyGlobalSettings();
  }

  let quiz: Quiz | null = null;
  let source = "link";

  if (params.has("q") || params.has("z")) {
    quiz = await decodeQuizLink(params);
    source = "shared link";
  } else if (params.has("quiz")) {
    try {
      quiz = await fetchRemoteQuiz(params.get("quiz")!);
      source = params.get("quiz")!;
    } catch {
      toast(t("Could not fetch ?quiz= URL"), "error");
    }
  } else if (params.has("prompt")) {
    const payload = await decodePayload<{ fields?: Record<string, unknown>; tagline?: string }>(params.get("prompt")!);
    if (payload) {
      const { builderPrefill } = await import("./ui/prompts");
      builderPrefill.fields = payload.fields as never;
      builderPrefill.tagline = payload.tagline;
      await go({ name: "prompts" });
      return;
    }
  }

  if (quiz) {
    const v = validateQuiz(quiz);
    if (v.ok) {
      saveQuiz(v.quiz, source);
      toast(t("“{title}” loaded from link", { title: v.quiz.title }), "info");
      const { app } = await import("./ui/screens");
      app.currentQuiz = { ...v.quiz, source };
      await go({ name: "quiz" });
      return;
    }
    // a link can carry a quiz that needs repair too
    const { repairQuiz } = await import("./core/repair");
    const fixed = repairQuiz(quiz);
    if (fixed.ok) {
      saveQuiz(fixed.quiz, source);
      toast(t("Repaired {n} issue(s) — loaded", { n: fixed.report.length }), "info");
      const { app } = await import("./ui/screens");
      app.currentQuiz = { ...fixed.quiz, source };
      await go({ name: "quiz" });
      return;
    }
    toast(t("Quiz link was invalid JSON"), "error");
  }

  // dedicated admin path (server is the real gate; this just routes the UI)
  if (location.pathname.replace(/\/+$/, "") === "/ijustlovehavingtheadminpanel") {
    await go({ name: "admin" }, { instant: true });
    return;
  }

  const hashRoute = hashToRoute(location.hash);
  if (hashRoute) {
    // account screens need the restored session before they render; everything
    // else paints immediately.
    if (hashRoute.name === "dashboard" || hashRoute.name === "entry") await sessionReady;
    await go(hashRoute, { instant: true });
    return;
  }
  await go({ name: "title" }, { instant: true });
}

void handleParams();
