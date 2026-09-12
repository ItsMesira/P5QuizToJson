/* ============ P5 QUIZ — SETTINGS ============ */
import gsap from "gsap";
import { registerScreen, go, app, applyGlobalSettings } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { RM } from "../fx/transitions";

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
        h("span", { class: "toggle-on" }, ["ON"]),
        h("span", { class: "toggle-off" }, ["OFF"]),
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
      h("div", { class: "toggle-label" }, ["FX INTENSITY"]),
      h("div", { class: "toggle-desc" }, ["How much Persona juice you want"]),
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
      h("div", { class: "toggle-label" }, ["VOLUME"]),
      h("div", { class: "toggle-desc" }, ["Master output"]),
    ]),
    h("input", { class: "vol-slider", type: "range", min: "0", max: "100", value: String(Math.round(s.volume * 100)), "aria-label": "Volume" }),
  ]);
  volRow.querySelector<HTMLInputElement>("input")!.addEventListener("input", (e) => {
    s.volume = Number((e.target as HTMLInputElement).value) / 100;
    applyGlobalSettings();
  });

  const el = h("div", { class: "screen settings-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": "Back" }, ["◀"]),
      h("h2", { class: "screen-title" }, ["SETTINGS"]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "settings-body" }, [
      h("h3", { class: "rs-title" }, ["— STYLE —"]),
      fxRow,
      toggle("CRT SCANLINES", () => s.crt, (v) => (s.crt = v), "Old-school monitor texture"),
      toggle("PARTICLES", () => s.particles, (v) => (s.particles = v), "Stars, rain and bursts"),
      toggle("SCREEN SHAKE", () => s.shake, (v) => (s.shake = v), "Impact feedback"),
      toggle("SLOW-MO HITS", () => s.slowmo, (v) => (s.slowmo = v), "Hit-stop on correct answers"),
      toggle("REDUCED MOTION", () => s.reducedMotion, (v) => (s.reducedMotion = v), "Calmer transitions"),
      h("h3", { class: "rs-title" }, ["— AUDIO —"]),
      volRow,
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, ["BGM SOURCE"]),
        h("div", { class: "seg-row" }, (["authentic", "synth"] as const).map((mode) => {
          const b = h("button", { class: `seg-btn ${s.bgm === mode ? "on" : ""}`, "data-mode": mode }, [mode === "authentic" ? "AUTHENTIC" : "SYNTH"]);
          b.addEventListener("click", () => {
            s.bgm = mode;
            audio.sfx("select");
            applyGlobalSettings();
            b.parentElement?.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("on", x === b));
          });
          return b;
        })),
      ]),
      toggle("MUSIC", () => s.music, (v) => (s.music = v), "Background music on/off"),
      toggle("SOUND FX", () => s.sfx, (v) => (s.sfx = v), "Clicks, chimes, slashes"),
      h("h3", { class: "rs-title" }, ["— PLAY —"]),
      toggle("AUTO-ADVANCE", () => s.autoAdvance, (v) => (s.autoAdvance = v), "Skip the NEXT button"),
      toggle("FULLSCREEN", () => s.fullscreen, (v) => (s.fullscreen = v), "Fill the whole screen"),
      h("div", { class: "settings-actions" }, [
        h("button", { class: "sticker-btn accent reset-btn" }, ["RESET DEFAULTS"]),
      ]),
    ]),
  ]);

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));
  el.querySelector(".reset-btn")!.addEventListener("click", () => {
    audio.sfx("paper");
    Object.assign(app.settings, {
      fx: "maximum", particles: true, shake: true, slowmo: true, crt: false,
      music: true, bgm: "authentic", sfx: true, volume: 0.7, autoAdvance: false, fullscreen: false, reducedMotion: false,
    });
    applyGlobalSettings();
    toast("Settings reset", "info");
    void go({ name: "settings" }, { instant: true });
  });

  root.appendChild(el);
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".toggle-row, .rs-title", { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.05, duration: 0.35, ease: "back.out(1.5)" });
  }
  return () => undefined;
});
