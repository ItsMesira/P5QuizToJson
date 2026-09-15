/* ============ P5 QUIZ — QUIZ LIBRARY ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { savedQuizzes, deleteQuiz, bestForQuiz, topicStats, setGoal, goalFor, clearGoal } from "../core/store";
import { encodeQuizLink, currentShareUrl } from "../core/share";
import { totalQuestions, validateQuiz } from "../core/validator";
import type { Quiz } from "../core/types";
import { RANKS } from "../core/types";
import { t, typeLabel } from "../core/i18n";

registerScreen("library", (root) => {
  const el = h("div", { class: "screen library-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("QUIZ LIBRARY")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "library-body" }, [
      h("div", { class: "library-grid" }, []),
    ]),
  ]);

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  const grid = el.querySelector<HTMLElement>(".library-grid")!;
  const quizzes = savedQuizzes();

  if (!quizzes.length) {
    grid.append(
      h("div", { class: "lib-empty" }, [
        h("div", { class: "lib-empty-star" }, ["★"]),
        h("p", {}, [t("NOTHING HERE YET.")]),
        h("p", { class: "lib-empty-sub" }, [t("Load a quiz.json — or play a built-in sample.")]),
        h("button", { class: "sticker-btn accent" }, [t("GO LOAD ONE")]),
      ]),
    );
    const b = grid.querySelector<HTMLButtonElement>("button")!;
    b.addEventListener("click", () => void go({ name: "load" }));
  }

  quizzes.forEach((saved, i) => {
    const best = bestForQuiz(saved.quiz.title);
    const rank = best ? RANKS.find((r) => r.key === best.rank) : null;
    const stats = topicStats()[saved.quiz.title];
    const goal = goalFor(saved.quiz.title);
    const card = h("article", { class: "lib-card", "data-id": saved.id }, [
      h("div", { class: "lib-card-top" }, [
        h("div", { class: "lib-title" }, [saved.quiz.title]),
        h("div", { class: "lib-meta" }, [
          h("span", {}, [t("{n} QUESTIONS", { n: totalQuestions(saved.quiz) })]),
          h("span", { class: "meta-sep" }, ["·"]),
          h("span", {}, [saved.source]),
        ]),
      ]),
      stats
        ? h("div", { class: "lib-progress" }, [
            h("span", {}, [t("{n} PLAY", { n: stats.plays }) + (stats.plays > 1 ? "S" : "")]),
            h("span", { class: "meta-sep" }, ["·"]),
            h("span", {}, [t("BEST {rank}", { rank: stats.bestRank })]),
            stats.misses.length
              ? h("span", { class: "lib-misses" }, [t("· {n} WEAK SPOTS", { n: stats.misses.length })])
              : null,
          ])
        : null,
      goal
        ? h("div", { class: "lib-goal" }, [
            h("span", { class: "lib-goal-target" }, [t("GOAL: {rank} RANK", { rank: goal.targetRank })]),
            h("span", {}, [t(" · {n} SESSION IN", { n: stats?.plays ?? 0 }) + ((stats?.plays ?? 0) === 1 ? "" : "S")]),
          ])
        : null,
      h("div", { class: "lib-card-bottom" }, [
        rank
          ? h("div", { class: "lib-best", style: `color:${rank.color}` }, [t("BEST {rank}", { rank: rank.key })])
          : h("div", { class: "lib-best none" }, [t("NO RECORD")]),
        h("div", { class: "lib-actions" }, [
          h("button", { class: "lib-btn play" }, [t("▶ PLAY")]),
          h("button", { class: "lib-btn inspect-btn" }, [t("🔍 INSPECT")]),
          h("button", { class: "lib-btn" }, [t("⧉ LINK")]),
          h("button", { class: "lib-btn" }, [t("⤓ JSON")]),
          h("button", { class: "lib-btn goal-btn" }, [goal ? "🎯 GOAL" : t("SET GOAL")]),
          h("button", { class: "lib-btn danger" }, ["✕"]),
        ]),
      ]),
    ]);
    card.addEventListener("mouseenter", () => audio.sfx("hover"));

    const play = card.querySelector<HTMLElement>(".play")!;
    play.addEventListener("click", () => {
      audio.sfx("paper");
      void startQuiz({ ...saved.quiz, savedId: saved.id, source: saved.source });
    });
    const inspect = card.querySelector<HTMLElement>(".inspect-btn")!;
    inspect.addEventListener("click", (e) => {
      e.stopPropagation();
      audio.sfx("select");
      openInspectModal(saved.quiz);
    });
    const link = card.querySelectorAll<HTMLElement>(".lib-btn")[2];
    link.addEventListener("click", async () => {
      audio.sfx("select");
      const enc = await encodeQuizLink(saved.quiz);
      await navigator.clipboard.writeText(currentShareUrl(enc)).catch(() => undefined);
      toast(t("Share link copied"), "info");
    });
    const json = card.querySelectorAll<HTMLElement>(".lib-btn")[3];
    json.addEventListener("click", () => {
      audio.sfx("paper");
      const blob = new Blob([JSON.stringify(saved.quiz, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${saved.quiz.title.replace(/\s+/g, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const del = card.querySelector<HTMLElement>(".danger")!;
    del.addEventListener("click", () => {
      audio.sfx("paper");
      gsap.to(card, {
        rotate: 8, x: 260, opacity: 0, duration: 0.4, ease: "power2.in",
        onComplete: () => {
          deleteQuiz(saved.id);
          card.remove();
          toast(t("Quiz deleted"), "info");
        },
      });
      fx.slashes(2);
    });

    const goalBtn = card.querySelector<HTMLElement>(".goal-btn")!;
    goalBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      audio.sfx("select");
      openGoalModal(saved.quiz.title, goal);
    });

    grid.appendChild(card);
    if (!RM()) {
      gsap.fromTo(card, { y: 50, opacity: 0, rotate: -3 }, { y: 0, opacity: 1, rotate: 0, duration: 0.4, delay: 0.05 * i, ease: "back.out(1.5)" });
    }
  });

  root.appendChild(el);
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
  }

  /* ---- goal modal ---- */
  const goalModal = h("div", { class: "prompt-modal hidden goal-modal" }, [
    h("div", { class: "prompt-modal-card goal-card" }, [
      h("div", { class: "pm-head" }, [
        h("h3", { class: "pm-title" }, [t("SET GOAL")]),
        h("button", { class: "pm-close" }, ["✕"]),
      ]),
      h("div", { class: "pm-body" }, [
        h("p", { class: "goal-q" }, []),
        h("div", { class: "goal-ranks" }, ["S", "A", "B", "C"].map((rk) => {
          const b = h("button", { class: "lib-btn goal-rank", "data-r": rk }, [rk]);
          return b;
        })),
        h("div", { class: "pm-actions" }, [
          h("button", { class: "sticker-btn accent goal-set-btn" }, [t("🎯 SET GOAL")]),
          h("button", { class: "sticker-btn goal-clear-btn" }, [t("CLEAR")]),
        ]),
      ]),
    ]),
  ]);
  root.appendChild(goalModal);
  let goalTitle = "";
  let pickedRank = "A";
  goalModal.querySelector<HTMLElement>(".pm-close")!.onclick = () => {
    audio.sfx("click");
    goalModal.classList.add("hidden");
  };
  goalModal.onclick = (e) => {
    if (e.target === goalModal) goalModal.classList.add("hidden");
  };
  goalModal.querySelectorAll<HTMLElement>(".goal-rank").forEach((b) => {
    b.addEventListener("click", () => {
      pickedRank = b.getAttribute("data-r")!;
      goalModal.querySelectorAll(".goal-rank").forEach((x) => x.classList.toggle("play", x === b));
      audio.sfx("select");
    });
  });
  goalModal.querySelector(".goal-set-btn")!.addEventListener("click", () => {
    setGoal(goalTitle, pickedRank);
    audio.sfx("rankup");
    fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 14 });
    goalModal.classList.add("hidden");
    toast(t("Goal set: {rank} rank in “{title}”", { rank: pickedRank, title: goalTitle }), "info");
    void go({ name: "library" }, { instant: true });
  });
  goalModal.querySelector(".goal-clear-btn")!.addEventListener("click", () => {
    clearGoal(goalTitle);
    audio.sfx("click");
    goalModal.classList.add("hidden");
    void go({ name: "library" }, { instant: true });
  });

  function openGoalModal(title: string, existing?: { targetRank: string }) {
    goalTitle = title;
    goalModal.querySelector<HTMLElement>(".goal-q")!.textContent = `Reach which rank in “${title}”?`;
    const first = goalModal.querySelector<HTMLElement>(`.goal-rank[data-r="${existing?.targetRank ?? "A"}"]`) ?? goalModal.querySelector<HTMLElement>(".goal-rank")!;
    goalModal.querySelectorAll(".goal-rank").forEach((x) => x.classList.remove("play"));
    first.classList.add("play");
    pickedRank = first.getAttribute("data-r")!;
    goalModal.classList.remove("hidden");
    gsap.fromTo(goalModal.querySelector(".goal-card")!, { scale: 0.7, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.35, ease: "back.out(1.5)" });
  }

  /* ---- inspect modal (see exactly what the app parsed from the quiz) ---- */
  const inspectModal = h("div", { class: "prompt-modal hidden inspect-modal" }, [
    h("div", { class: "prompt-modal-card goal-card" }, [
      h("div", { class: "pm-head" }, [
        h("h3", { class: "pm-title" }, [t("QUIZ INSPECT")]),
        h("button", { class: "pm-close" }, ["✕"]),
      ]),
      h("div", { class: "pm-body inspect-body" }, []),
    ]),
  ]);
  root.appendChild(inspectModal);
  inspectModal.querySelector<HTMLElement>(".pm-close")!.onclick = () => {
    audio.sfx("click");
    inspectModal.classList.add("hidden");
  };
  inspectModal.onclick = (e) => {
    if (e.target === inspectModal) inspectModal.classList.add("hidden");
  };

  function expectedOf(q: { type?: string; answers?: { text: string; correct?: boolean }[]; correctText?: string; pairs?: { left: string; right: string }[] }): string {
    switch (q.type) {
      case "multiple":
      case "boolean":
      case "multi":
        return (q.answers ?? []).filter((a) => a.correct).map((a) => a.text).join(", ") || "?";
      case "fill":
      case "numeric":
        return q.correctText ?? "?";
      case "order":
        return (q.answers ?? []).map((a) => a.text).join(" → ") || "?";
      case "match":
        return (q.pairs ?? []).map((p) => `${p.left} ↔ ${p.right}`).join(" · ") || "?";
      default:
        return "self-graded";
    }
  }

  function openInspectModal(quiz: Quiz) {
    const body = inspectModal.querySelector<HTMLElement>(".inspect-body")!;
    body.textContent = "";
    // inspect what the engine will ACTUALLY use — the normalized quiz
    const v = validateQuiz(quiz);
    const source = v.ok ? v.quiz : quiz;
    let n = 0;
    source.sections.forEach((s) => {
      body.appendChild(h("h4", { class: "inspect-section" }, [t("■ {name}", { name: s.name.toUpperCase() })]));
      s.questions.forEach((q) => {
        n++;
        const row = h("div", { class: "inspect-row" }, [
          h("div", { class: "inspect-q" }, [`Q${n} · ${typeLabel(q.type ?? "?")} — ${q.question}`]),
          h("div", { class: "inspect-a" }, [t("EXPECTED: {answer}", { answer: expectedOf(q as never) })]),
        ]);
        body.appendChild(row);
      });
    });
    inspectModal.classList.remove("hidden");
    gsap.fromTo(inspectModal.querySelector(".goal-card")!, { scale: 0.7, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.35, ease: "back.out(1.5)" });
  }

  return () => undefined;
});
