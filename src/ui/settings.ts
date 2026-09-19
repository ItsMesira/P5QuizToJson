/* ============ P5 QUIZ — SETTINGS ============ */
import gsap from "gsap";
import { registerScreen, go, app, applyGlobalSettings } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { RM } from "../fx/transitions";
import { THEMES, contrastRatio, isHexColor } from "../core/theme";
import { t, LOCALES, detectLocale } from "../core/i18n";

registerScreen("settings", (root) => {
  const s = app.settings;

  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, desc: string) => {
    const btn = h("button", { class: `toggle-row ${get() ? "on" : ""}`, role: "switch", "aria-checked": String(get()) }, [
      h("div", { class: "toggle-text" }, [
        h("div", { class: "toggle-label" }, [label]),
        h("div", { class: "toggle-desc" }, [desc]),
      ]),
      h("div", { class: "toggle-switch" }, [
        h("div", { class: "toggle-knob" }, []),
        h("span", { class: "toggle-on" }, [t("ON")]),
        h("span", { class: "toggle-off" }, [t("OFF")]),
      ]),
    ]);
    btn.addEventListener("mouseenter", () => audio.sfx("hover"));
    btn.addEventListener("click", () => {
      const v = !get();
      set(v);
      btn.classList.toggle("on", v);
      btn.setAttribute("aria-checked", String(v));
      audio.sfx(v ? "select" : "click");
      applyGlobalSettings();
    });
    return btn;
  };

  const fxLevels: ("subtle" | "theatrical" | "maximum")[] = ["subtle", "theatrical", "maximum"];
  const fxRow = h("div", { class: "toggle-row fx-row" }, [
    h("div", { class: "toggle-text" }, [
      h("div", { class: "toggle-label" }, [t("FX INTENSITY")]),
      h("div", { class: "toggle-desc" }, [t("How much juice you want")]),
    ]),
    h("div", { class: "fx-seg" }, fxLevels.map((lvl) =>
      h("button", { class: `fx-seg-btn ${s.fx === lvl ? "on" : ""}`, "data-lvl": lvl }, [lvl.toUpperCase()]),
    )),
  ]);
  fxRow.querySelectorAll<HTMLButtonElement>(".fx-seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      fxRow.querySelectorAll(".fx-seg-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      s.fx = b.getAttribute("data-lvl") as "subtle" | "theatrical" | "maximum";
      audio.sfx("select");
      applyGlobalSettings();
    });
  });

  const volRow = h("div", { class: "toggle-row" }, [
    h("div", { class: "toggle-text" }, [
      h("div", { class: "toggle-label" }, [t("VOLUME")]),
      h("div", { class: "toggle-desc" }, [t("Master output")]),
    ]),
    h("input", { class: "vol-slider", type: "range", min: "0", max: "100", value: String(Math.round(s.volume * 100)), "aria-label": t("Volume") }),
  ]);
  volRow.querySelector<HTMLInputElement>("input")!.addEventListener("input", (e) => {
    s.volume = Number((e.target as HTMLInputElement).value) / 100;
    applyGlobalSettings();
  });

  /* ---- language picker ---- */
  const langGrid = h("div", { class: "seg-row lang-row" }, LOCALES.map((l) => {
    const b = h("button", { class: `seg-btn ${(s.lang || detectLocale()) === l.id ? "on" : ""}`, "data-lang": l.id }, [l.name]);
    b.addEventListener("mouseenter", () => audio.sfx("hover"));
    b.addEventListener("click", () => {
      s.lang = l.id;
      audio.sfx("select");
      applyGlobalSettings();
      void go({ name: "settings" }, { instant: true });
    });
    return b;
  }));

  /* ---- theme picker ---- */
  const swatchRow = (colors: string[]) =>
    h("div", { class: "theme-swatches" }, colors.map((c) => {
      const sw = h("span", { class: "theme-sw" });
      sw.style.background = isHexColor(c) ? c : "#000";
      return sw;
    }));

  const themeGrid = h("div", { class: "theme-grid" }, THEMES.map((def) => {
    const card = h("button", { class: `theme-card ${s.theme === def.id ? "on" : ""}`, "data-theme-id": def.id }, [
      swatchRow(def.swatches.length ? def.swatches : [s.customTheme.accent, s.customTheme.ink, s.customTheme.paper]),
      h("div", { class: "theme-name" }, [def.name]),
      h("div", { class: "theme-tag" }, [t(def.tag)]),
    ]);
    card.addEventListener("mouseenter", () => audio.sfx("hover"));
    card.addEventListener("click", () => {
      s.theme = def.id;
      audio.sfx("select");
      applyGlobalSettings();
      refreshThemeCards();
      updateContrast();
    });
    return card;
  }));

  const contrastNote = h("div", { class: "theme-contrast" }, []);

  const customBox = h("div", { class: "theme-custom" }, [
    ...(["accent", "ink", "paper"] as const).map((key) => {
      const hex = h("span", { class: "theme-hex" }, [s.customTheme[key]]);
      const input = h("input", { type: "color", value: s.customTheme[key], "aria-label": key === "accent" ? t("Accent color") : key === "ink" ? t("Background color") : t("Text color") });
      const row = h("div", { class: "theme-color-row" }, [
        h("span", { class: "field-label" }, [key === "accent" ? t("ACCENT") : key === "ink" ? t("BACKGROUND") : t("TEXT")]),
        input,
        hex,
      ]);
      input.addEventListener("input", () => {
        s.customTheme[key] = (input as HTMLInputElement).value;
        hex.textContent = (input as HTMLInputElement).value;
        s.theme = "custom";
        applyGlobalSettings();
        refreshThemeCards();
        updateContrast();
      });
      return row;
    }),
    contrastNote,
  ]);

  const el = h("div", { class: "screen settings-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("SETTINGS")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "settings-body" }, [
      h("h3", { class: "rs-title" }, [t("— LANGUAGE —")]),
      langGrid,
      h("h3", { class: "rs-title" }, [t("— THEME —")]),
      themeGrid,
      customBox,
      h("h3", { class: "rs-title" }, [t("— STYLE —")]),
      fxRow,
      toggle(t("CRT SCANLINES"), () => s.crt, (v) => (s.crt = v), t("Old-school monitor texture")),
      toggle(t("PARTICLES"), () => s.particles, (v) => (s.particles = v), t("Stars, rain and bursts")),
      toggle(t("SCREEN SHAKE"), () => s.shake, (v) => (s.shake = v), t("Impact feedback")),
      toggle(t("SLOW-MO HITS"), () => s.slowmo, (v) => (s.slowmo = v), t("Hit-stop on correct answers")),
      toggle(t("REDUCED MOTION"), () => s.reducedMotion, (v) => (s.reducedMotion = v), t("Calmer transitions")),
      h("h3", { class: "rs-title" }, [t("— AUDIO —")]),
      volRow,
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("BGM SOURCE")]),
        h("div", { class: "seg-row" }, (["authentic", "synth"] as const).map((mode) => {
          const b = h("button", { class: `seg-btn ${s.bgm === mode ? "on" : ""}`, "data-mode": mode }, [mode === "authentic" ? t("AUTHENTIC") : t("SYNTH")]);
          b.addEventListener("click", () => {
            s.bgm = mode;
            audio.sfx("select");
            applyGlobalSettings();
            b.parentElement?.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("on", x === b));
          });
          return b;
        })),
      ]),
      toggle(t("MUSIC"), () => s.music, (v) => (s.music = v), t("Background music on/off")),
      toggle(t("SOUND FX"), () => s.sfx, (v) => (s.sfx = v), t("Clicks, chimes, slashes")),
      h("h3", { class: "rs-title" }, [t("— PLAY —")]),
      toggle(t("ALWAYS RANDOMIZE"), () => s.alwaysShuffle, (v) => (s.alwaysShuffle = v), t("Shuffle questions and choices on every attempt")),
      toggle(t("AUTO-ADVANCE"), () => s.autoAdvance, (v) => (s.autoAdvance = v), t("Skip the NEXT button")),
      toggle(t("FULLSCREEN"), () => s.fullscreen, (v) => (s.fullscreen = v), t("Fill the whole screen")),
      h("div", { class: "settings-actions" }, [
        h("button", { class: "sticker-btn accent reset-btn" }, [t("RESET DEFAULTS")]),
      ]),
    ]),
  ]);

  function refreshThemeCards() {
    el.querySelectorAll<HTMLElement>(".theme-card").forEach((card) => {
      card.classList.toggle("on", card.getAttribute("data-theme-id") === s.theme);
    });
    customBox.classList.toggle("show", s.theme === "custom");
    const customCard = el.querySelector<HTMLElement>('.theme-card[data-theme-id="custom"] .theme-swatches');
    if (customCard) {
      customCard.textContent = "";
      [s.customTheme.accent, s.customTheme.ink, s.customTheme.paper].forEach((c) => {
        const sw = h("span", { class: "theme-sw" });
        sw.style.background = isHexColor(c) ? c : "#000";
        customCard.appendChild(sw);
      });
    }
  }

  function updateContrast() {
    const ratio = contrastRatio(s.customTheme.paper, s.customTheme.ink);
    const ok = ratio >= 4.5;
    contrastNote.textContent = "";
    contrastNote.classList.toggle("warn", !ok);
    contrastNote.append(
      `TEXT ↔ BACKGROUND: ${ratio.toFixed(1)}:1 — `,
      h("span", { class: ok ? "ok" : "bad" }, [ok ? "AA ✓ readable" : "low contrast ✕"]),
    );
  }
  refreshThemeCards();
  updateContrast();

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));
  el.querySelector(".reset-btn")!.addEventListener("click", () => {
    audio.sfx("paper");
    Object.assign(app.settings, {
      fx: "maximum", particles: true, shake: true, slowmo: true, crt: false,
      music: true, bgm: "authentic", sfx: true, volume: 0.7, autoAdvance: false, fullscreen: false, reducedMotion: false, alwaysShuffle: true,
      theme: "calling-card", customTheme: { accent: "#e60012", ink: "#0c0c0e", paper: "#f6f4f0" }, lang: "",
    });
    applyGlobalSettings();
    toast(t("Settings reset"), "info");
    void go({ name: "settings" }, { instant: true });
  });

  root.appendChild(el);
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".toggle-row, .rs-title", { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.05, duration: 0.35, ease: "back.out(1.5)" });
  }
  return () => undefined;
});
