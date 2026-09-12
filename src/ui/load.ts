/* ============ P5 QUIZ — LOAD SCREEN (drag / file / paste / url / samples) ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast, clear } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { cardSlam, RM } from "../fx/transitions";
import { validateQuiz } from "../core/validator";
import { saveQuiz, loadProgress, savedQuizzes } from "../core/store";
import { fetchRemoteQuiz } from "../core/share";
import type { Quiz } from "../core/types";

registerScreen("load", (root) => {
  let progress: ReturnType<typeof loadProgress> = null;

  const attempt = async (raw: unknown, source: string): Promise<Quiz | null> => {
    const v = validateQuiz(raw);
    if (!v.ok) {
      audio.sfx("wrong");
      fx.shake(16);
      fx.flash("#e60012", 0.25);
      showErrors(v.errors.map((e) => `${e.path} — ${e.message}`));
      return null;
    }
    saveQuiz(v.quiz, source);
    audio.sfx("paper");
    toast(`“${v.quiz.title}” loaded`, "info");
    return v.quiz;
  };

  const showErrors = (errors: string[]) => {
    const panel = el.querySelector<HTMLElement>(".load-errors")!;
    clear(panel);
    panel.classList.add("open");
    errors.slice(0, 6).forEach((err, i) => {
      const row = h("div", { class: "load-error-row" }, [
        h("span", { class: "load-error-x" }, ["✕"]),
        h("span", {}, [err]),
      ]);
      panel.appendChild(row);
      gsap.fromTo(row, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, delay: i * 0.06, ease: "back.out(1.6)" });
    });
    if (errors.length > 6) {
      panel.appendChild(h("div", { class: "load-error-more" }, [`…and ${errors.length - 6} more`]));
    }
  };

  const loadFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const quiz = await attempt(JSON.parse(text), file.name);
      if (quiz) void startQuiz({ ...quiz, source: file.name });
    } catch (e) {
      audio.sfx("wrong");
      fx.shake(14);
      showErrors([e instanceof SyntaxError ? "Not valid JSON — check commas and quotes." : String(e)]);
    }
  };

  const el = h("div", { class: "screen load-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": "Back" }, ["◀"]),
      h("h2", { class: "screen-title" }, ["LOAD A QUIZ"]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "load-body" }, [
      h("div", { class: "drop-zone", tabindex: "0", role: "button", "aria-label": "Drop quiz JSON or click to browse" }, [
        h("div", { class: "drop-inner" }, [
          h("div", { class: "drop-star" }, ["★"]),
          h("p", { class: "drop-title" }, ["DROP YOUR QUIZ.JSON"]),
          h("p", { class: "drop-sub" }, ["or click to browse · or press ⌘V to paste"]),
        ]),
      ]),
      h("div", { class: "load-errors" }, []),
      h("div", { class: "load-actions" }, [
        h("button", { class: "sticker-btn" }, ["📂 BROWSE"]),
        h("button", { class: "sticker-btn" }, ["📋 PASTE JSON"]),
        h("button", { class: "sticker-btn" }, ["🔗 FROM URL"]),
      ]),
      h("div", { class: "load-samples" }, [
        h("h3", { class: "samples-title" }, [
          h("span", {}, ["— SAMPLES —"]),
        ]),
        h("div", { class: "samples-grid" }, []),
      ]),
    ]),
    // paste / url are FIXED overlays so they can never fall off-screen
    h("div", { class: "load-paste hidden" }, [
      h("div", { class: "load-paste-card" }, [
        h("div", { class: "load-paste-head" }, [
          h("h3", {}, ["PASTE JSON"]),
          h("button", { class: "pm-close paste-cancel", "aria-label": "Close" }, ["✕"]),
        ]),
        h("textarea", { class: "paste-area", placeholder: '{ "title": "My Quiz", "sections": [...] }', spellcheck: "false" }, []),
        h("div", { class: "paste-actions" }, [
          h("button", { class: "sticker-btn accent" }, ["LOAD"]),
          h("button", { class: "sticker-btn" }, ["CANCEL"]),
        ]),
      ]),
    ]),
    h("div", { class: "load-url hidden" }, [
      h("div", { class: "load-paste-card" }, [
        h("div", { class: "load-paste-head" }, [
          h("h3", {}, ["FETCH FROM URL"]),
          h("button", { class: "pm-close url-cancel-x", "aria-label": "Close" }, ["✕"]),
        ]),
        h("input", { class: "url-input", placeholder: "https://example.com/quiz.json", spellcheck: "false" }, []),
        h("div", { class: "paste-actions" }, [
          h("button", { class: "sticker-btn accent url-go" }, ["FETCH"]),
          h("button", { class: "sticker-btn url-cancel" }, ["CANCEL"]),
        ]),
      ]),
    ]),
  ]);

  /* ---- wire events ---- */
  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  const dz = el.querySelector<HTMLElement>(".drop-zone")!;
  const fileInput = h("input", { type: "file", accept: ".json,application/json" });
  dz.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void loadFromFile(f);
  });
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragging");
    }),
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      fx.ink(e.clientX, e.clientY);
      void loadFromFile(f);
    }
  });
  dz.addEventListener("mouseenter", () => audio.sfx("hover"));

  // paste modal
  const pasteBox = el.querySelector<HTMLElement>(".load-paste")!;
  const pasteArea = el.querySelector<HTMLTextAreaElement>(".paste-area")!;
  el.querySelectorAll<HTMLButtonElement>(".load-actions .sticker-btn").forEach((b, i) => {
    b.addEventListener("mouseenter", () => audio.sfx("hover"));
    b.addEventListener("click", () => {
      audio.sfx("select");
      if (i === 0) fileInput.click();
      if (i === 1) {
        pasteBox.classList.remove("hidden");
        gsap.fromTo(pasteBox, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(1.5)" });
        pasteArea.focus();
      }
      if (i === 2) {
        const urlBox = el.querySelector<HTMLElement>(".load-url")!;
        urlBox.classList.remove("hidden");
        gsap.fromTo(urlBox, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(1.5)" });
        el.querySelector<HTMLInputElement>(".url-input")!.focus();
      }
    });
  });
  pasteBox.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.addEventListener("click", async () => {
      if (b.textContent === "CANCEL" || b.classList.contains("paste-cancel")) {
        pasteBox.classList.add("hidden");
        return;
      }
      try {
        const quiz = await attempt(JSON.parse(pasteArea.value), "pasted");
        if (quiz) void startQuiz({ ...quiz, source: "pasted" });
      } catch {
        audio.sfx("wrong");
        fx.shake(12);
        showErrors(["Not valid JSON — check commas and quotes."]);
      }
    });
  });
  const urlBox = el.querySelector<HTMLElement>(".load-url")!;
  urlBox.querySelector(".url-cancel")!.addEventListener("click", () => urlBox.classList.add("hidden"));
  urlBox.querySelector(".url-cancel-x")!.addEventListener("click", () => urlBox.classList.add("hidden"));
  urlBox.querySelector(".url-go")!.addEventListener("click", async () => {
    const input = urlBox.querySelector<HTMLInputElement>(".url-input")!;
    try {
      const quiz = await fetchRemoteQuiz(input.value.trim());
      const ok = await attempt(quiz, input.value.trim());
      if (ok) void startQuiz({ ...ok, source: input.value.trim() });
    } catch (e) {
      audio.sfx("wrong");
      fx.shake(12);
      showErrors([`Could not fetch: ${e instanceof Error ? e.message : e}`]);
    }
  });
  urlBox.querySelector<HTMLInputElement>(".url-input")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (urlBox.querySelector<HTMLButtonElement>(".url-go")!).click();
  });

  // global paste
  const onPaste = (e: ClipboardEvent) => {
    if (pasteBox.classList.contains("hidden") && urlBox.classList.contains("hidden")) {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim().startsWith("{")) {
        e.preventDefault();
        pasteBox.classList.remove("hidden");
        pasteArea.value = text.trim();
        void attempt(JSON.parse(text.trim()), "pasted").then((quiz) => {
          if (quiz) void startQuiz({ ...quiz, source: "pasted" });
        }).catch(() => undefined);
      }
    }
  };
  window.addEventListener("paste", onPaste);

  // samples
  const grid = el.querySelector<HTMLElement>(".samples-grid")!;
  const sampleNames = ["persona5", "general", "math", "code"];
  const sampleTitles = ["P5 TRIVIA", "GENERAL KNOWLEDGE", "MATH", "CODE"];
  sampleNames.forEach((name, i) => {
    const card = h("button", { class: "sample-card" }, [
      h("div", { class: "sample-card-art" }, [
        h("span", { class: "sample-star" }, ["★"]),
        h("span", { class: "sample-num" }, [String(i + 1).padStart(2, "0")]),
      ]),
      h("div", { class: "sample-card-title" }, [sampleTitles[i]]),
      h("div", { class: "sample-card-sub" }, ["BUILT-IN"]),
    ]);
    card.addEventListener("mouseenter", () => audio.sfx("hover"));
    card.addEventListener("click", async () => {
      audio.sfx("paper");
      const res = await fetch(`./sample-quizzes/${name}.json`);
      const quiz = (await res.json()) as Quiz;
      saveQuiz(quiz, `sample:${name}`);
      void startQuiz({ ...quiz, source: `sample:${name}` });
    });
    grid.appendChild(card);
  });

  // resume
  progress = loadProgress();
  if (progress) {
    const saved = savedQuizzes().find((s) => s.quiz.title === progress!.quizId);
    if (saved) {
      const resume = h("button", { class: "resume-chip" }, [
        h("span", {}, [`▶ RESUME “${saved.quiz.title}” (Q${progress!.index + 1})`]),
      ]);
      resume.addEventListener("click", () => {
        audio.sfx("paper");
        void startQuiz({ ...saved.quiz, savedId: saved.id, source: saved.source });
      });
      el.querySelector(".load-body")!.prepend(resume);
    }
  }

  root.appendChild(el);

  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    cardSlam(dz, 0.05);
    gsap.fromTo(".load-actions .sticker-btn", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, duration: 0.35, ease: "back.out(1.6)", delay: 0.15 });
    gsap.fromTo(".sample-card", { y: 40, opacity: 0, rotate: -4 }, { y: 0, opacity: 1, rotate: 0, stagger: 0.08, duration: 0.4, ease: "back.out(1.4)", delay: 0.25 });
  }

  return () => {
    window.removeEventListener("paste", onPaste);
  };
});
