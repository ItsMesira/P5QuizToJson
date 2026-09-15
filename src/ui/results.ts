/* ============ P5 QUIZ — ALL-OUT ATTACK RESULTS ============ */
import gsap from "gsap";
import { registerScreen, go, app } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM, stampIn, cutIn } from "../fx/transitions";
import { randomPortrait } from "../core/art";
import { addScore, addXp, addProfileXp, bestForQuiz, unlockAchievement, recordPlay, goalFor, clearGoal } from "../core/store";
import { checkAchievements } from "../engine/achievements";
import type { QuizResult } from "../core/types";
import { RANKS } from "../core/types";

registerScreen("results", (root) => {
  const result = app.lastResult;
  if (!result) {
    void go({ name: "title" }, { instant: true });
    return () => undefined;
  }
  const rank = RANKS.find((r) => r.key === result.rank) ?? RANKS[RANKS.length - 1];

  /* persist */
  addScore(result);
  const gained = result.correct * 10 + (result.rank === "S" ? 100 : result.rank === "A" ? 60 : 0);
  const totalXp = addXp(gained);
  addProfileXp(gained);
  const unlocked = checkAchievements(result).filter((a) => unlockAchievement(a.id));

  /* classroom sync: post the score to the class leaderboard */
  void import("../core/api").then(({ cloud }) => {
    if (cloud.session?.cls) {
      void cloud.submitResult(cloud.session.cls.id, {
        quizTitle: result.quizTitle,
        points: result.points,
        maxPoints: result.maxPoints,
        rank: result.rank,
        correct: result.correct,
        total: result.total,
      });
    }
  });

  const pct = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  const mins = Math.floor(result.timeMs / 60000);
  const secs = Math.round((result.timeMs % 60000) / 1000);

  /* study loop: record topic stats + goal check */
  const wrongs = result.perQuestion.filter((q) => !q.correct).map((q) => `${q.question} → ${q.correctAnswer}`);
  recordPlay(result.quizTitle, result.rank, pct, wrongs);
  const goal = goalFor(result.quizTitle);
  const goalHit = goal && ["S", "A", "B", "C", "D", "F"].indexOf(result.rank) <= ["S", "A", "B", "C", "D", "F"].indexOf(goal.targetRank);
  if (goalHit) {
    clearGoal(result.quizTitle);
    window.setTimeout(() => {
      toast(`GOAL REACHED — ${goal.targetRank} rank in “${result.quizTitle}”!`, "info");
      audio.sfx("rankup");
      fx.starRain(2);
    }, 5400);
  }

  const el = h("div", { class: "screen results-screen" }, [
    h("div", { class: "aot" }, [
      h("div", { class: "aot-slash" }, []),
      h("h1", { class: "aot-title" }, ["ALL-OUT"]),
      h("h1", { class: "aot-title-2" }, ["ATTACK"]),
    ]),
    h("div", { class: "results-body" }, [
      h("section", { class: "rank-card" }, [
        h("div", { class: "rank-card-inner corner-frame" }, [
          h("div", { class: "rank-letter", style: `color:${rank.color}` }, [result.rank]),
          h("div", { class: "rank-label" }, [rank.label]),
          h("div", { class: "rank-sub" }, [result.pass ? "HEIST COMPLETE" : "HEIST FAILED"]),
          h("div", { class: "rank-stars" }, ["★".repeat(result.rank === "S" ? 5 : result.rank === "A" ? 4 : result.rank === "B" ? 3 : 2)]),
        ]),
      ]),
      h("section", { class: "stat-grid" }, [
        statCard("POINTS", `${result.points}`, `/${result.maxPoints}`),
        statCard("ACCURACY", `${pct}%`, `${result.correct}/${result.total} CORRECT`),
        statCard("TIME", `${mins}:${String(secs).padStart(2, "0")}`, "ELAPSED"),
        statCard("BEST STREAK", `${result.bestStreak}`, "IN A ROW"),
      ]),
      h("section", { class: "radar-wrap" }, [
        h("h3", { class: "rs-title" }, ["— THIEF STATS —"]),
        radarChart(result),
      ]),
      h("section", { class: "chart-wrap" }, [
        h("h3", { class: "rs-title" }, ["— BY SECTION —"]),
        sectionBars(result),
      ]),
      unlocked.length
        ? h("section", { class: "ach-wrap" }, [
            h("h3", { class: "rs-title" }, ["— ACHIEVEMENTS —"]),
            h("div", { class: "ach-grid" }, unlocked.map((a) =>
              h("div", { class: "ach-card" }, [
                h("span", { class: "ach-icon" }, [a.icon]),
                h("div", {}, [h("div", { class: "ach-name" }, [a.name]), h("div", { class: "ach-desc" }, [a.desc])]),
              ]),
            )),
          ])
        : null,
      h("section", { class: "xp-bar" }, [
        h("div", { class: "xp-label" }, [`+${gained} XP · TOTAL ${totalXp}`]),
        h("div", { class: "xp-track" }, [h("div", { class: "xp-fill" }, [])]),
      ]),
      h("section", { class: "review-wrap" }, [
        h("h3", { class: "rs-title" }, ["— REVIEW —"]),
        h("div", { class: "review-list" }, result.perQuestion.map((pq, i) => {
          const unanswered = pq.answer === undefined || pq.answer === null;
          const answerShown = pq.answer ? pq.answer.replace(/\u0001/g, " → ").replace(/\|\|\|/g, " ↔ ") : null;
          return h("div", { class: `review-row ${pq.correct ? "ok" : unanswered ? "skip" : "bad"}` }, [
            h("span", { class: "review-icon" }, [pq.correct ? "✓" : unanswered ? "–" : "✕"]),
            h("div", { class: "review-body" }, [
              h("div", { class: "review-q" }, [
                `Q${i + 1} · ${pq.section} — ${pq.question}`,
                pq.flagged ? h("span", { class: "review-flag", title: "Flagged for review" }, [" ⚑"]) : null,
              ]),
              !unanswered && answerShown ? h("div", { class: "review-a" }, [`You said: ${answerShown}`]) : null,
              !unanswered && pq.correctAnswer && !pq.correct ? h("div", { class: "review-a" }, [`Answer: ${pq.correctAnswer}`]) : null,
              unanswered ? h("div", { class: "review-a" }, ["Not answered"]) : null,
              pq.explanation ? h("div", { class: "review-e" }, [pq.explanation]) : null,
            ]),
          ]);
        })),
      ]),
      h("section", { class: "results-actions" }, [
        h("button", { class: "sticker-btn accent" }, ["↻ RETRY"]),
        h("button", { class: "sticker-btn reinforce-btn" }, ["🎯 REINFORCE WEAK AREAS"]),
        h("button", { class: "sticker-btn" }, ["⤓ SHARE CARD"]),
        h("button", { class: "sticker-btn" }, ["⧉ COPY RESULT"]),
        h("button", { class: "sticker-btn" }, ["🏆 LEADERBOARD"]),
        h("button", { class: "sticker-btn" }, ["⌂ HOME"]),
      ]),
    ]),
  ]);

  function statCard(label: string, big: string, sub: string): HTMLElement {
    return h("div", { class: "stat-card" }, [
      h("div", { class: "stat-label" }, [label]),
      h("div", { class: "stat-big" }, [big]),
      h("div", { class: "stat-sub" }, [sub]),
    ]);
  }

  function radarChart(r: QuizResult): HTMLElement {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 220 220");
    svg.classList.add("radar");
    const cx = 110;
    const cy = 110;
    const R = 78;
    const axes = [
      { label: "ACC", v: r.total ? r.correct / r.total : 0 },
      { label: "SPEED", v: Math.max(0, 1 - r.timeMs / (r.total * 15000)) },
      { label: "STREAK", v: Math.min(1, r.bestStreak / 10) },
      { label: "POWER", v: r.maxPoints ? Math.max(0, r.points / r.maxPoints) : 0 },
      { label: "RANK", v: 1 - RANKS.findIndex((x) => x.key === r.rank) / (RANKS.length - 1) },
    ];
    // grid rings
    for (let ring = 1; ring <= 4; ring++) {
      const poly = document.createElementNS(svgNS, "polygon");
      const pts = axes.map((_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / axes.length;
        const rr = (R * ring) / 4;
        return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
      });
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("class", "radar-grid");
      svg.appendChild(poly);
    }
    // spokes
    axes.forEach((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / axes.length;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(cx));
      line.setAttribute("y1", String(cy));
      line.setAttribute("x2", String(cx + Math.cos(a) * R));
      line.setAttribute("y2", String(cy + Math.sin(a) * R));
      line.setAttribute("class", "radar-grid");
      svg.appendChild(line);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", String(cx + Math.cos(a) * (R + 16)));
      text.setAttribute("y", String(cy + Math.sin(a) * (R + 16) + 4));
      text.setAttribute("class", "radar-label");
      text.setAttribute("text-anchor", "middle");
      text.textContent = axes[i].label;
      svg.appendChild(text);
    });
    // value polygon
    const poly = document.createElementNS(svgNS, "polygon");
    const pts = axes.map((ax, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / axes.length;
      const rr = R * Math.max(0.06, ax.v);
      return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
    });
    poly.setAttribute("points", pts.join(" "));
    poly.setAttribute("class", "radar-value");
    svg.appendChild(poly);
    const wrap = h("div", { class: "radar-box" }, [svg]);
    if (!RM()) {
      gsap.fromTo(poly, { opacity: 0, scale: 0.2, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.8, ease: "elastic.out(1, 0.5)" });
    }
    return wrap;
  }

  function sectionBars(r: QuizResult): HTMLElement {
    const bySection = new Map<string, { total: number; correct: number }>();
    r.perQuestion.forEach((pq) => {
      const cur = bySection.get(pq.section) ?? { total: 0, correct: 0 };
      cur.total++;
      if (pq.correct) cur.correct++;
      bySection.set(pq.section, cur);
    });
    const wrap = h("div", { class: "bars" }, []);
    bySection.forEach((v, name) => {
      const p = v.total ? Math.round((v.correct / v.total) * 100) : 0;
      const bar = h("div", { class: "bar-row" }, [
        h("div", { class: "bar-label" }, [name]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill", style: `width:0%` }, [])]),
        h("div", { class: "bar-pct" }, [`${p}%`]),
      ]);
      wrap.appendChild(bar);
      if (!RM()) {
        gsap.to(bar.querySelector(".bar-fill"), { width: `${p}%`, duration: 0.7, delay: 0.3, ease: "power3.out" });
        gsap.fromTo(bar, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: "back.out(1.5)", delay: 0.3 });
      } else {
        (bar.querySelector(".bar-fill") as HTMLElement).style.width = `${p}%`;
      }
    });
    return wrap;
  }

  /* ---------- actions ---------- */

  const actions = el.querySelector<HTMLElement>(".results-actions")!;
  const btns = actions.querySelectorAll<HTMLButtonElement>("button");
  btns.forEach((b) => b.addEventListener("mouseenter", () => audio.sfx("hover")));
  btns[0].addEventListener("click", async () => {
    audio.sfx("select");
    if (app.currentQuiz) {
      const { startQuiz } = await import("./screens");
      await startQuiz(app.currentQuiz);
    }
  });
  btns[1].addEventListener("click", () => {
    audio.sfx("select");
    void import("./prompts").then(({ prefillBuilderFromMisses }) => {
      prefillBuilderFromMisses(result.quizTitle);
      void go({ name: "prompts" });
    });
  });
  btns[2].addEventListener("click", () => {
    audio.sfx("paper");
    downloadCard(result);
  });
  btns[3].addEventListener("click", async () => {
    audio.sfx("stamp");
    const text = resultText(result);
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toast("Result copied", "info");
  });
  btns[4].addEventListener("click", () => {
    audio.sfx("select");
    void go({ name: "leaderboard" });
  });
  btns[5].addEventListener("click", () => {
    audio.sfx("select");
    void go({ name: "title" });
  });

  /* ---------- share card (canvas) ---------- */

  function downloadCard(r: QuizResult) {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 500;
    const ctx = canvas.getContext("2d")!;
    // bg
    ctx.fillStyle = "#0c0c0e";
    ctx.fillRect(0, 0, 900, 500);
    // stripes
    ctx.save();
    ctx.translate(450, 250);
    ctx.rotate(-0.2);
    ctx.fillStyle = "rgba(230,0,18,0.25)";
    for (let i = -8; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(-900 + i * 90, -600);
      ctx.lineTo(-700 + i * 90, -600);
      ctx.lineTo(-700 + i * 90 - 160, 600);
      ctx.lineTo(-900 + i * 90 - 160, 600);
      ctx.fill();
    }
    ctx.restore();
    // title
    ctx.fillStyle = "#f6f4f0";
    ctx.font = "900 72px 'Archivo Black', sans-serif";
    ctx.fillText(r.quizTitle.toUpperCase().slice(0, 16), 60, 110);
    ctx.fillStyle = r.accent;
    ctx.font = "900 150px 'Archivo Black', sans-serif";
    ctx.fillText(r.rank, 60, 280);
    ctx.fillStyle = "#f6f4f0";
    ctx.font = "700 30px 'Barlow Condensed', sans-serif";
    ctx.fillText(`${r.correct}/${r.total} CORRECT · ${r.points} PTS · ${r.bestStreak} STREAK`, 62, 330);
    ctx.fillStyle = "#8a8a93";
    ctx.font = "600 22px 'Barlow Condensed', sans-serif";
    ctx.fillText("p5-quiz · steal the answers", 62, 440);
    // star
    ctx.save();
    ctx.translate(800, 140);
    ctx.fillStyle = r.accent;
    const star = (s: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? s : s * 0.42;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
    };
    star(90);
    ctx.restore();
    const a = document.createElement("a");
    a.download = `${r.quizTitle.replace(/\s+/g, "-").toLowerCase()}-result.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  function resultText(r: QuizResult): string {
    return `★ P5 QUIZ — ${r.quizTitle.toUpperCase()} ★\nRANK: ${r.rank} (${r.pass ? "HEIST COMPLETE" : "FAILED"})\n${r.points}/${r.maxPoints} pts · ${r.correct}/${r.total} correct · streak ${r.bestStreak}\n`;
  }

  root.appendChild(el);

  /* ---------- entrance choreography ---------- */

  audio.setIntensity(0);
  audio.sfx("rankup");
  fx.setAmbientGold(true);
  fx.flash("#e60012", 0.55);
  fx.slashes(8);
  fx.starRain(3, result.pass);
  if (result.pass) fx.confetti(window.innerWidth / 2, window.innerHeight * 0.35, 120);

  if (!RM()) {
    const p1 = randomPortrait();
    const p2 = randomPortrait();
    const tl = gsap.timeline();
    tl.fromTo(".aot-title", { x: -160, opacity: 0, skewX: 20 }, { x: 0, opacity: 1, skewX: 0, duration: 0.5, ease: "power3.out" }, 0.05)
      .fromTo(".aot-title-2", { x: 160, opacity: 0, skewX: -20 }, { x: 0, opacity: 1, skewX: 0, duration: 0.5, ease: "power3.out" }, 0.1)
      .fromTo(".aot-slash", { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.35, ease: "power3.inOut" }, 0.15)
      .to(".aot", { opacity: 0, duration: 0.4, delay: 1.15, onComplete: () => {
        el.querySelector<HTMLElement>(".aot")!.style.display = "none";
      } })
      // rotating party cut-ins before the rank card
      .call(() => {
        void cutIn(el, { name: p1.name, img: p1.src, quick: true });
      }, [], 1.5)
      .fromTo(".rank-card", { scale: 0.3, opacity: 0, rotate: 10 }, { scale: 1, opacity: 1, rotate: -2, duration: 0.5, ease: "back.out(1.4)" }, 2.4)
      .fromTo(".rank-letter", { scale: 3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "power3.out" }, 2.52)
      .fromTo(".rank-stars", { scale: 0 }, { scale: 1, duration: 0.4, ease: "back.out(2)" }, 2.85)
      .fromTo(".stat-card", { y: 60, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, duration: 0.45, ease: "back.out(1.5)" }, 2.7)
      .call(() => {
        void cutIn(el, { name: p2.name, img: p2.src, quick: true });
      }, [], 4.4)
      .fromTo(".rs-title", { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.15 }, 3.6)
      .fromTo(".review-row", { x: 50, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "power2.out" }, 3.9)
      .fromTo(".results-actions .sticker-btn", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, duration: 0.35, ease: "back.out(1.6)" }, 4.6);

    // achievements pop one by one
    unlocked.forEach((_a, i) => {
      const card = el.querySelectorAll<HTMLElement>(".ach-card")[i];
      if (!card) return;
      tl.call(() => {
        audio.sfx("unlock");
        fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, big: true });
        stampIn(card);
      }, [], 4.2 + i * 0.6);
    });

    // xp fill
    tl.to(".xp-fill", { width: "100%", duration: 1.2, ease: "power3.inOut" }, 4.9);
  } else {
    el.querySelector<HTMLElement>(".aot")!.style.display = "none";
    (el.querySelector<HTMLElement>(".xp-fill")!).style.width = "100%";
  }

  return () => {
    audio.setIntensity(0);
    fx.setAmbientGold(false);
  };
});

/* preload best score hint for retry messaging */
export function bestScore(quizId: string) {
  return bestForQuiz(quizId);
}
