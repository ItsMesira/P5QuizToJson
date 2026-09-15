/* ============ P5 QUIZ — CLASS DASHBOARD (members, quiz shelf, class leaderboard) ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { cloud, cloudError } from "../core/api";
import { validateQuiz } from "../core/validator";
import { saveQuiz } from "../core/store";
import { t } from "../core/i18n";

registerScreen("dashboard", (root) => {
  const session = cloud.session;
  if (!session) {
    void go({ name: "entry" }, { instant: true });
    return () => undefined;
  }

  const cls = session.cls;

  const el = h("div", { class: "screen dashboard-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("CLASSROOM")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "dash-body" }, [
      cls
        ? h("div", { class: "dash-hero" }, [
            h("div", { class: "dash-classname" }, [cls.name]),
            h("div", { class: "dash-code" }, [
              h("span", { class: "dash-code-label" }, [t("JOIN CODE:")]),
              h("span", { class: "dash-code-value" }, [cls.code]),
              h("button", { class: "lib-btn dash-copy" }, [t("⧉ COPY")]),
            ]),
            h("div", { class: "dash-role" }, [`${cls.role.toUpperCase()} · ${session.user.username}`]),
          ])
        : h("div", { class: "dash-empty" }, [
            h("div", { class: "dash-empty-title" }, [t("NO CLASSROOM YET")]),
            h("p", { class: "dash-empty-sub" }, [t("Join with a class code from your teacher, or start your own class.")]),
          ]),
      cls
        ? h("div", { class: "dash-columns" }, [
            h("section", { class: "dash-col" }, [
              h("h3", { class: "dash-head" }, [t("— MEMBERS —")]),
              h("div", { class: "dash-members" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
            ]),
            h("section", { class: "dash-col" }, [
              h("h3", { class: "dash-head" }, [t("— CLASS QUIZ SHELF —")]),
              h("div", { class: "dash-quizzes" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
              h("button", { class: "sticker-btn accent dash-add" }, [t("＋ ADD A QUIZ")]),
            ]),
            h("section", { class: "dash-col" }, [
              h("h3", { class: "dash-head" }, [t("— CLASS LEADERBOARD —")]),
              h("div", { class: "dash-board" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
            ]),
          ])
        : null,
      h("div", { class: "dash-actions" }, [
        h("button", { class: "sticker-btn dash-home" }, ["⌂ TITLE"]),
        h("button", { class: "sticker-btn dash-switch" }, [cls ? t("⇄ SWITCH CLASS") : t("⇄ JOIN / MAKE A CLASS")]),
        h("button", { class: "sticker-btn accent dash-play" }, [t("▶ PLAY SOLO")]),
        h("button", { class: "sticker-btn dash-logout" }, [t("✕ LOG OUT")]),
      ]),
    ]),
  ]);

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  /* ---- copy join code ---- */
  el.querySelector(".dash-copy")?.addEventListener("click", async () => {
    if (!cls) return;
    await navigator.clipboard.writeText(cls.code).catch(() => undefined);
    audio.sfx("stamp");
    toast(t("Code {code} copied", { code: cls.code }), "info");
  });

  /* ---- actions ---- */
  el.querySelector(".dash-home")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".dash-switch")!.addEventListener("click", () => void go({ name: "entry" }));
  el.querySelector(".dash-play")!.addEventListener("click", () => void go({ name: "load" }));
  el.querySelector(".dash-logout")!.addEventListener("click", async () => {
    await cloud.logout().catch(() => undefined);
    cloud.setSession(null);
    toast(t("Logged out"), "info");
    void go({ name: "entry" });
  });
  el.querySelector(".dash-add")?.addEventListener("click", () => void go({ name: "load" }));

  /* ---- data ---- */
  async function loadData() {
    const membersBox = el.querySelector<HTMLElement>(".dash-members");
    const quizBox = el.querySelector<HTMLElement>(".dash-quizzes");
    const boardBox = el.querySelector<HTMLElement>(".dash-board");
    if (!cls || !membersBox || !quizBox || !boardBox) return;
    const c = cls;

    try {
      const info = await cloud.classInfo(c.id);
      if (info.ok && info.data.members) {
        membersBox.textContent = "";
        info.data.members.forEach((m, i) => {
          const row = h("div", { class: `dash-member ${m.role === "teacher" ? "teacher" : ""}` }, [
            h("span", { class: "dash-member-role" }, [m.role === "teacher" ? "★" : "🎓"]),
            h("span", {}, [m.username]),
            m.role === "teacher" ? h("span", { class: "dash-member-tag" }, [t("TEACHER")]) : null,
          ]);
          membersBox.appendChild(row);
          if (!RM()) gsap.fromTo(row, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.05, ease: "back.out(1.5)" });
        });
      } else {
        membersBox.textContent = "";
        membersBox.appendChild(h("p", { class: "profile-empty" }, [info.data.error ? cloudError(info) : t("Couldn't load members")]));
      }

      const quizzes = await cloud.listQuizzes(c.id);
      if (quizzes.ok && quizzes.data.quizzes) {
        quizBox.textContent = "";
        if (!quizzes.data.quizzes.length) {
          quizBox.appendChild(h("p", { class: "profile-empty" }, [t("No quizzes yet — ADD one below.")]));
        }
        quizzes.data.quizzes.forEach((q, i) => {
          const row = h("div", { class: "dash-quiz" }, [
            h("div", { class: "dash-quiz-title" }, [q.title]),
            h("div", { class: "dash-quiz-meta" }, [t("by {author}", { author: q.author })]),
            h("div", { class: "dash-quiz-actions" }, [
              h("button", { class: "lib-btn play dash-quiz-play", "data-qid": q.id }, [t("▶ PLAY")]),
              c.role === "teacher"
                ? h("button", { class: "lib-btn danger dash-quiz-del", "data-qid": q.id }, ["✕"])
                : null,
            ]),
          ]);
          quizBox.appendChild(row);
          if (!RM()) gsap.fromTo(row, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, delay: i * 0.05, ease: "back.out(1.5)" });
        });
        quizBox.querySelectorAll<HTMLElement>(".dash-quiz-play").forEach((b) => {
          b.addEventListener("click", async () => {
            audio.sfx("select");
            const r = await cloud.fetchQuiz(c.id, b.getAttribute("data-qid")!);
            if (r.ok && r.data.quiz) {
              const v = validateQuiz(r.data.quiz);
              if (v.ok) {
                saveQuiz(v.quiz, `class:${c.name}`);
                await startQuiz({ ...v.quiz, source: `class:${c.name}` });
              } else {
                toast(t("That quiz is broken"), "error");
              }
            } else {
              toast(cloudError(r), "error");
            }
          });
        });
        quizBox.querySelectorAll<HTMLElement>(".dash-quiz-del").forEach((b) => {
          b.addEventListener("click", async () => {
            const r = await cloud.deleteQuiz(c.id, b.getAttribute("data-qid")!);
            if (r.ok) {
              audio.sfx("paper");
              toast(t("Quiz removed from the class"), "info");
              void loadData();
            } else {
              toast(cloudError(r), "error");
            }
          });
        });
      } else {
        quizBox.textContent = "";
        quizBox.appendChild(h("p", { class: "profile-empty" }, [quizzes.data.error ? cloudError(quizzes) : t("Couldn't load quizzes")]));
      }

      const results = await cloud.classResults(c.id);
      if (results.ok && results.data.results) {
        boardBox.textContent = "";
        if (!results.data.results.length) {
          boardBox.appendChild(h("p", { class: "profile-empty" }, [t("No scores yet — play something!")]));
        }
        results.data.results.slice(0, 15).forEach((r, i) => {
          const row = h("div", { class: `dash-row ${i < 3 ? "podium" : ""}` }, [
            h("span", { class: "dash-row-pos" }, [i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1)]),
            h("span", { class: "dash-row-rank" }, [r.rank]),
            h("span", { class: "dash-row-name" }, [r.username]),
            h("span", { class: "dash-row-quiz" }, [r.quizTitle]),
            h("span", { class: "dash-row-pts" }, [`${r.points}`]),
          ]);
          boardBox.appendChild(row);
          if (!RM()) gsap.fromTo(row, { x: 30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.04, ease: "back.out(1.5)" });
        });
      } else {
        boardBox.textContent = "";
        boardBox.appendChild(h("p", { class: "profile-empty" }, [results.data.error ? cloudError(results) : t("Couldn't load scores")]));
      }
    } catch (err) {
      console.error("[p5q] dashboard load failed:", err);
      for (const box of [membersBox, quizBox, boardBox]) {
        box.textContent = "";
        box.appendChild(h("p", { class: "profile-empty" }, [t("Couldn't load — check your connection and try again.")]));
      }
    }
  }

  root.appendChild(el);
  if (cls) void loadData();
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".dash-hero", { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.4)" });
    gsap.fromTo(".dash-col", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
  }
  void fx;
  return () => undefined;
});
