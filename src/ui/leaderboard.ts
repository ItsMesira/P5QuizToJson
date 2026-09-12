/* ============ P5 QUIZ — LEADERBOARD ============ */
import gsap from "gsap";
import { registerScreen, go } from "./screens";
import { h } from "./dom";
import { audio } from "../core/audio";
import { RM } from "../fx/transitions";
import { highScores } from "../core/store";
import { RANKS } from "../core/types";

registerScreen("leaderboard", (root) => {
  const scores = highScores().slice(0, 30);
  const el = h("div", { class: "screen leaderboard-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": "Back" }, ["◀"]),
      h("h2", { class: "screen-title" }, ["LEADERBOARD"]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "leaderboard-body" }, [
      scores.length === 0
        ? h("div", { class: "lib-empty" }, [
            h("div", { class: "lib-empty-star" }, ["★"]),
            h("p", {}, ["NO RECORDS YET."]),
            h("p", { class: "lib-empty-sub" }, ["Finish a heist and your name goes on the board."]),
          ])
        : h("div", { class: "lb-list" }, scores.map((s, i) => {
            const rank = RANKS.find((r) => r.key === s.rank);
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1).padStart(2, "0");
            return h("div", { class: `lb-row ${i < 3 ? "podium" : ""}` }, [
              h("span", { class: "lb-pos" }, [medal]),
              h("span", { class: "lb-rank", style: `color:${rank?.color ?? "#fff"}` }, [s.rank]),
              h("span", { class: "lb-quiz" }, [s.quizTitle]),
              h("span", { class: "lb-stats" }, [`${s.correct}/${s.total} · ${s.bestStreak}🔥`]),
              h("span", { class: "lb-pts" }, [`${s.points}`]),
            ]);
          })),
    ]),
  ]);

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  root.appendChild(el);
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".lb-row", { x: 80, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.04, duration: 0.35, ease: "back.out(1.4)" });
  }
  return () => undefined;
});
