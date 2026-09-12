/* ============ P5 QUIZ — QUIZ SCREEN (the heist itself) ============ */
import gsap from "gsap";
import katex from "katex";
import { registerScreen, go, app } from "./screens";
import { h, clear, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import {
  RM, slamText, hitStop, cutIn, portraitPop,
} from "../fx/transitions";
import { randomPortrait, randomDialogue } from "../core/art";
import { QuizRunner, type AnswerOutcome } from "../engine/quiz";
import type { QuestionRef } from "../core/types";
import { saveProgress, loadProgress, clearProgress, addMiss } from "../core/store";

interface QuizScreenState {
  runner: QuizRunner;
  lock: boolean;
  tickCb: (left: number, total: number) => void;
  heartbeatSec: number;
}

registerScreen("quiz", (root) => {
  const quiz = app.currentQuiz;
  if (!quiz) {
    void go({ name: "load" }, { instant: true });
    return () => undefined;
  }

  const state: QuizScreenState = {
    runner: new QuizRunner(quiz, {
      onTimeUp: () => timeUp(),
      onHeartbeat: () => {
        fx.shards(window.innerWidth * 0.5, window.innerHeight * 0.4);
        fx.shake(18);
      },
    }),
    lock: false,
    tickCb: () => undefined,
    heartbeatSec: 0,
  };
  const runner = state.runner;
  const settings = app.settings;

  /* ---------- persistent bits ---------- */
  const heartsEl = () => el.querySelector<HTMLElement>(".hearts");
  const comboEl = () => el.querySelector<HTMLElement>(".combo-readout");
  const timerWrap = () => el.querySelector<HTMLElement>(".timer-wrap");
  const timerFill = () => el.querySelector<HTMLElement>(".timer-fill");
  const progressEl = () => el.querySelector<HTMLElement>(".quiz-progress");

  /* ---------- dom ---------- */
  const el = h("div", { class: "screen quiz-screen" }, [
    h("header", { class: "quiz-top" }, [
      h("div", { class: "hearts" }, []),
      h("button", { class: "quit-btn", "aria-label": "Pause or quit" }, ["✕"]),
      h("div", { class: "quiz-progress" }, []),
      h("div", { class: "quiz-stats" }, [
        h("div", { class: "points-readout" }, [h("span", { class: "pts-num" }, ["0"]), h("span", { class: "pts-label" }, ["PTS"])]),
        h("div", { class: "combo-readout hidden" }, []),
      ]),
      h("div", { class: "timer-wrap" }, [
        h("div", { class: "timer-fill" }, []),
        h("div", { class: "timer-label" }, []),
      ]),
    ]),
    h("main", { class: "quiz-stage" }, [
      h("div", { class: "q-meta" }, [
        h("span", { class: "q-section" }, []),
        h("span", { class: "q-count" }, []),
        h("span", { class: "q-diff" }, []),
      ]),
      h("article", { class: "question-card corner-frame" }, [
        h("div", { class: "q-media" }, []),
        h("h2", { class: "q-text" }, []),
        h("div", { class: "q-answers" }, []),
        h("div", { class: "q-feedback" }, []),
      ]),
      h("div", { class: "rankup-toast hidden" }, [
        h("div", { class: "rankup-stars" }, ["★ ★ ★ ★ ★"]),
        h("div", { class: "rankup-text" }, ["RANK UP"]),
      ]),
    ]),
    h("footer", { class: "quiz-bottom" }, [
      h("button", { class: "lifeline", "data-lf": "fifty" }, [h("span", { class: "lf-icon" }, ["½"]), h("span", { class: "lf-label" }, ["50/50"])]),
      h("button", { class: "lifeline", "data-lf": "skip" }, [h("span", { class: "lf-icon" }, ["⏭"]), h("span", { class: "lf-label" }, ["SKIP"])]),
      h("button", { class: "lifeline", "data-lf": "hint" }, [h("span", { class: "lf-icon" }, ["💡"]), h("span", { class: "lf-label" }, ["HINT"])]),
      h("button", { class: "lifeline", "data-lf": "flag" }, [h("span", { class: "lf-icon" }, ["⚑"]), h("span", { class: "lf-label" }, ["FLAG"])]),
      h("button", { class: "next-btn hidden" }, ["NEXT ▸"]),
    ]),
    h("div", { class: "pause-overlay hidden" }, [
      h("div", { class: "pause-card" }, [
        h("h3", {}, ["PAUSED"]),
        h("button", { class: "sticker-btn accent resume-btn" }, ["RESUME"]),
        h("button", { class: "sticker-btn quit2-btn" }, ["ABANDON HEIST"]),
      ]),
    ]),
  ]);

  root.appendChild(el);

  /* ---------- helpers ---------- */

  const renderMarkdown = (text: string): Node[] => {
    const nodes: Node[] = [];
    const parts = text.split(/(\$[^$]+\$)/g);
    for (const part of parts) {
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
        const span = document.createElement("span");
        span.className = "katex-inline";
        try {
          katex.render(part.slice(1, -1), span, { throwOnError: false });
        } catch {
          span.textContent = part;
        }
        nodes.push(span);
      } else {
        // **bold**, *italic*, `code`
        const seg = document.createElement("span");
        const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(part)) !== null) {
          if (m.index > last) seg.append(part.slice(last, m.index));
          const tok = m[0];
          if (tok.startsWith("**")) {
            const b = document.createElement("strong");
            b.textContent = tok.slice(2, -2);
            seg.append(b);
          } else if (tok.startsWith("`")) {
            const c = document.createElement("code");
            c.textContent = tok.slice(1, -1);
            seg.append(c);
          } else {
            const i = document.createElement("em");
            i.textContent = tok.slice(1, -1);
            seg.append(i);
          }
          last = m.index + tok.length;
        }
        if (last < part.length) seg.append(part.slice(last));
        nodes.push(seg);
      }
    }
    return nodes;
  };

  const setAnswerButtonsDisabled = (d: boolean) => {
    el.querySelectorAll<HTMLElement>(".q-answers button, .q-answers input, .q-answers textarea").forEach((n) => {
      if (d) n.setAttribute("disabled", "");
      else n.removeAttribute("disabled");
    });
  };

  /* ---------- progress / header ---------- */

  const renderProgress = () => {
    const p = progressEl()!;
    clear(p);
    for (let i = 0; i < runner.total; i++) {
      const seg = h("div", { class: "pseg" }, []);
      if (i < runner.index) seg.classList.add("done");
      if (i === runner.index) seg.classList.add("current");
      p.appendChild(seg);
    }
  };

  const renderHearts = () => {
    const he = heartsEl()!;
    if (runner.settings.mode !== "survival") {
      he.classList.add("hidden");
      return;
    }
    he.classList.remove("hidden");
    clear(he);
    for (let i = 0; i < 3; i++) {
      const heart = h("div", { class: `heart ${i < runner.hearts ? "on" : "off"}` }, ["♥"]);
      he.appendChild(heart);
    }
  };

  const renderCombo = (o?: AnswerOutcome) => {
    const c = comboEl()!;
    if (!o || o.streak < 2) {
      c.classList.add("hidden");
      return;
    }
    c.classList.remove("hidden");
    clear(c);
    c.append(
      h("span", { class: "combo-fire" }, ["🔥"]),
      h("span", {}, [`STREAK ${o.streak}`]),
      o.multiplier > 1 ? h("span", { class: "combo-x" }, [`x${o.multiplier}`]) : "",
    );
  };

  /* ---------- question rendering ---------- */

  const renderQuestion = () => {
    const ref = runner.current;
    const q = ref.q;
    state.lock = false;

    el.querySelector<HTMLElement>(".q-section")!.textContent = ref.section.toUpperCase();
    el.querySelector<HTMLElement>(".q-count")!.textContent = `Q${runner.index + 1}/${runner.total}`;
    const diffEl = el.querySelector<HTMLElement>(".q-diff")!;
    diffEl.textContent = q.difficulty === 3 ? "◆◆◆" : q.difficulty === 2 ? "◆◆◇" : "◆◇◇";
    diffEl.style.color = q.difficulty === 3 ? "var(--red)" : "var(--paper-dim)";

    const card = el.querySelector<HTMLElement>(".question-card")!;
    const media = el.querySelector<HTMLElement>(".q-media")!;
    const qtext = el.querySelector<HTMLElement>(".q-text")!;
    const answers = el.querySelector<HTMLElement>(".q-answers")!;
    const feedback = el.querySelector<HTMLElement>(".q-feedback")!;
    clear(media);
    clear(qtext);
    clear(answers);
    clear(feedback);

    if (q.image) {
      media.classList.remove("hidden");
      const img = h("img", { class: "q-img", src: q.image, alt: "" });
      img.addEventListener("error", () => media.classList.add("hidden"));
      media.appendChild(img);
    } else {
      media.classList.add("hidden");
    }

    const textNode = h("div", { class: "q-text-inner" }, renderMarkdown(q.question));
    qtext.appendChild(textNode);
    qtext.setAttribute("data-w", "");

    if (RM()) {
      qtext.style.opacity = "1";
    } else {
      slamText(qtext, { stagger: 0.05 });
      audio.sfx("paper");
    }

    const type = q.type ?? "multiple";
    switch (type) {
      case "multiple":
      case "boolean":
        renderChoice(answers, ref);
        break;
      case "multi":
        renderMulti(answers, ref);
        break;
      case "fill":
        renderFill(answers, ref);
        break;
      case "numeric":
        renderNumeric(answers, ref);
        break;
      case "order":
        renderOrder(answers, ref);
        break;
      case "match":
        renderMatch(answers, ref);
        break;
      case "hotspot":
        renderHotspot(answers, ref);
        break;
      case "open":
        renderOpen(answers, ref);
        break;
    }

    // timer
    const tw = timerWrap()!;
    const limit = runner.questionTimeLimit;
    if (limit) {
      tw.classList.remove("hidden");
      timerFill()!.style.width = "100%";
      timerFill()!.style.background = "var(--red)";
      el.querySelector<HTMLElement>(".timer-label")!.textContent = `${limit}s`;
      tw.classList.remove("low");
    } else {
      tw.classList.add("hidden");
    }

    renderProgress();
    renderHearts();
    renderCombo();
    state.heartbeatSec = 0;
    // 50/50 visual state: dimmed when it can't help on this question
    const fiftyBtn = el.querySelector<HTMLElement>('[data-lf="fifty"]')!;
    if (!fiftyBtn.classList.contains("used")) {
      fiftyBtn.classList.toggle("na", runner.fiftyStatus() === "na");
    }
    el.querySelector<HTMLElement>(".points-readout .pts-num")!.textContent = String(runner.points);

    // entrance
    if (!RM()) {
      gsap.fromTo(card, { x: 90, opacity: 0, rotate: 2 }, { x: 0, opacity: 1, rotate: 0, duration: 0.45, ease: "power3.out" });
    }
  };

  /* ---------- types ---------- */

  const renderChoice = (box: HTMLElement, ref: QuestionRef) => {
    const answers = runner.shuffledAnswers(ref);
    answers.forEach((a, i) => {
      const key = i < 4 ? String(i + 1) : "";
      const btn = h("button", { class: "choice-btn" }, [
        h("span", { class: "choice-key" }, [key]),
        h("span", { class: "choice-text" }, renderMarkdown(a.text)),
        h("span", { class: "choice-star" }, ["★"]),
      ]);
      btn.setAttribute("data-ans", a.text);
      btn.addEventListener("mouseenter", () => audio.sfx("hover"));
      btn.addEventListener("click", () => answerWith(a.text, btn));
      box.appendChild(btn);
      if (!RM()) {
        gsap.fromTo(btn, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, delay: 0.05 + i * 0.07, ease: "back.out(1.5)" });
      }
    });
  };

  const renderMulti = (box: HTMLElement, ref: QuestionRef) => {
    const answers = runner.shuffledAnswers(ref);
    answers.forEach((a, i) => {
      const row = h("button", { class: "multi-row", role: "checkbox" }, [
        h("span", { class: "multi-box" }, []),
        h("span", { class: "choice-text" }, renderMarkdown(a.text)),
      ]);
      row.setAttribute("data-ans", a.text);
      row.addEventListener("click", () => {
        const on = row.classList.toggle("picked");
        row.setAttribute("aria-checked", String(on));
        audio.sfx(on ? "stamp" : "click");
      });
      box.appendChild(row);
      if (!RM()) gsap.fromTo(row, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: 0.05 + i * 0.06, ease: "back.out(1.5)" });
    });
    box.appendChild(h("button", { class: "sticker-btn accent confirm-btn" }, ["CONFIRM"]));
    box.querySelector(".confirm-btn")!.addEventListener("click", () => {
      const picked = [...box.querySelectorAll<HTMLElement>(".multi-row.picked")].map((r) => r.getAttribute("data-ans")!);
      if (!picked.length) {
        fx.shake(6);
        return;
      }
      answerWith(picked.join("\u0001"), box.querySelector(".confirm-btn") as HTMLElement);
    });
  };

  const renderFill = (box: HTMLElement, _ref: QuestionRef) => {
    const input = h("input", { class: "fill-input", placeholder: "TYPE YOUR ANSWER", autocomplete: "off", spellcheck: "false" });
    const go2 = h("button", { class: "sticker-btn accent confirm-btn" }, ["ANSWER"]);
    box.append(
      h("div", { class: "fill-row" }, [input, go2]),
    );
    const submit = () => {
      if (!input.value.trim()) {
        fx.shake(6);
        return;
      }
      answerWith(input.value.trim(), go2);
    };
    go2.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    if (!RM()) gsap.fromTo(".fill-row", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
    window.setTimeout(() => input.focus(), 350);
  };

  const renderNumeric = (box: HTMLElement, _ref: QuestionRef) => {
    const input = h("input", { class: "fill-input num-input", placeholder: "0.00", inputmode: "decimal", autocomplete: "off", spellcheck: "false" });
    const go2 = h("button", { class: "sticker-btn accent confirm-btn" }, ["ANSWER"]);
    box.append(h("div", { class: "fill-row" }, [input, go2]));
    const submit = () => {
      if (!input.value.trim()) {
        fx.shake(6);
        return;
      }
      answerWith(input.value.trim(), go2);
    };
    go2.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    window.setTimeout(() => input.focus(), 350);
    if (!RM()) gsap.fromTo(".fill-row", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
  };

  const renderOrder = (box: HTMLElement, ref: QuestionRef) => {
    const chips: HTMLElement[] = [];
    // order questions ALWAYS scramble the display — the correct order lives in the JSON,
    // and showing it pre-solved would defeat the question.
    const answers = [...(ref.q.answers ?? [])];
    for (let i = answers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    answers.forEach((a, i) => {
      const chip = h("button", { class: "order-chip" }, [
        h("span", { class: "chip-num" }, [String(i + 1)]),
        h("span", { class: "chip-text" }, [a.text]),
      ]);
      chip.setAttribute("data-ans", a.text);
      chip.addEventListener("click", () => {
        // click-swap: first click selects, second click swaps
        const selected = box.querySelector<HTMLElement>(".order-chip.selected");
        if (!selected) {
          chip.classList.add("selected");
          audio.sfx("select");
          return;
        }
        if (selected === chip) {
          chip.classList.remove("selected");
          return;
        }
        swapNodes(selected, chip);
        chip.classList.remove("selected");
        selected.classList.remove("selected");
        audio.sfx("click");
        renumber();
      });
      box.appendChild(chip);
      chips.push(chip);
      if (!RM()) gsap.fromTo(chip, { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: 0.05 + i * 0.06, ease: "back.out(1.5)" });
    });
    const renumber = () => {
      box.querySelectorAll<HTMLElement>(".order-chip").forEach((c, i) => {
        c.querySelector(".chip-num")!.textContent = String(i + 1);
      });
    };
    const swapNodes = (a: HTMLElement, b: HTMLElement) => {
      const afterB = b.nextSibling;
      const parent = b.parentNode!;
      parent.insertBefore(b, a);
      parent.insertBefore(a, afterB);
    };
    box.appendChild(h("button", { class: "sticker-btn accent confirm-btn" }, ["LOCK ORDER"]));
    box.querySelector(".confirm-btn")!.addEventListener("click", () => {
      const order = [...box.querySelectorAll<HTMLElement>(".order-chip")].map((c) => c.getAttribute("data-ans")!);
      answerWith(order.join("\u0001"), box.querySelector(".confirm-btn") as HTMLElement);
    });
  };

  const renderMatch = (box: HTMLElement, ref: QuestionRef) => {
    const lefts = (ref.q.pairs ?? []).map((p) => p.left);
    const rights = (ref.q.pairs ?? []).map((p) => p.right);
    if (runner.settings.shuffleAnswers) {
      for (let i = rights.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rights[i], rights[j]] = [rights[j], rights[i]];
      }
    }
    const matches = new Map<string, string>();
    const colL = h("div", { class: "match-col" }, []);
    const colR = h("div", { class: "match-col" }, []);
    lefts.forEach((l, i) => {
      const b = h("button", { class: "match-btn" }, [h("span", {}, [l])]);
      b.addEventListener("click", () => {
        audio.sfx("select");
        colL.querySelectorAll(".match-btn").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        tryMatch();
      });
      colL.appendChild(b);
      if (!RM()) gsap.fromTo(b, { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: 0.05 + i * 0.07, ease: "back.out(1.5)" });
    });
    rights.forEach((r) => {
      const b = h("button", { class: "match-btn right" }, [h("span", {}, [r])]);
      b.addEventListener("click", () => {
        audio.sfx("select");
        colR.querySelectorAll(".match-btn").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        tryMatch();
      });
      colR.appendChild(b);
      if (!RM()) gsap.fromTo(b, { x: 50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: 0.05 + rights.indexOf(r) * 0.07, ease: "back.out(1.5)" });
    });

    const tryMatch = () => {
      const l = colL.querySelector<HTMLElement>(".match-btn.selected");
      const r = colR.querySelector<HTMLElement>(".match-btn.selected");
      if (!l || !r) return;
      const lText = l.querySelector("span")!.textContent!;
      const rText = r.querySelector("span")!.textContent!;
      const pair = (ref.q.pairs ?? []).find((p) => p.left === lText);
      const ok = pair?.right === rText;
      if (ok) {
        matches.set(lText, rText);
        l.classList.add("paired");
        r.classList.add("paired");
        audio.sfx("correct");
        fx.starBurst((l.getBoundingClientRect().left + r.getBoundingClientRect().right) / 2, (l.getBoundingClientRect().top + r.getBoundingClientRect().bottom) / 2, { n: 6 });
      } else {
        audio.sfx("wrong");
        gsap.fromTo([l, r], { x: 0 }, { x: 8, duration: 0.05, repeat: 5, yoyo: true, onComplete: () => gsap.set([l, r], { x: 0 }) });
      }
      colL.querySelectorAll(".match-btn").forEach((x) => x.classList.remove("selected"));
      colR.querySelectorAll(".match-btn").forEach((x) => x.classList.remove("selected"));
      if (matches.size === lefts.length) {
        const confirm = box.querySelector<HTMLElement>(".confirm-btn")!;
        confirm.classList.remove("hidden");
        gsap.fromTo(confirm, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
      }
    };

    const confirm = h("button", { class: "sticker-btn accent confirm-btn hidden" }, ["CONFIRM"]);
    confirm.addEventListener("click", () => {
      const pairs = (ref.q.pairs ?? []).map((p) => `${p.left}|||${matches.get(p.left)}`);
      answerWith(pairs.join("\u0001"), confirm);
    });
    box.append(h("div", { class: "match-grid" }, [colL, colR]), confirm);
  };

  const renderHotspot = (box: HTMLElement, ref: QuestionRef) => {
    if (!ref.q.image) {
      box.appendChild(h("p", { class: "q-note" }, ["This hotspot question needs an \"image\" URL."]));
      return;
    }
    const wrap = h("div", { class: "hotspot-wrap" }, [
      h("img", { class: "hotspot-img", src: ref.q.image, alt: "" }),
    ]);
    const cross = h("div", { class: "hotspot-cross hidden" }, []);
    wrap.appendChild(cross);
    const img = wrap.querySelector<HTMLElement>(".hotspot-img")!;
    img.addEventListener("load", () => {
      if (!RM()) gsap.fromTo(wrap, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" });
    });
    img.addEventListener("click", (e) => {
      const rect = img.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      cross.style.left = `${(x / 100) * rect.width - 14}px`;
      cross.style.top = `${(y / 100) * rect.height - 14}px`;
      cross.classList.remove("hidden");
      gsap.fromTo(cross, { scale: 2 }, { scale: 1, duration: 0.2, ease: "power3.out" });
      audio.sfx("select");
      answerWith(null, wrap, () => runner.submitHotspot(x, y));
    });
    box.appendChild(wrap);
  };

  const renderOpen = (box: HTMLElement, _ref: QuestionRef) => {
    const area = h("textarea", { class: "open-area", placeholder: "Write your answer…", spellcheck: "true" });
    box.append(
      h("div", { class: "open-wrap" }, [
        area,
        h("div", { class: "open-actions" }, [
          h("button", { class: "sticker-btn accent" }, ["I GOT IT ✓"]),
          h("button", { class: "sticker-btn" }, ["I MISSED ✕"]),
        ]),
      ]),
    );
    box.querySelectorAll(".open-actions button").forEach((b) => {
      b.addEventListener("click", () => {
        answerWith(null, b as HTMLElement, () => runner.submitOpen(b.textContent?.includes("GOT") ?? false));
      });
    });
    window.setTimeout(() => area.focus(), 350);
    if (!RM()) gsap.fromTo(".open-wrap", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
  };

  /* ---------- answering ---------- */

  const answerWith = (
    text: string | null,
    trigger: HTMLElement,
    custom?: () => AnswerOutcome,
  ) => {
    if (state.lock) return;
    state.lock = true;
    setAnswerDisabled();
    audio.sfx("select");
    const rect = trigger.getBoundingClientRect();
    const outcome = custom ? custom() : runner.submit(text);
    void showFeedback(outcome, rect);
  };

  const setAnswerDisabled = () => {
    setAnswerButtonsDisabled(true);
  };

  const timeUp = () => {
    if (state.lock) return;
    state.lock = true;
    setAnswerDisabled();
    audio.sfx("wrong");
    fx.shake(10);
    const outcome = runner.submit(null);
    void showFeedback(outcome, timerWrap()!.getBoundingClientRect());
  };

  const showFeedback = async (o: AnswerOutcome, rect: DOMRect) => {
    const feedback = el.querySelector<HTMLElement>(".q-feedback")!;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const instant = runner.settings.feedback === "instant";

    renderHearts();

    if (o.correct) {
      audio.sfx("correct");
      if (settings.slowmo && settings.fx !== "subtle") await hitStop(110);
      fx.starBurst(cx, cy, { gold: o.rankUp });
      fx.flash("#ffffff", o.rankUp ? 0.5 : 0.25);
      fx.slashes(3);
      if (settings.fx !== "subtle") portraitPop(el, cx, cy);
      if (o.points > 0) fx.textPop(cx, cy - 20, `+${o.points}`);
      if (o.speedBonus) fx.textPop(cx, cy - 52, "SPEED BONUS!", "#2fc45a");
      screenStamp("CORRECT", o.correct);
    } else if (o.partial) {
      audio.sfx("correct");
      if (settings.slowmo && settings.fx !== "subtle") await hitStop(80);
      fx.starBurst(cx, cy, { n: 8 });
      fx.textPop(cx, cy - 20, `+${o.points} PARTIAL`, "#e8b93b");
      screenStamp("PARTIAL", true);
    } else {
      audio.sfx("wrong");
      if (settings.shake && settings.fx !== "subtle") fx.shake(14);
      fx.flash("#e60012", 0.18);
      fx.textPop(cx, cy - 20, o.points < 0 ? String(o.points) : "MISS", "#e60012");
      screenStamp("MISS", o.correct);
      if (runner.settings.mode !== "practice") {
        const ref = runner.current;
        addMiss(quiz.title, `${ref.q.question} → ${o.expected.join(", ") || "?"}`);
      }
    }

    renderCombo(o);
    popPoints();
    el.querySelector<HTMLElement>(".points-readout .pts-num")!.textContent = String(runner.points);

    // highlight correct answers
    if (instant) {
      highlightCorrect(o);
      if (o.partial) {
        const fb = h("div", { class: "fb-card partial" }, [
          fbPortrait(),
          h("div", { class: "fb-body" }, [
            h("div", { class: "fb-head" }, [h("span", { class: "fb-partial-icon" }, ["◐"]), h("span", {}, ["PARTIAL CREDIT"])]),
            h("div", { class: "fb-correct" }, [h("span", { class: "fb-label" }, ["CORRECT:"]), h("span", {}, [o.expected.join(" · ")])]),
            o.explanation ? h("p", { class: "fb-expl" }, renderMarkdown(o.explanation)) : null,
          ]),
        ]);
        feedback.appendChild(fb);
        gsap.fromTo(fb, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.4)" });
      } else if (!o.correct && o.expected.length && o.expected[0]) {
        const fb = h("div", { class: "fb-card wrong" }, [
          fbPortrait(),
          h("div", { class: "fb-body" }, [
            h("div", { class: "fb-head" }, [h("span", { class: "fb-x" }, ["✕"]), h("span", {}, ["MISSED"])]),
            h("div", { class: "fb-correct" }, [h("span", { class: "fb-label" }, ["CORRECT:"]), h("span", {}, [o.expected.join(" · ")])]),
            o.explanation ? h("p", { class: "fb-expl" }, renderMarkdown(o.explanation)) : null,
          ]),
        ]);
        feedback.appendChild(fb);
        gsap.fromTo(fb, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.4)" });
      } else if (o.correct) {
        const fb = h("div", { class: "fb-card right" }, [
          fbPortrait(),
          h("div", { class: "fb-body" }, [
            h("div", { class: "fb-head" }, [h("span", { class: "fb-check" }, ["✓"]), h("span", {}, ["CORRECT"])]),
            o.explanation ? h("p", { class: "fb-expl" }, renderMarkdown(o.explanation)) : null,
          ]),
        ]);
        feedback.appendChild(fb);
        gsap.fromTo(fb, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.4)" });
      }
    }

    // rank up toast
    if (o.rankUp) {
      audio.sfx("rankup");
      const rt = el.querySelector<HTMLElement>(".rankup-toast")!;
      rt.classList.remove("hidden");
      rt.textContent = "";
      const p = randomPortrait();
      const pimg = h("img", { class: "rankup-portrait", src: p.src, alt: "" });
      pimg.addEventListener("error", () => pimg.remove());
      rt.append(
        h("div", { class: "rankup-stars" }, ["★ ★ ★ ★ ★"]),
        pimg,
        h("div", { class: "rankup-text" }, ["RANK UP"]),
      );
      fx.starRain(1.8);
      gsap.timeline()
        .fromTo(rt, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" })
        .fromTo(pimg, { scale: 2.2, rotate: -20, opacity: 0 }, { scale: 1, rotate: 8, opacity: 1, duration: 0.35, ease: "back.out(1.6)" }, 0.05)
        .to(rt, { opacity: 0, scale: 1.15, duration: 0.4, delay: 1.4, onComplete: () => rt.classList.add("hidden") });
    }

    if (o.gameOver) {
      window.setTimeout(() => void finishQuiz(), 1600);
      return;
    }

    // next
    const next = el.querySelector<HTMLElement>(".next-btn")!;
    const advanceNow = () => {
      pendingAdvance = null;
      state.lock = false;
      if (!runner.advance()) {
        void finishQuiz();
        return;
      }
      audio.sfx("whoosh");
      fx.slashes(2);
      renderQuestion();
      next.classList.add("hidden");
    };
    const delay = instant ? (o.correct ? 850 : o.partial ? 1200 : 1900) : 700;
    if (settings.autoAdvance) {
      pendingAdvance = window.setTimeout(advanceNow, delay);
    } else {
      next.classList.remove("hidden");
      next.textContent = runner.isLast ? "ALL-OUT! ▸" : "NEXT ▸";
      gsap.fromTo(next, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
      next.onclick = () => {
        audio.sfx("click");
        advanceNow();
      };
    }
  };

  const fbPortrait = (): HTMLElement => {
    const img = h("img", { class: "fb-portrait", src: randomDialogue().src, alt: "" });
    img.addEventListener("error", () => img.remove());
    return img;
  };

  const screenStamp = (text: string, ok: boolean) => {
    const stamp = h("div", { class: `screen-stamp ${ok ? "good" : "bad"}` }, [text]);
    el.appendChild(stamp);
    audio.sfx("stamp");
    gsap.fromTo(stamp, { scale: 3.2, opacity: 0, rotate: -18 }, { scale: 1, opacity: 1, rotate: -9, duration: 0.18, ease: "power3.out" });
    gsap.to(stamp, { opacity: 0, scale: 1.05, duration: 0.5, delay: 0.9, onComplete: () => stamp.remove() });
  };

  const popPoints = () => {
    const num = el.querySelector<HTMLElement>(".points-readout .pts-num")!;
    gsap.fromTo(num, { scale: 1 }, { scale: 1.5, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out" });
  };

  const highlightCorrect = (o: AnswerOutcome) => {
    const type = runner.current.q.type ?? "multiple";
    if (["multiple", "boolean", "multi"].includes(type)) {
      el.querySelectorAll<HTMLElement>("[data-ans]").forEach((n) => {
        if (o.expected.includes(n.getAttribute("data-ans")!)) {
          n.classList.add("correct-answer");
        }
      });
    }
  };

  const finishQuiz = async () => {
    clearProgress();
    const result = runner.finish();
    audio.setIntensity(0);
    // finale cut-in with a real party portrait
    const scope = root;
    const p = randomPortrait();
    await cutIn(scope, { letter: result.rank, color: result.accent, name: p.name, img: p.src });
    void import("../ui/results");
    app.lastResult = result;
    void go({ name: "results" });
  };

  /* ---------- lifelines ---------- */

  el.querySelectorAll<HTMLElement>(".lifeline").forEach((btn) => {
    btn.addEventListener("mouseenter", () => audio.sfx("hover"));
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-lf")!;
      const ref = runner.current;
      if (kind === "fifty") {
        if (state.lock) return;
        const status = runner.fiftyStatus();
        if (status === "used") {
          toast("50/50 already used", "error");
          return;
        }
        if (status === "na") {
          toast("50/50 can't help here — too few options", "error");
          return;
        }
        const remove = runner.useFifty();
        if (!remove) {
          toast("50/50 already used", "error");
          return;
        }
        audio.sfx("whoosh");
        btn.classList.add("used");
        remove.forEach((a) => {
          const n = el.querySelector<HTMLElement>(`[data-ans="${CSS.escape(a.text)}"]`);
          if (n) {
            gsap.to(n, { opacity: 0, x: -40, filter: "blur(4px)", duration: 0.4, ease: "power2.in", onComplete: () => n.setAttribute("disabled", "") });
            fx.ink(n.getBoundingClientRect().left, n.getBoundingClientRect().top);
          }
        });
        return;
      }
      if (kind === "skip") {
        if (state.lock) return;
        if (!runner.useSkip()) {
          toast("No skips left", "error");
          return;
        }
        audio.sfx("whoosh");
        fx.slashes(2);
        if (!runner.advance()) {
          void finishQuiz();
          return;
        }
        renderQuestion();
        return;
      }
      if (kind === "hint") {
        if (!ref.q.hint) {
          toast("No hint available for this question", "error");
          return;
        }
        audio.sfx("paper");
        const fb = el.querySelector<HTMLElement>(".q-feedback")!;
        const hintEl = h("div", { class: "fb-card hint" }, [
          fbPortrait(),
          h("div", { class: "fb-body" }, [
            h("div", { class: "fb-head" }, [h("span", { class: "fb-hint-icon" }, ["💡"]), h("span", {}, ["HINT"])]),
            h("p", { class: "fb-expl" }, [ref.q.hint]),
          ]),
        ]);
        fb.appendChild(hintEl);
        gsap.fromTo(hintEl, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.4, ease: "power3.inOut" });
        btn.classList.add("used");
        return;
      }
      if (kind === "flag") {
        const i = runner.order[runner.index];
        if (!runner.flags.includes(i)) {
          runner.flags.push(i);
          btn.classList.add("flagged");
          audio.sfx("stamp");
          fx.starBurst(btn.getBoundingClientRect().left + 20, btn.getBoundingClientRect().top + 10, { n: 5, gold: true });
          toast("Flagged for review", "info");
        } else {
          runner.flags = runner.flags.filter((f) => f !== i);
          btn.classList.remove("flagged");
        }
        return;
      }
    });
  });

  /* ---------- pause / quit ---------- */

  const pause = el.querySelector<HTMLElement>(".pause-overlay")!;
  let pendingAdvance: number | null = null;

  const openPause = () => {
    if (!pause.classList.contains("hidden")) return;
    audio.sfx("click");
    pause.classList.remove("hidden");
    if (pendingAdvance !== null) {
      clearTimeout(pendingAdvance);
      pendingAdvance = null;
      const next = el.querySelector<HTMLElement>(".next-btn");
      if (next) {
        next.classList.remove("hidden");
        gsap.fromTo(next, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
      }
    }
    runner.pause();
    gsap.fromTo(pause.querySelector(".pause-card")!, { scale: 0.5, opacity: 0, rotate: -6 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.3, ease: "back.out(1.6)" });
  };

  const closePause = () => {
    if (pause.classList.contains("hidden")) return;
    audio.sfx("select");
    pause.classList.add("hidden");
    runner.resume();
  };

  el.querySelector<HTMLElement>(".quit-btn")!.addEventListener("click", openPause);
  pause.querySelector(".resume-btn")!.addEventListener("click", closePause);
  pause.querySelector(".quit2-btn")!.addEventListener("click", () => {
    audio.sfx("click");
    runner.destroy();
    clearProgress();
    void go({ name: "title" });
  });
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (!pause.classList.contains("hidden")) closePause();
      else openPause();
    }
  };
  window.addEventListener("keydown", escHandler);

  /* ---------- timer + heartbeat ---------- */

  state.tickCb = (left, total) => {
    const tw = timerWrap()!;
    const fill = timerFill()!;
    const pct = (left / total) * 100;
    fill.style.width = `${pct}%`;
    el.querySelector<HTMLElement>(".timer-label")!.textContent = `${Math.ceil(left)}s`;
    if (left <= 5) {
      if (!tw.classList.contains("low")) {
        tw.classList.add("low");
        audio.sfx("wrong");
      }
      const sec = Math.ceil(left);
      if (sec !== state.heartbeatSec) {
        state.heartbeatSec = sec;
        audio.sfx("heartbeat");
        fx.heartbeat();
      }
    }
  };
  runner.onTick(state.tickCb);

  /* ---------- keyboard shortcuts ---------- */

  const shortcutHandler = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (state.lock && e.key !== "Enter") return;
    const num = Number(e.key);
    if (num >= 1 && num <= 4) {
      const btns = [...el.querySelectorAll<HTMLElement>(".choice-btn")];
      if (btns[num - 1]) {
        btns[num - 1].click();
      }
      return;
    }
    if (e.key === "Enter") {
      const next = el.querySelector<HTMLElement>(".next-btn");
      if (next && !next.classList.contains("hidden")) next.click();
      else {
        const confirm = el.querySelector<HTMLElement>(".confirm-btn:not(.hidden)");
        if (confirm) confirm.click();
      }
    }
  };
  window.addEventListener("keydown", shortcutHandler);

  /* ---------- resume state ---------- */

  const prog = loadProgress();
  if (prog && prog.quizId === quiz.title) {
    runner.index = prog.index - 1;
    runner.points = prog.points;
    runner.correct = prog.correct;
    runner.streak = prog.streak;
    runner.hearts = prog.hearts;
    runner.elapsedMs = prog.elapsedMs;
    runner.flags = prog.flags;
    runner.answered = prog.answers ?? [];
    runner.earned = prog.earned ?? runner.answered.map(() => 0);
    runner.times = prog.times ?? runner.answered.map(() => 0);
    clearProgress();
    toast("Resumed mid-heist", "info");
  }

  /* ---------- boot ---------- */

  // quiz author can disable lifelines entirely (flag for review stays available)
  if (runner.settings.lifelines === false) {
    el.querySelectorAll<HTMLElement>('.lifeline[data-lf="fifty"], .lifeline[data-lf="skip"], .lifeline[data-lf="hint"]').forEach((b) => {
      b.classList.add("hidden");
    });
  }

  audio.setIntensity(0.25);
  runner.start();
  renderQuestion();

  if (!RM()) {
    gsap.fromTo(".quiz-top", { y: -50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
    gsap.fromTo(".quiz-bottom", { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
  }

  // auto-save progress on advance
  const origAdvance = runner.advance.bind(runner);
  runner.advance = () => {
    const r = origAdvance();
    if (!runner.finished) {
      saveProgress({
        quizId: quiz.title,
        index: runner.index,
        points: runner.points,
        correct: runner.correct,
        streak: runner.streak,
        hearts: runner.hearts,
        elapsedMs: runner.elapsedMs,
        flags: runner.flags,
        answers: runner.answered,
        earned: runner.earned,
        times: runner.times,
      });
    }
    return r;
  };

  return () => {
    runner.destroy();
    runner.offTick(state.tickCb);
    window.removeEventListener("keydown", escHandler);
    window.removeEventListener("keydown", shortcutHandler);
    if (pendingAdvance !== null) clearTimeout(pendingAdvance);
  };
});
