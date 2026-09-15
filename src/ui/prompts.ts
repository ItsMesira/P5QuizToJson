/* ============ P5 QUIZ — MASTER PROMPTS (builder + presets + history) ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { t } from "../core/i18n";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import {
  BUILTIN_PRESETS, FIXER_PROMPT, type Preset, type PromptFields, type Audience, type DifficultyMix, type Tone, type Blooms,
  defaultFields, buildPrompt, buildFollowUpPrompt, buildMissPrompt, mergeFields,
  estimatePlayTime, estimateXp, vagueTopics, DIFF_SPLIT,
} from "../core/prompts";
import {
  addPromptHistory, promptHistory, deletePromptHistory,
  favoritePromptIds, toggleFavoritePrompt,
  customPresets, saveCustomPreset, deleteCustomPreset,
  topicStats,
} from "../core/store";
import { validateQuiz } from "../core/validator";
import { saveQuiz } from "../core/store";
import type { QuestionType, QuizMode } from "../core/types";

/* builder prefill bridge (results REINFORCE, ?prompt= links) */
export const builderPrefill: { fields?: Partial<PromptFields>; tagline?: string } = {};

const ALL_TYPES: { id: QuestionType; label: string }[] = [
  { id: "multiple", label: "CHOICE" },
  { id: "boolean", label: "TRUE/FALSE" },
  { id: "multi", label: "MULTI-PICK" },
  { id: "fill", label: "FILL-IN" },
  { id: "order", label: "ORDER" },
  { id: "match", label: "MATCH" },
  { id: "numeric", label: "NUMERIC" },
  { id: "open", label: "OPEN" },
  { id: "hotspot", label: "HOTSPOT" },
];
const MODES: QuizMode[] = ["standard", "practice", "survival", "rapid", "endless"];
const DIFFS: DifficultyMix[] = ["chill", "balanced", "brutal"];
const TONES: Tone[] = ["fun", "serious", "dramatic"];
const BLOOMS: Blooms[] = ["mix", "recall", "apply", "analyze"];
const AUDIENCES: Audience[] = ["kids", "teens", "adults", "experts"];

registerScreen("prompts", (root) => {
  const fields: PromptFields = { ...defaultFields(), ...builderPrefill.fields };
  builderPrefill.fields = undefined;
  let tab: "builder" | "presets" | "history" = "builder";
  let mergeArmed = false;
  let mergeTargets: string[] = [];
  let search = "";
  let favOnly = false;

  const el = h("div", { class: "screen prompts-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("MASTER PROMPTS")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("nav", { class: "prompts-tabs" }, [
      tabBtn("builder", t("⚙ PROMPT BUILDER")),
      tabBtn("presets", t("★ PRESETS")),
      tabBtn("history", t("◷ HISTORY")),
    ]),
    h("div", { class: "prompts-builder" }, []),
    h("div", { class: "prompts-presets hidden" }, []),
    h("div", { class: "prompts-history hidden" }, []),
  ]);

  function tabBtn(id: "builder" | "presets" | "history", label: string): HTMLElement {
    const b = h("button", { class: `prompts-tab ${id === tab ? "on" : ""}`, "data-tab": id }, [label]);
    b.addEventListener("mouseenter", () => audio.sfx("hover"));
    b.addEventListener("click", () => {
      audio.sfx("select");
      setTab(id);
    });
    return b;
  }

  function setTab(id: "builder" | "presets" | "history") {
    tab = id;
    el.querySelectorAll(".prompts-tab").forEach((t) =>
      t.classList.toggle("on", t.getAttribute("data-tab") === id),
    );
    el.querySelector(".prompts-builder")!.classList.toggle("hidden", id !== "builder");
    el.querySelector(".prompts-presets")!.classList.toggle("hidden", id !== "presets");
    el.querySelector(".prompts-history")!.classList.toggle("hidden", id !== "history");
    if (id === "presets") renderPresets();
    if (id === "history") renderHistory();
    if (id === "builder") renderBuilder();
  }

  /* ---------------- shared copy helper ---------------- */
  async function copyText(text: string, btn: HTMLElement, title: string) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    addPromptHistory(title, text);
    audio.sfx("stamp");
    const rect = btn.getBoundingClientRect();
    fx.starBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, { n: 8, gold: true });
    const orig = btn.textContent;
    btn.textContent = t("✓ COPIED");
    gsap.fromTo(btn, { scale: 1 }, { scale: 1.15, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" });
    window.setTimeout(() => (btn.textContent = orig), 1400);
    toast(t("Prompt copied — paste it into your AI"), "info");
  }

  /* ================= BUILDER ================= */
  const builderBox = el.querySelector<HTMLElement>(".prompts-builder")!;

  function renderBuilder() {
    builderBox.textContent = "";

    /* ---- field helpers ---- */
    const seg = <T extends string>(values: T[], current: T, labels: Record<T, string>, onPick: (v: T) => void): HTMLElement => {
      const wrap = h("div", { class: "seg-row" }, values.map((v) => {
        const b = h("button", { class: `seg-btn ${v === current ? "on" : ""}` }, [labels[v]]);
        b.addEventListener("click", () => {
          audio.sfx("select");
          onPick(v);
          wrap.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("on", x === b));
          segRefs.refresh();
        });
        return b;
      }));
      return wrap;
    };

    const toggle = (label: string, desc: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const row = h("button", { class: `mini-toggle ${get() ? "on" : ""}`, role: "switch", "aria-checked": String(get()) }, [
        h("div", {}, [
          h("div", { class: "mini-toggle-label" }, [label]),
          h("div", { class: "mini-toggle-desc" }, [desc]),
        ]),
        h("div", { class: "mini-toggle-switch" }, [h("span", {}, []), h("span", { class: "mini-knob" }, [])]),
      ]);
      row.addEventListener("click", () => {
        const next = !get();
        set(next);
        row.classList.toggle("on", next);
        row.setAttribute("aria-checked", String(next));
        audio.sfx("select");
        segRefs.refresh();
      });
      return row;
    };

    const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void, fmt?: (v: number) => string): HTMLElement => {
      const val = h("span", { class: "slider-val" }, [fmt ? fmt(get()) : String(get())]);
      const input = h("input", { class: "vol-slider wide", type: "range", min: String(min), max: String(max), value: String(get()) });
      input.addEventListener("input", () => {
        set(Number((input as HTMLInputElement).value));
        val.textContent = fmt ? fmt(Number((input as HTMLInputElement).value)) : (input as HTMLInputElement).value;
        segRefs.refresh();
      });
      return h("div", { class: "slider-row" }, [
        h("span", { class: "slider-label" }, [label]),
        input,
        val,
      ]);
    };

    const textField = (label: string, get: () => string, set: (v: string) => void, placeholder = ""): HTMLElement => {
      const input = h("input", { class: "fill-input builder-input", value: get(), placeholder, spellcheck: "false" });
      input.addEventListener("input", () => {
        set((input as HTMLInputElement).value);
        segRefs.refresh();
      });
      return h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [label]),
        input,
      ]);
    };

    const segRefs = { refresh: () => refreshPreview() };

    /* ---- left column: form ---- */
    const form = h("div", { class: "builder-form" }, [
      h("h3", { class: "builder-heading" }, [t("— WHAT ARE YOU STUDYING —")]),
      textField(t("TOPIC"), () => fields.topic, (v) => (fields.topic = v), t("e.g. French Revolution causes")),
      h("div", { class: "field-row-2" }, [
        textField(t("LANGUAGE"), () => fields.language, (v) => (fields.language = v), t("English")),
        textField(t("QUIZ TITLE"), () => fields.title, (v) => (fields.title = v), t("auto — optional")),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("AUDIENCE")]),
        seg(AUDIENCES as Audience[], fields.audience, { kids: t("KIDS"), teens: t("TEENS"), adults: t("ADULTS"), experts: t("EXPERTS") }, (v) => (fields.audience = v)),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("TONES")]),
        seg(TONES as Tone[], fields.tone, { fun: t("FUN"), serious: t("SERIOUS"), dramatic: t("DRAMATIC") }, (v) => (fields.tone = v)),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("THINKING LEVEL")]),
        seg(BLOOMS as Blooms[], fields.blooms, { mix: t("MIX"), recall: t("RECALL"), apply: t("APPLY"), analyze: t("ANALYZE") }, (v) => (fields.blooms = v)),
      ]),
      slider(t("QUESTIONS"), 5, 50, () => fields.count, (v) => (fields.count = v)),
      slider(t("SECTIONS"), 1, 6, () => fields.sections, (v) => (fields.sections = v)),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("DIFFICULTY")]),
        seg(DIFFS as DifficultyMix[], fields.difficulty, { chill: t("CHILL"), balanced: t("BALANCED"), brutal: t("BRUTAL") }, (v) => (fields.difficulty = v)),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("GAME MODE")]),
        seg(MODES as QuizMode[], fields.mode, { standard: t("STANDARD"), practice: t("PRACTICE"), survival: t("SURVIVAL"), rapid: t("RAPID"), endless: t("ENDLESS") }, (v) => (fields.mode = v)),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("QUESTION TYPES")]),
        h("div", { class: "type-grid" }, ALL_TYPES.map((ty) => {
          const b = h("button", { class: `type-chip ${fields.types.includes(ty.id) ? "on" : ""}` }, [t(ty.label)]);
          b.addEventListener("click", () => {
            audio.sfx(fields.types.includes(ty.id) ? "click" : "stamp");
            if (fields.types.includes(ty.id)) fields.types = fields.types.filter((x) => x !== ty.id);
            else fields.types = [...fields.types, ty.id];
            if (!fields.types.length) fields.types = ["multiple"];
            b.classList.toggle("on", fields.types.includes(ty.id));
            segRefs.refresh();
          });
          return b;
        })),
      ]),
      h("div", { class: "field-row-2" }, [
        textField(t("TARGET LANGUAGE"), () => fields.targetLang ?? "", (v) => (fields.targetLang = v || undefined), t("optional")),
        textField(t("NATIVE LANGUAGE"), () => fields.nativeLang ?? "", (v) => (fields.nativeLang = v || undefined), t("optional")),
      ]),
      h("div", { class: "field-col" }, [
        h("span", { class: "field-label" }, [t("EXTRA NOTES")]),
        h("textarea", { class: "open-area builder-notes", placeholder: t("Avoid questions about X… only cover 2010–2020…") }, [fields.notes]),
      ]),
      h("div", { class: "builder-toggles" }, [
        toggle(t("EXPLANATIONS"), t("AI writes a why for every answer"), () => fields.explanations, (v) => (fields.explanations = v)),
        toggle(t("HINTS"), t("Every question gets a clue"), () => fields.hints, (v) => (fields.hints = v)),
        toggle(t("NEGATIVE MARKING"), t("Wrong answers cost points"), () => fields.negativeMarking, (v) => (fields.negativeMarking = v)),
        toggle(t("TEACHER ANSWER KEY"), t("AI also outputs a plain answer list"), () => fields.answerKey, (v) => (fields.answerKey = v)),
        toggle(t("EMBED EXAMPLE"), t("Show the AI a sample question to mimic"), () => fields.exampleEmbed, (v) => (fields.exampleEmbed = v)),
        toggle(t("SPACED SESSIONS"), t("Generate Session 1→N difficulty tiers"), () => fields.spaced, (v) => (fields.spaced = v)),
      ]),
      h("div", { class: "builder-dice-row" }, [
        h("button", { class: "sticker-btn dice-btn" }, [t("🎲 SURPRISE ME")]),
        h("button", { class: "sticker-btn clear-btn" }, [t("↺ RESET")]),
      ]),
    ]);

    /* ---- right column: preview + stats + actions ---- */
    const preview = h("pre", { class: "pm-text builder-preview" }, []);
    const charCount = h("span", { class: "stat-chip" }, []);
    const timeChip = h("span", { class: "stat-chip gold" }, []);
    const xpChip = h("span", { class: "stat-chip red" }, []);
    const warn = h("div", { class: "builder-warn hidden" }, []);
    const diffViz = h("div", { class: "diff-viz" }, []);
    const typeRadar = h("div", { class: "type-radar" }, []);

    const copyBtn = h("button", { class: "sticker-btn accent big" }, [t("⧉ COPY PROMPT")]);
    const followBtn = h("button", { class: "sticker-btn" }, [t("⧉ COPY FOLLOW-UP")]);
    const txtBtn = h("button", { class: "sticker-btn" }, [t("⤓ .TXT")]);
    const savePresetBtn = h("button", { class: "sticker-btn" }, [t("☆ SAVE AS PRESET")]);
    const batchRow = h("div", { class: "batch-row" }, [
      h("span", { class: "field-label" }, [t("BATCH VARIANTS:")]),
      h("button", { class: "lib-btn", "data-diff": "chill" }, [t("CHILL")]),
      h("button", { class: "lib-btn", "data-diff": "balanced" }, [t("BALANCED")]),
      h("button", { class: "lib-btn", "data-diff": "brutal" }, [t("BRUTAL")]),
    ]);

    const pasteArea = h("div", { class: "builder-paste" }, [
      h("h4", { class: "builder-heading" }, [t("— PASTE THE AI'S OUTPUT HERE —")]),
      h("textarea", { class: "paste-area", placeholder: '{ "title": "…", "sections": [ … ] }' }, []),
      h("div", { class: "builder-paste-errors hidden" }, []),
      h("div", { class: "paste-actions" }, [
        h("button", { class: "sticker-btn accent validate-btn" }, [t("✓ VALIDATE")]),
        h("button", { class: "sticker-btn play-btn hidden" }, [t("▶ PLAY NOW")]),
        h("button", { class: "sticker-btn save-lib-btn hidden" }, [t("⤓ SAVE TO LIBRARY")]),
      ]),
    ]);

    const right = h("div", { class: "builder-right" }, [
      h("h3", { class: "builder-heading" }, [t("— LIVE PREVIEW —")]),
      warn,
      preview,
      h("div", { class: "builder-stats" }, [
        charCount, timeChip, xpChip,
      ]),
      h("div", { class: "builder-viz" }, [
        h("div", { class: "viz-col" }, [
          h("span", { class: "field-label" }, [t("DIFFICULTY MIX")]),
          diffViz,
        ]),
        h("div", { class: "viz-col" }, [
          h("span", { class: "field-label" }, [t("TYPE PLAN")]),
          typeRadar,
        ]),
      ]),
      h("div", { class: "builder-actions" }, [copyBtn, followBtn, txtBtn, savePresetBtn]),
      batchRow,
      pasteArea,
    ]);

    const refreshPreview = () => {
      const text = buildPrompt(fields);
      preview.textContent = text;
      charCount.textContent = `${text.length} CHARS`;
      const mins = estimatePlayTime(fields);
      timeChip.textContent = `~${mins} MIN`;
      xpChip.textContent = `+${estimateXp(fields)} XP`;
      const vague = vagueTopics(fields.topic);
      if (vague) {
        warn.textContent = `⚠ ${vague}`;
        warn.classList.remove("hidden");
      } else {
        warn.classList.add("hidden");
      }
      // diff viz
      diffViz.textContent = "";
      const [e, m, hh] = DIFF_SPLIT[fields.difficulty];
      [
        ["EASY", e, "var(--green)"],
        ["MED", m, "var(--gold)"],
        ["HARD", hh, "var(--red)"],
      ].forEach(([label, pct, color]) => {
        const row = h("div", { class: "diff-row" }, [
          h("span", { class: "diff-label" }, [String(label)]),
          h("div", { class: "diff-track" }, [
            h("div", { class: "diff-fill", style: `width:${pct}%;background:${color}` }, []),
          ]),
          h("span", { class: "diff-pct" }, [`${pct}%`]),
        ]);
        diffViz.appendChild(row);
      });
      // type radar chips
      typeRadar.textContent = "";
      const perType = Math.max(1, Math.floor(fields.count / Math.max(1, fields.types.length)));
      fields.types.forEach((t) => {
        const chip = h("span", { class: `radar-chip ${t}` }, [
          `${ALL_TYPES.find((x) => x.id === t)?.label ?? t.toUpperCase()} ×${perType}`,
        ]);
        typeRadar.appendChild(chip);
      });
    };

    /* ---- wire actions ---- */
    copyBtn.addEventListener("click", () => void copyText(buildPrompt(fields), copyBtn, fields.title || fields.topic || "Quiz prompt"));
    followBtn.addEventListener("click", () => void copyText(buildFollowUpPrompt(fields), followBtn, `${fields.topic || "Quiz"} follow-up`));
    txtBtn.addEventListener("click", () => {
      audio.sfx("paper");
      const blob = new Blob([buildPrompt(fields)], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(fields.topic || "quiz").replace(/\s+/g, "-").toLowerCase()}-prompt.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    savePresetBtn.addEventListener("click", () => {
      const p: Preset = {
        id: `custom-${Date.now().toString(36)}`,
        kind: "custom",
        title: fields.title || fields.topic || "Custom Prompt",
        tagline: `${fields.count} questions · ${fields.mode} · ${fields.types.length} types`,
        tags: [fields.mode, fields.difficulty, ...fields.types.slice(0, 3)],
        fields: { ...fields },
      };
      saveCustomPreset(p);
      audio.sfx("unlock");
      fx.starBurst(savePresetBtn.getBoundingClientRect().left + 30, savePresetBtn.getBoundingClientRect().top, { gold: true, n: 12 });
      toast(t("Saved to presets"), "info");
    });
    batchRow.querySelectorAll<HTMLElement>(".lib-btn").forEach((b) => {
      b.addEventListener("mouseenter", () => audio.sfx("hover"));
      b.addEventListener("click", () => {
        const d = b.getAttribute("data-diff") as DifficultyMix;
        const v = { ...fields, difficulty: d };
        void copyText(buildPrompt(v), b, `${fields.topic || "Quiz"} (${d})`);
      });
    });
    form.querySelector(".dice-btn")!.addEventListener("click", () => {
      audio.sfx("select");
      const topics = ["World War 2", "Greek mythology", "Space exploration", "80s music", "The human brain", "Ancient Egypt", "Dinosaurs", "Quantum physics", "World cuisines", "Famous heists"];
      const btn = form.querySelector<HTMLElement>(".dice-btn")!;
      const rect = btn.getBoundingClientRect();
      const topicInput = form.querySelector<HTMLInputElement>(".builder-input")!;
      let n = 0;
      const id = window.setInterval(() => {
        fields.topic = topics[Math.floor(Math.random() * topics.length)];
        fields.count = 5 + Math.floor(Math.random() * 12);
        fields.difficulty = DIFFS[Math.floor(Math.random() * DIFFS.length)];
        topicInput.value = fields.topic;
        topicInput.classList.add("rolling");
        if (++n > 10) {
          clearInterval(id);
          topicInput.classList.remove("rolling");
          segRefs.refresh();
          fx.starBurst(rect.left + 40, rect.top, { n: 8 });
          renderBuilder();
        }
      }, 70);
    });
    form.querySelector(".clear-btn")!.addEventListener("click", () => {
      Object.assign(fields, defaultFields());
      audio.sfx("paper");
      renderBuilder();
    });

    // paste/validate area
    const pa = pasteArea.querySelector<HTMLTextAreaElement>(".paste-area")!;
    const errBox = pasteArea.querySelector<HTMLElement>(".builder-paste-errors")!;
    const playBtn = pasteArea.querySelector<HTMLElement>(".play-btn")!;
    const saveLibBtn = pasteArea.querySelector<HTMLElement>(".save-lib-btn")!;
    let validatedQuiz: ReturnType<typeof validateQuiz> | null = null;
    pasteArea.querySelector(".validate-btn")!.addEventListener("click", () => {
      try {
        validatedQuiz = validateQuiz(JSON.parse(pa.value));
      } catch {
        validatedQuiz = null;
        audio.sfx("wrong");
        fx.shake(10);
        errBox.textContent = "";
        errBox.classList.remove("hidden");
        errBox.appendChild(h("div", { class: "load-error-row" }, [h("span", { class: "load-error-x" }, ["✕"]), h("span", {}, ["Not valid JSON — check commas and quotes."])]));
        playBtn.classList.add("hidden");
        saveLibBtn.classList.add("hidden");
        return;
      }
      if (!validatedQuiz.ok) {
        audio.sfx("wrong");
        fx.shake(10);
        errBox.textContent = "";
        errBox.classList.remove("hidden");
        validatedQuiz.errors.slice(0, 5).forEach((err, i) => {
          const row = h("div", { class: "load-error-row" }, [
            h("span", { class: "load-error-x" }, ["✕"]),
            h("span", {}, [`${err.path} — ${err.message}`]),
          ]);
          errBox.appendChild(row);
          gsap.fromTo(row, { x: -20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.22, delay: i * 0.05 });
        });
        playBtn.classList.add("hidden");
        saveLibBtn.classList.add("hidden");
        return;
      }
      audio.sfx("correct");
      fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 14 });
      errBox.classList.add("hidden");
      playBtn.classList.remove("hidden");
      saveLibBtn.classList.remove("hidden");
      gsap.fromTo([playBtn, saveLibBtn], { scale: 0 }, { scale: 1, duration: 0.3, stagger: 0.08, ease: "back.out(2)" });
      toast(`“${validatedQuiz.quiz.title}” is valid`, "info");
    });
    playBtn.addEventListener("click", () => {
      if (validatedQuiz?.ok) {
        void startQuiz({ ...validatedQuiz.quiz, source: "ai output" });
      }
    });
    saveLibBtn.addEventListener("click", () => {
      if (validatedQuiz?.ok) {
        saveQuiz(validatedQuiz.quiz, "ai output");
        audio.sfx("paper");
        toast(t("Saved to library"), "info");
      }
    });

    builderBox.append(
      h("div", { class: "builder-grid" }, [form, right]),
    );

    // live textarea for notes
    const notes = form.querySelector<HTMLTextAreaElement>(".builder-notes")!;
    notes.addEventListener("input", () => {
      fields.notes = notes.value;
      refreshPreview();
    });

    refreshPreview();
    if (!RM()) {
      gsap.fromTo(form, { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
      gsap.fromTo(right, { x: 50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out", delay: 0.05 });
    }
  }

  /* ================= PRESETS ================= */
  const presetsBox = el.querySelector<HTMLElement>(".prompts-presets")!;

  function renderPresets() {
    presetsBox.textContent = "";
    const favs = favoritePromptIds();

    const toolbar = h("div", { class: "presets-toolbar" }, [
      h("input", { class: "fill-input presets-search", placeholder: t("SEARCH PRESETS…"), value: search }),
      h("button", { class: `lib-btn ${favOnly ? "play" : ""} fav-btn` }, [favOnly ? "★ ONLY ON" : "★ FAVORITES"]),
      h("button", { class: `lib-btn ${mergeArmed ? "play" : ""} merge-toggle` }, [mergeArmed ? "MERGE MODE ON" : "⇄ MERGE MODE"]),
    ]);
    toolbar.querySelector<HTMLInputElement>(".presets-search")!.addEventListener("input", (e) => {
      search = (e.target as HTMLInputElement).value.toLowerCase();
      applySearchFilter();
    });
    toolbar.querySelector(".fav-btn")!.addEventListener("click", () => {
      favOnly = !favOnly;
      audio.sfx("select");
      renderPresets();
    });
    toolbar.querySelector(".merge-toggle")!.addEventListener("click", () => {
      mergeArmed = !mergeArmed;
      mergeTargets = [];
      audio.sfx("select");
      renderPresets();
    });

    const all: (Preset & { text?: string })[] = [
      ...BUILTIN_PRESETS,
      ...customPresets(),
      { ...FIXER_PROMPT, kind: "builtin", fields: defaultFields() } as Preset & { text: string },
    ];
    const filtered = all.filter((p) => {
      if (favOnly && !favs.includes(p.id)) return false;
      if (search && !`${p.title} ${p.tagline} ${p.tags.join(" ")}`.toLowerCase().includes(search)) return false;
      return true;
    });

    const grid = h("div", { class: "prompts-grid" }, []);
    const applySearchFilter = () => {
      let anyVisible = false;
      presetsBox.querySelectorAll<HTMLElement>(".prompt-card").forEach((card) => {
        const hay = card.getAttribute("data-search") ?? "";
        const show = !search || hay.includes(search);
        card.classList.toggle("hidden", !show);
        if (show) anyVisible = true;
      });
      const empty = presetsBox.querySelector<HTMLElement>(".lib-empty");
      if (empty) empty.classList.toggle("hidden", anyVisible);
    };
    filtered.forEach((p, i) => {
      const isFav = favs.includes(p.id);
      const inMerge = mergeTargets.includes(p.id);
      const card = h("article", {
        class: `prompt-card ${inMerge ? "merge-pick" : ""}`,
        "data-id": p.id,
        "data-search": `${p.title} ${p.tagline} ${p.tags.join(" ")}`.toLowerCase(),
      }, [
        h("div", { class: "prompt-card-star", style: isFav ? "color:var(--gold)" : "" }, ["★"]),
        p.kind === "custom" ? h("div", { class: "preset-badge" }, [t("CUSTOM")]) : null,
        h("h3", { class: "prompt-card-title" }, [p.title]),
        h("p", { class: "prompt-card-tagline" }, [p.tagline]),
        h("div", { class: "prompt-card-tags" }, p.tags.slice(0, 4).map((t) => h("span", { class: "prompt-tag" }, [t]))),
        h("div", { class: "prompt-card-actions" }, [
          h("button", { class: "lib-btn prompt-view" }, [t("VIEW")]),
          h("button", { class: "lib-btn play prompt-copy" }, [t("⧉ COPY")]),
          h("button", { class: `lib-btn ${isFav ? "play" : ""} prompt-star` }, ["★"]),
          h("button", { class: "lib-btn prompt-follow" }, [t("FOLLOW-UP")]),
          h("button", { class: "lib-btn prompt-load" }, [t("LOAD")]),
          p.kind === "custom" ? h("button", { class: "lib-btn danger prompt-del" }, ["✕"]) : null,
        ]),
      ]);
      card.addEventListener("mouseenter", () => audio.sfx("hover"));
      const textOf = () => (p.text ? p.text : buildPrompt(p.fields));
      card.querySelector(".prompt-view")!.addEventListener("click", () => {
        audio.sfx("select");
        openPromptModal(p.title, textOf());
      });
      card.querySelector(".prompt-copy")!.addEventListener("click", (e) => {
        e.stopPropagation();
        void copyText(textOf(), card.querySelector(".prompt-copy") as HTMLElement, p.title);
      });
      card.querySelector(".prompt-star")!.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavoritePrompt(p.id);
        audio.sfx("star");
        renderPresets();
      });
      card.querySelector(".prompt-follow")!.addEventListener("click", (e) => {
        e.stopPropagation();
        if (p.text) {
          toast(t("The fixer has no follow-up"), "error");
          return;
        }
        void copyText(buildFollowUpPrompt(p.fields), card.querySelector(".prompt-follow") as HTMLElement, `${p.title} follow-up`);
      });
      card.querySelector(".prompt-load")!.addEventListener("click", (e) => {
        e.stopPropagation();
        audio.sfx("select");
        Object.assign(fields, { ...defaultFields(), ...p.fields });
        setTab("builder");
        toast(`Loaded “${p.title}” into the builder`, "info");
      });
      const del = card.querySelector<HTMLElement>(".prompt-del");
      if (del) {
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteCustomPreset(p.id);
          audio.sfx("paper");
          renderPresets();
        });
      }
      // merge mode: clicking card toggles pick
      card.addEventListener("click", () => {
        if (!mergeArmed) return;
        if (mergeTargets.includes(p.id)) mergeTargets = mergeTargets.filter((x) => x !== p.id);
        else mergeTargets.push(p.id);
        audio.sfx("select");
        renderPresets();
      });
      grid.appendChild(card);
      if (!RM()) gsap.fromTo(card, { y: 40, opacity: 0, rotate: -2 }, { y: 0, opacity: 1, rotate: 0, duration: 0.35, delay: 0.04 * i, ease: "back.out(1.4)" });
    });

    // merge banner
    let mergeBanner: HTMLElement | null = null;
    if (mergeArmed) {
      mergeBanner = h("div", { class: "merge-banner" }, [
        h("span", {}, [t("{n}/2 PRESETS PICKED — ", { n: mergeTargets.length })]),
        mergeTargets.length === 2
          ? h("button", { class: "sticker-btn accent combine-btn" }, [t("⇄ COMBINE INTO BUILDER")])
          : h("span", {}, [t("PICK TWO CARDS")]),
      ]);
      mergeBanner.querySelector(".combine-btn")?.addEventListener("click", () => {
        const all2 = [...BUILTIN_PRESETS, ...customPresets()];
        const a = all2.find((x) => x.id === mergeTargets[0]);
        const b = all2.find((x) => x.id === mergeTargets[1]);
        if (a && b) {
          Object.assign(fields, mergeFields({ ...a.fields }, { ...b.fields }));
          mergeTargets = [];
          mergeArmed = false;
          audio.sfx("rankup");
          fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 16 });
          setTab("builder");
          toast(`Combined “${a.title}” + “${b.title}”`, "info");
          return;
        }
        mergeTargets = [];
        renderPresets();
      });
    }

    presetsBox.append(toolbar, mergeBanner ?? h("div", {}, []), grid);
    if (!filtered.length) {
      grid.appendChild(h("div", { class: "lib-empty" }, [
        h("div", { class: "lib-empty-star" }, ["★"]),
        h("p", {}, [t("NOTHING MATCHES.")]),
        h("p", { class: "lib-empty-sub" }, [t("Try a different search, or clear the ★ filter.")]),
      ]));
    }
  }

  /* ================= HISTORY ================= */
  const historyBox = el.querySelector<HTMLElement>(".prompts-history")!;
  function renderHistory() {
    historyBox.textContent = "";
    const list = promptHistory();
    if (!list.length) {
      historyBox.appendChild(h("div", { class: "lib-empty" }, [
        h("div", { class: "lib-empty-star" }, ["◷"]),
        h("p", {}, [t("NO PROMPTS COPIED YET.")]),
        h("p", { class: "lib-empty-sub" }, [t("Everything you copy lands here for later.")]),
      ]));
      return;
    }
    const grid = h("div", { class: "history-grid" }, list.map((entry, i) => {
      const card = h("article", { class: "history-card" }, [
        h("div", { class: "history-title" }, [entry.title]),
        h("div", { class: "history-meta" }, [
          h("span", {}, [t("{n} CHARS", { n: entry.text.length })]),
          h("span", { class: "meta-sep" }, ["·"]),
          h("span", {}, [new Date(entry.date).toLocaleString()]),
        ]),
        h("div", { class: "history-actions" }, [
          h("button", { class: "lib-btn play h-copy" }, [t("⧉ COPY")]),
          h("button", { class: "lib-btn h-view" }, [t("VIEW")]),
          h("button", { class: "lib-btn danger h-del" }, ["✕"]),
        ]),
      ]);
      card.querySelector(".h-copy")!.addEventListener("click", () => void copyText(entry.text, card.querySelector(".h-copy") as HTMLElement, entry.title));
      card.querySelector(".h-view")!.addEventListener("click", () => openPromptModal(entry.title, entry.text));
      card.querySelector(".h-del")!.addEventListener("click", () => {
        deletePromptHistory(entry.id);
        audio.sfx("paper");
        renderHistory();
      });
      if (!RM()) gsap.fromTo(card, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.04, ease: "back.out(1.5)" });
      return card;
    }));
    historyBox.appendChild(grid);
  }

  /* ================= prompt modal ================= */
  const modal = h("div", { class: "prompt-modal hidden" }, [
    h("div", { class: "prompt-modal-card" }, [
      h("div", { class: "pm-head" }, [
        h("h3", { class: "pm-title" }, []),
        h("button", { class: "pm-close" }, ["✕"]),
      ]),
      h("div", { class: "pm-body" }, [h("pre", { class: "pm-text" }, [])]),
      h("div", { class: "pm-actions" }, [
        h("button", { class: "sticker-btn accent pm-copy" }, [t("⧉ COPY PROMPT")]),
        h("button", { class: "sticker-btn pm-download" }, [t("⤓ SAVE .TXT")]),
      ]),
    ]),
  ]);
  el.appendChild(modal);

  function openPromptModal(title: string, text: string) {
    modal.querySelector<HTMLElement>(".pm-title")!.textContent = title.toUpperCase();
    modal.querySelector<HTMLElement>(".pm-text")!.textContent = text;
    modal.querySelector<HTMLElement>(".pm-body")!.scrollTop = 0;
    modal.classList.remove("hidden");
    audio.sfx("paper");
    if (!RM()) {
      gsap.fromTo(modal.querySelector(".prompt-modal-card")!, { scale: 0.7, opacity: 0, rotate: -4 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.35, ease: "back.out(1.5)" });
    }
    const copy = modal.querySelector<HTMLElement>(".pm-copy")!;
    copy.onclick = () => void copyText(text, copy, title);
    modal.querySelector<HTMLElement>(".pm-download")!.onclick = () => {
      audio.sfx("paper");
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/\s+/g, "-").toLowerCase()}-prompt.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    modal.querySelector<HTMLElement>(".pm-close")!.onclick = () => {
      audio.sfx("click");
      modal.classList.add("hidden");
    };
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    };
  }

  /* ---------------- keyboard ---------------- */
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Escape") {
      if (!modal.classList.contains("hidden")) modal.classList.add("hidden");
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const order: ("builder" | "presets" | "history")[] = ["builder", "presets", "history"];
      const idx = order.indexOf(tab);
      const next = e.key === "ArrowRight" ? (idx + 1) % 3 : (idx + 2) % 3;
      setTab(order[next]);
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---------------- boot ---------------- */
  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  root.appendChild(el);
  renderBuilder();
  if (builderPrefill.tagline) {
    toast(builderPrefill.tagline, "info");
    builderPrefill.tagline = undefined;
  }
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".prompts-tabs", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power2.out", delay: 0.1 });
  }

  return () => {
    window.removeEventListener("keydown", onKey);
  };
});

/* study-loop helpers used by other screens */
export function prefillBuilderFromMisses(quizTitle: string) {
  const stats = topicStats()[quizTitle];
  const misses = stats?.misses ?? [];
  builderPrefill.fields = buildMissPrompt(quizTitle, misses);
  builderPrefill.tagline = misses.length
    ? t("Retest prompt ready — {n} weak spots loaded", { n: misses.length })
    : t("No misses recorded — generated a fresh practice prompt");
}
