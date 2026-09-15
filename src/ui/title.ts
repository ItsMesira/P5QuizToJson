/* ============ P5 QUIZ — TITLE (P5 Best menu remake) ============ */
import gsap from "gsap";
import { registerScreen, go, applyGlobalSettings, app } from "./screens";
import { h } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { ransomize } from "../fx/ransom";
import { loadProgress } from "../core/store";
import { cloud } from "../core/api";
import { t } from "../core/i18n";

interface MenuEntry {
  label: string;
  route: "load" | "library" | "prompts" | "settings" | "profiles" | "entry" | "dashboard";
  size: string;   // clamp() font size for the ransom letters
  icon: string;
  tilt: number;   // deg — each button sits at its own torn-paper angle
  target: () => void;
}

const ITEMS: MenuEntry[] = [
  { label: "BEGIN HEIST",    route: "load",      size: "clamp(30px,4.4vw,58px)", icon: "★", tilt: -1.2, target: () => void go({ name: "load" }) },
  { label: "CLASSROOM",      route: "entry",     size: "clamp(26px,3.6vw,47px)", icon: "🎓", tilt: 0.8, target: () => void go(cloud.session ? { name: "dashboard" } : { name: "entry" }) },
  { label: "QUIZ LIBRARY",   route: "library",   size: "clamp(26px,3.6vw,47px)", icon: "🗂", tilt: -0.5, target: () => void go({ name: "library" }) },
  { label: "MASTER PROMPTS", route: "prompts",   size: "clamp(22px,3.0vw,39px)", icon: "⚙", tilt: 1.1, target: () => void go({ name: "prompts" }) },
  { label: "SETTINGS",       route: "settings",  size: "clamp(28px,3.9vw,51px)", icon: "◷", tilt: -0.8, target: () => void go({ name: "settings" }) },
  { label: "PROFILES",       route: "profiles",  size: "clamp(27px,3.8vw,49px)", icon: "🃏", tilt: 0.6, target: () => void go({ name: "profiles" }) },
];

registerScreen("title", (root) => {
  applyGlobalSettings();

  let active = -1;
  const itemEls: HTMLElement[] = [];

  const activate = (idx: number, byPointer = false) => {
    if (idx === active && itemEls[idx]?.classList.contains("sel")) return;
    active = idx;
    itemEls.forEach((el, i) => {
      const sel = i === idx;
      el.classList.toggle("sel", sel);
      const dist = Math.abs(i - idx);
      el.style.opacity = String(Math.max(0.62, 1 - dist * 0.14));
      el.querySelector<HTMLElement>(".menu-key")!.classList.toggle("on", sel);
      el.querySelector<HTMLElement>(".menu-icon")!.classList.toggle("on", sel);
    });
    if (!byPointer) audio.sfx("select");
    else audio.sfx("hover");
  };

  const navigate = (idx: number) => {
    activate(idx);
    audio.sfx("paper");
    const el = itemEls[idx];
    const rect = el.getBoundingClientRect();
    fx.ink(rect.left + rect.width / 2, rect.top + rect.height / 2, "#e60012");
    fx.slashes(3);
    ITEMS[idx].target();
  };

  const menuItem = (item: MenuEntry, i: number): HTMLElement => {
    const btn = h("button", { class: "menu-item", "data-target": item.route, style: `--tilt:${item.tilt}deg` }, [
      h("span", { class: "menu-key" }, [String(i + 1)]),
      h("span", { class: "menu-icon" }, [item.icon]),
      h("span", { class: "menu-underline", "aria-hidden": "true" }),
      h("span", { class: "menu-ransom" }),
      h("span", { class: "cursor-mark" }, ["◀"]),
    ]);
    ransomize(btn.querySelector<HTMLElement>(".menu-ransom")!, t(item.label), { size: item.size });
    btn.addEventListener("mouseenter", () => activate(i, true));
    btn.addEventListener("click", () => navigate(i));
    btn.addEventListener("focus", () => activate(i, true));
    return btn;
  };

  const menu = h("nav", { id: "menu", "aria-label": t("Sections") }, ITEMS.map((item, i) => {
    const el = menuItem(item, i);
    itemEls.push(el);
    return el;
  }));

  const el = h("div", { class: "screen title-screen" }, [
    // HUD top — two rotated tags
    h("div", { id: "hud-top" }, [
      h("div", { class: "hud-tag" }, [t("QUIZ // P5 QUIZ")]),
      h("div", { class: "hud-tag alt" }, [t("★ STEAL THE ANSWERS")]),
    ]),
    h("div", { id: "intro-eyebrow" }, [t("— THE PHANTOM THIEVES OF TRIVIA PRESENT —")]),
    h("h1", { id: "big-name" }, [
      h("span", { class: "name-ransom" }),
      h("span", { class: "name-ransom" }),
    ]),
    h("p", { id: "tagline" }, [
      t("Load any quiz.json, or let an AI write one for you. "),
      h("strong", {}, [t("Steal the answers. Take your time.")]),
    ]),
    menu,
    h("div", { id: "hud-bottom" }, [
      h("span", {}, [h("span", { class: "key" }, ["↑↓"]), t("SELECT")]),
      h("span", {}, [h("span", { class: "key" }, ["ENTER"]), t("CONFIRM")]),
      h("span", {}, [h("span", { class: "key" }, ["1-6"]), t("JUMP")]),
      h("span", { id: "clock", style: "margin-left:auto;opacity:.8" }, ["--:--"]),
    ]),
    // BGM panel
    h("div", { class: "bgm-panel" }, [
      h("button", { class: `bgm-toggle ${app.settings.music ? "on" : ""}`, "aria-label": t("Toggle music") }, [t("♫ MUSIC")]),
      h("div", { class: "bgm-slider-wrap" }, [
        h("input", { class: "vol-slider bgm-slider", type: "range", min: "0", max: "100", value: String(Math.round(app.settings.volume * 100)), "aria-label": t("Music volume") }),
        h("span", { class: "bgm-pct" }, [`${Math.round(app.settings.volume * 100)}%`]),
      ]),
    ]),
  ]);

  // giant ransom name: "P5" / "QUIZ"
  const nameSpans = el.querySelectorAll<HTMLElement>(".name-ransom");
  ransomize(nameSpans[0], "P5", { size: "clamp(52px,9.5vw,138px)" });
  ransomize(nameSpans[1], "QUIZ", { size: "clamp(44px,8vw,116px)" });

  // clicking the big name goes home / plays a sound
  const bigName = el.querySelector<HTMLElement>("#big-name")!;
  bigName.addEventListener("click", () => {
    audio.sfx("select");
    fx.starBurst(window.innerWidth / 2, window.innerHeight / 3, { n: 10 });
  });

  // resume banner (functional chip, kept subtle)
  const progress = loadProgress();
  if (progress && progress.index > 0) {
    const resume = h("button", { class: "resume-banner" }, [
      h("span", { class: "resume-icon" }, ["▶"]),
      h("span", {}, [t("RESUME LAST HEIST")]),
    ]);
    resume.addEventListener("click", () => {
      audio.sfx("select");
      void go({ name: "load" });
    });
    el.appendChild(resume);
  }

  root.appendChild(el);

  /* ---------- BGM panel wiring ---------- */
  const bgmToggle = el.querySelector<HTMLElement>(".bgm-toggle")!;
  const bgmSlider = el.querySelector<HTMLInputElement>(".bgm-slider")!;
  bgmToggle.addEventListener("click", () => {
    app.settings.music = !app.settings.music;
    bgmToggle.classList.toggle("on", app.settings.music);
    applyGlobalSettings();
  });
  bgmSlider.addEventListener("input", () => {
    app.settings.volume = Number(bgmSlider.value) / 100;
    el.querySelector<HTMLElement>(".bgm-pct")!.textContent = `${bgmSlider.value}%`;
    applyGlobalSettings();
  });

  /* ---------- clock ---------- */
  const clock = el.querySelector<HTMLElement>("#clock")!;
  const tickClock = () => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  tickClock();
  const clockId = window.setInterval(tickClock, 1000);

  /* ---------- keyboard (P5 Best controls) ---------- */
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activate(active < 0 ? 0 : Math.min(ITEMS.length - 1, active + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activate(active < 0 ? 0 : Math.max(0, active - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0) navigate(active);
    } else if (e.key === "Escape") {
      activate(-1);
    } else if (e.key >= "1" && e.key <= String(ITEMS.length)) {
      navigate(Number(e.key) - 1);
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---------- entrance choreography (P5 Best timings) ---------- */
  if (!RM()) {
    gsap.fromTo("#hud-top .hud-tag", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: "power3.out" });
    gsap.fromTo("#intro-eyebrow", { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, delay: 0.2, ease: "power2.out" });
    gsap.fromTo(".name-ransom .ch", { y: 40, opacity: 0, rotate: -10 }, { y: 0, opacity: 1, rotate: 0, duration: 0.5, stagger: 0.03, delay: 0.3, ease: "back.out(1.4)" });
    gsap.fromTo("#tagline", { x: -40, opacity: 0, rotate: 4 }, { x: 0, opacity: 1, rotate: -1, duration: 0.45, delay: 0.6, ease: "power3.out" });
    gsap.fromTo("#hud-bottom", { opacity: 0 }, { opacity: 1, duration: 0.5, delay: 1.0 });
    // menu items slide in from left (P5 Best menuIn)
    itemEls.forEach((item, i) => {
      gsap.fromTo(item, { x: -60, opacity: 0 }, { x: 0, opacity: 0.62, duration: 0.55, delay: 0.65 + i * 0.1, ease: "back.out(1.2)", onComplete: () => gsap.set(item, { clearProps: "transform" }) });
    });
    window.setTimeout(() => activate(0, true), 1400);
  } else {
    activate(0, true);
  }

  return () => {
    window.removeEventListener("keydown", onKey);
    clearInterval(clockId);
  };
});
