/* ============ P5 QUIZ — BOOT ============ */
import "@fontsource/archivo-black";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "katex/dist/katex.min.css";
import "./styles/tokens.css";
import "./styles/p5.css";
import "./styles/components.css";
import "./styles/screens.css";

import { fx } from "./fx/particles";
import { initCursor } from "./fx/cursor";
import { h } from "./ui/dom";
import { go, hashToRoute, applyGlobalSettings, initClassBadge } from "./ui/screens";
import { audio } from "./core/audio";
import { validateQuiz } from "./core/validator";
import { saveQuiz } from "./core/store";
import { decodeQuizLink, fetchRemoteQuiz, decodePayload } from "./core/share";
import { toast } from "./ui/dom";
import type { Quiz } from "./core/types";

import "./ui/title";
import "./ui/load";
import "./ui/library";
import "./ui/quizscreen";
import "./ui/results";
import "./ui/settings";
import "./ui/profiles";
import "./ui/leaderboard";
import "./ui/prompts";
import "./ui/entry";
import "./ui/dashboard";

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
    <img class="menu-art" id="art-home" src="./art/menu-home.jpg" alt="" onerror="this.remove()" />
    <div class="bg-layer" id="bg-halftone"></div>
    <div class="bg-layer" id="bg-vignette"></div>
    <div id="bg-slash" aria-hidden="true"></div>
  `;
  // parallax (ported from P5 Best view.js)
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const stripes = amb.querySelector("#bg-stripes") as HTMLElement;
    const halftone = amb.querySelector("#bg-halftone") as HTMLElement;
    const arts = [...amb.querySelectorAll<HTMLElement>(".menu-art")];
    const slash = amb.querySelector("#bg-slash") as HTMLElement;
    const stars = [...amb.querySelectorAll<HTMLElement>(".bg-star")];
    let tx = 0, ty = 0, cx = 0, cy = 0;
    window.addEventListener("mousemove", (e) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    const loop = () => {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      stripes.style.transform = `translate(${cx * 22}px, ${cy * 14}px)`;
      halftone.style.transform = `translate(${cx * -34}px, ${cy * -22}px)`;
      slash.style.transform = `translate(${cx * 8}px, ${cy * 5}px)`;
      stars.forEach((a) => (a.style.translate = `${cx * 18}px ${cy * 12}px`));
      arts.forEach((a) => {
        if (a.isConnected) a.style.transform = `translate(${cx * 14}px, ${cy * 9}px) scale(1.04)`;
      });
      requestAnimationFrame(loop);
    };
    loop();
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
buildAmbient();
buildVeil();
fx.init(document.getElementById("fx-canvas") as HTMLCanvasElement);
fx.app = document.getElementById("app");
initCursor();
initClassBadge();
applyGlobalSettings();

/* refresh the cloud session in the background (cookie-based, non-blocking) */
void import("./core/api").then(({ cloud }) => cloud.me().catch(() => undefined));

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
      toast("Could not fetch ?quiz= URL", "error");
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
      toast(`“${v.quiz.title}” loaded from link`, "info");
      const { app } = await import("./ui/screens");
      app.currentQuiz = { ...v.quiz, source };
      await go({ name: "quiz" });
      return;
    }
    toast("Quiz link was invalid JSON", "error");
  }

  const hashRoute = hashToRoute(location.hash);
  if (hashRoute) {
    await go(hashRoute, { instant: true });
    return;
  }
  await go({ name: "title" }, { instant: true });
}

void handleParams();
