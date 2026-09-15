/* ============ P5 QUIZ — LEADERBOARD (local + class) ============ */
import gsap from "gsap";
import { registerScreen, go } from "./screens";
import { h } from "./dom";
import { audio } from "../core/audio";
import { RM } from "../fx/transitions";
import { highScores } from "../core/store";
import { cloud } from "../core/api";
import { RANKS } from "../core/types";

registerScreen("leaderboard", (root) => {
  const scores = highScores().slice(0, 30);
  const classSession = cloud.session?.cls;

  const el = h("div", { class: "screen leaderboard-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": "Back" }, ["◀"]),
      h("h2", { class: "screen-title" }, ["LEADERBOARD"]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "leaderboard-body" }, [
      classSession
        ? h("section", { class: "class-board" }, [
            h("h3", { class: "rs-title" }, [`— CLASS: ${classSession.name.toUpperCase()} —`]),
            h("div", { class: "lb-list class-lb" }, [h("p", { class: "profile-empty" }, ["Loading class scores…"])]),
          ])
        : null,
      h("h3", { class: "rs-title" }, ["— THIS DEVICE —"]),
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

  /* class leaderboard load */
  if (classSession) {
    const box = el.querySelector<HTMLElement>(".class-lb")!;
    void cloud.classResults(classSession.id).then((r) => {
      if (!r.ok || !r.data.results) {
        box.textContent = "";
        box.appendChild(h("p", { class: "profile-empty" }, [r.data.error ?? "Couldn't load class scores"]));
        return;
      }
      box.textContent = "";
      if (!r.data.results.length) {
        box.appendChild(h("p", { class: "profile-empty" }, ["No class scores yet."]));
        return;
      }
      r.data.results.slice(0, 15).forEach((s, i) => {
        const row = h("div", { class: `lb-row ${i < 3 ? "podium" : ""}` }, [
          h("span", { class: "lb-pos" }, [i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1).padStart(2, "0")]),
          h("span", { class: "lb-rank" }, [s.rank]),
          h("span", { class: "lb-quiz" }, [s.username]),
          h("span", { class: "lb-stats" }, [s.quizTitle]),
          h("span", { class: "lb-pts" }, [`${s.points}`]),
        ]);
        box.appendChild(row);
        if (!RM()) gsap.fromTo(row, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.04, ease: "back.out(1.5)" });
      });
    });
  }

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  root.appendChild(el);
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".lb-row", { x: 80, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.04, duration: 0.35, ease: "back.out(1.4)" });
  }
  return () => undefined;
});
