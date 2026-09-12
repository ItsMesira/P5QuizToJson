/* ============ P5 QUIZ — THIEF STATS (profiles, P5ex social-stats style) ============ */
import gsap from "gsap";
import { registerScreen, go } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { profiles, currentProfile, createProfile, switchProfile, unlockedAchievements, highScores, topicStats } from "../core/store";
import { PARTY } from "../core/art";

registerScreen("profiles", (root) => {
  let portraitIdx = 0;
  let listIdx = 0;
  const cur = currentProfile();

  const el = h("div", { class: "screen profiles-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": "Back" }, ["◀"]),
      h("h2", { class: "screen-title" }, ["THIEF STATS"]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "thief-body" }, [
      // --- character viewer ---
      h("div", { class: "thief-viewer" }, [
        h("button", { class: "thief-arrow left", "aria-label": "Previous portrait" }, ["◀"]),
        h("div", { class: "thief-stage" }, [
          h("img", { class: "thief-portrait", src: PARTY[0].src, alt: "" }),
          h("div", { class: "thief-name" }, [PARTY[0].name]),
          h("div", { class: "thief-role" }, ["PHANTOM THIEF"]),
        ]),
        h("button", { class: "thief-arrow right", "aria-label": "Next portrait" }, ["▶"]),
      ]),
      // --- stat rows ---
      h("div", { class: "thief-stats" }, [
        statRow("XP", `${cur?.xp ?? 0}`, "ACCUMULATED"),
        statRow("PLAYS", String(Object.values(topicStats()).reduce((n, s) => n + s.plays, 0)), "TOTAL HEISTS"),
        statRow("BEST", bestRank(), "RANK"),
        statRow("TROPHIES", `${unlockedAchievements().length}`, "ACHIEVEMENTS"),
      ]),
      // --- profile list ---
      h("div", { class: "thief-roster" }, []),
      h("div", { class: "profile-new" }, [
        h("input", { class: "fill-input profile-input", placeholder: "PHANTOM NAME…", maxlength: "18", spellcheck: "false" }),
        h("button", { class: "sticker-btn accent profile-create" }, ["CREATE"]),
      ]),
      h("div", { class: "thief-hint" }, [
        h("span", { class: "p5-hint-key" }, ["←→"]),
        h("span", {}, ["PORTRAIT"]),
        h("span", { class: "p5-hint-key" }, ["↑↓"]),
        h("span", {}, ["THIEF"]),
        h("span", { class: "p5-hint-key" }, ["↵"]),
        h("span", {}, ["CONFIRM"]),
      ]),
    ]),
  ]);

  function statRow(label: string, value: string, sub: string): HTMLElement {
    const row = h("div", { class: "thief-stat" }, [
      h("span", { class: "thief-stat-tag" }, [label]),
      h("span", { class: "thief-stat-value" }, [value]),
      h("span", { class: "thief-stat-sub" }, [sub]),
    ]);
    return row;
  }

  function bestRank(): string {
    const scores = highScores();
    if (!scores.length) return "—";
    const order = ["S", "A", "B", "C", "D", "F"];
    const best = scores.reduce((m, s) => (order.indexOf(s.rank) < order.indexOf(m) ? s.rank : m), "F");
    return best;
  }

  /* ---------- portrait viewer ---------- */
  const stageImg = el.querySelector<HTMLImageElement>(".thief-portrait")!;
  const stageName = el.querySelector<HTMLElement>(".thief-name")!;
  const arrows = el.querySelectorAll<HTMLElement>(".thief-arrow");
  arrows.forEach((b) => b.addEventListener("mouseenter", () => audio.sfx("hover")));

  const renderPortrait = (animate = true) => {
    const p = PARTY[portraitIdx];
    stageImg.src = p.src;
    stageName.textContent = p.name;
    if (animate && !RM()) {
      gsap.fromTo(stageImg, { x: 60, opacity: 0, rotate: 6 }, { x: 0, opacity: 1, rotate: 0, duration: 0.35, ease: "back.out(1.5)" });
      gsap.fromTo(stageName, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" });
      fx.starBurst(window.innerWidth / 2, window.innerHeight * 0.35, { n: 6 });
    }
  };
  arrows[0].addEventListener("click", () => {
    portraitIdx = (portraitIdx + PARTY.length - 1) % PARTY.length;
    audio.sfx("select");
    renderPortrait();
  });
  arrows[1].addEventListener("click", () => {
    portraitIdx = (portraitIdx + 1) % PARTY.length;
    audio.sfx("select");
    renderPortrait();
  });

  /* ---------- roster ---------- */
  const roster = el.querySelector<HTMLElement>(".thief-roster")!;

  const renderRoster = () => {
    roster.textContent = "";
    if (!profiles().length) {
      roster.appendChild(h("p", { class: "profile-empty" }, ["No phantoms yet. Create one to track XP."]));
    }
    profiles().forEach((p, i) => {
      const art = PARTY[i % PARTY.length];
      const isActive = cur?.id === p.id;
      const row = h("button", { class: `thief-roster-row ${isActive ? "active" : ""}`, "data-i": String(i) }, [
        h("img", { class: "roster-img", src: art.src, alt: "" }),
        h("div", { class: "roster-body" }, [
          h("div", { class: "roster-name" }, [p.name]),
          h("div", { class: "roster-xp" }, [`${p.xp} XP`]),
        ]),
        isActive ? h("div", { class: "profile-badge" }, ["ACTIVE"]) : null,
      ]);
      row.addEventListener("mouseenter", () => audio.sfx("hover"));
      row.addEventListener("click", () => {
        audio.sfx("select");
        switchProfile(p.id);
        toast(`Now playing as ${p.name}`, "info");
        void go({ name: "profiles" }, { instant: true });
      });
      roster.appendChild(row);
      if (!RM()) gsap.fromTo(row, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: 0.05 * i, ease: "back.out(1.5)" });
    });
  };
  renderRoster();

  /* ---------- create ---------- */
  const input = el.querySelector<HTMLInputElement>(".profile-input")!;
  el.querySelector(".profile-create")!.addEventListener("click", () => {
    const name = input.value.trim();
    if (!name) {
      toast("Enter a name first", "error");
      return;
    }
    audio.sfx("unlock");
    createProfile(name);
    input.value = "";
    fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 14 });
    void go({ name: "profiles" }, { instant: true });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (el.querySelector<HTMLElement>(".profile-create")!).click();
  });

  /* ---------- keyboard (P5 controls) ---------- */
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const list = profiles();
    if (e.key === "ArrowLeft") {
      portraitIdx = (portraitIdx + PARTY.length - 1) % PARTY.length;
      renderPortrait();
    } else if (e.key === "ArrowRight") {
      portraitIdx = (portraitIdx + 1) % PARTY.length;
      renderPortrait();
    } else if (e.key === "ArrowDown" && list.length) {
      listIdx = Math.min(list.length - 1, listIdx + 1);
      highlightRoster();
    } else if (e.key === "ArrowUp" && list.length) {
      listIdx = Math.max(0, listIdx - 1);
      highlightRoster();
    } else if (e.key === "Enter" && list.length) {
      const p = list[listIdx];
      if (p) {
        audio.sfx("select");
        switchProfile(p.id);
        void go({ name: "profiles" }, { instant: true });
      }
    }
  };
  function highlightRoster() {
    roster.querySelectorAll<HTMLElement>(".thief-roster-row").forEach((r, i) => {
      r.classList.toggle("kbd", i === listIdx);
      if (i === listIdx) {
        r.scrollIntoView({ block: "nearest" });
        audio.sfx("hover");
      }
    });
  }
  window.addEventListener("keydown", onKey);

  /* ---------- boot ---------- */
  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  root.appendChild(el);

  // first view reveal: portrait slams, stats stagger
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".thief-stage", { scale: 0.6, opacity: 0, rotate: -8 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.5, ease: "back.out(1.3)" });
    gsap.fromTo(".thief-stat", { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.08, duration: 0.35, ease: "back.out(1.5)", delay: 0.2 });
    gsap.fromTo(".profile-new", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.5)", delay: 0.55 });
  }

  return () => {
    window.removeEventListener("keydown", onKey);
  };
});
