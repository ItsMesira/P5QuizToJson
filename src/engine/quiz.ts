/* ============ P5 QUIZ — QUIZ RUNNER ENGINE ============ */
import type { Answer, QuestionRef, Quiz, QuizResult, QuizSettings, RankKey } from "../core/types";
import { DEFAULT_QUIZ_SETTINGS, rankFor } from "../core/types";

export interface AnswerOutcome {
  correct: boolean;
  points: number;
  streak: number;
  combo: number;
  multiplier: number;
  speedBonus: boolean;
  rankUp: boolean; // streak milestone
  hearts: number;
  gameOver: boolean;
  timeMs: number;
  expected: string[]; // acceptable answers (for reveal)
  explanation?: string;
  partial?: boolean;
}

export interface RunnerCallbacks {
  onTimeUp: (q: QuestionRef) => void;
  onHeartbeat: () => void;
}

export interface RunnerOptions {
  /** force question + choice randomization regardless of the quiz's own settings */
  randomize?: boolean;
  /** resume an attempt with the exact same shuffle */
  seed?: number;
}

/* mulberry32 — tiny deterministic PRNG so a run can be replayed from its seed */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class QuizRunner {
  readonly quiz: Quiz;
  readonly settings: QuizSettings;
  refs: QuestionRef[];
  order: number[]; // indices into refs
  index = -1;
  points = 0;
  maxPoints = 0;
  correct = 0;
  streak = 0;
  bestStreak = 0;
  combo = 0;
  hearts: number;
  answered: (string | null)[] = [];
  earned: number[] = [];
  times: number[] = [];
  flags: number[] = [];
  elapsedMs = 0;
  startedAt = 0;
  qStart = 0;
  finished = false;
  over = false;
  seed = 0; // reproduces this attempt's shuffle (persisted for resume)
  private answerCache = new Map<number, Answer[]>();
  private timerId: number | null = null;
  private elapsedId: number | null = null;
  private cb: RunnerCallbacks;
  private qTimeLeft = 0;
  private timeLimit: number | null = null;
  private tickListeners = new Set<(left: number, total: number) => void>();
  private wrongStack: number[] = []; // endless mode

  constructor(quiz: Quiz, cb: RunnerCallbacks, opts: RunnerOptions = {}) {
    this.quiz = quiz;
    const settings = { ...DEFAULT_QUIZ_SETTINGS, ...quiz.settings };
    if (opts.randomize) {
      settings.shuffle = true;
      settings.shuffleAnswers = true;
    }
    this.settings = settings;
    this.cb = cb;
    this.refs = [];
    quiz.sections.forEach((s) =>
      s.questions.forEach((q, i) => this.refs.push({ section: s.name, index: i, q })),
    );
    // fresh random seed every attempt; restored from progress when resuming
    this.seed = opts.seed ?? (((Math.random() * 0xffffffff) >>> 0) || 1);
    this.order = this.refs.map((_, i) => i);
    if (this.settings.shuffle) this.seededShuffle(this.order, 0);
    this.hearts = 3;
    this.maxPoints = this.refs.reduce((n, r) => n + (r.q.points ?? 100), 0);
  }

  /** deterministic shuffle from the run seed; same seed + salt = same order */
  seededShuffle<T>(arr: T[], salt = 0): T[] {
    const rng = mulberry32((this.seed + salt * 0x9e3779b1) >>> 0);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** stable position of a question inside the (unshuffled) ref list */
  refIndex(ref: QuestionRef): number {
    return this.refs.indexOf(ref);
  }

  /* ---------- flow ---------- */

  start() {
    this.startedAt = performance.now();
    this.elapsedId = window.setInterval(() => {
      this.elapsedMs = performance.now() - this.startedAt;
    }, 250);
    this.next();
  }

  get current(): QuestionRef {
    return this.refs[this.order[this.index]];
  }

  get total(): number {
    return this.order.length;
  }

  get isLast(): boolean {
    return this.index >= this.order.length - 1;
  }

  get questionTimeLimit(): number | null {
    const own = this.current.q.timeLimit;
    if (own) return own;
    if (this.settings.mode === "rapid") return 8;
    return this.settings.timeLimit;
  }

  shuffledAnswers(q: QuestionRef): Answer[] {
    const key = this.refIndex(q);
    const cached = this.answerCache.get(key);
    if (cached) return cached;
    const ans = [...(q.q.answers ?? [])];
    if (this.settings.shuffleAnswers && q.q.type !== "match") {
      this.seededShuffle(ans, key * 7 + 3);
    }
    this.answerCache.set(key, ans);
    return ans;
  }

  private next() {
    this.index++;
    if (this.index >= this.order.length) {
      if (this.settings.mode === "endless" && this.wrongStack.length) {
        // append wrong ones and continue
        this.order.push(...this.wrongStack.splice(0));
        if (this.index >= this.order.length) return this.finish();
      } else {
        return this.finish();
      }
    }
    this.qStart = performance.now();
    this.timeLimit = this.questionTimeLimit;
    this.qTimeLeft = this.timeLimit ?? 0;
    this.stopQuestionTimer();
    if (this.timeLimit) {
      this.timerId = window.setInterval(() => this.tick(), 100);
    }
  }

  private tick() {
    if (!this.timeLimit || this.finished) return;
    const elapsed = (performance.now() - this.qStart) / 1000;
    this.qTimeLeft = Math.max(0, this.timeLimit - elapsed);
    this.tickListeners.forEach((f) => f(this.qTimeLeft, this.timeLimit!));
    if (this.qTimeLeft <= 0) {
      this.stopQuestionTimer();
      this.cb.onTimeUp(this.current);
    }
  }

  onTick(f: (left: number, total: number) => void) {
    this.tickListeners.add(f);
  }
  offTick(f: (left: number, total: number) => void) {
    this.tickListeners.delete(f);
  }

  private stopQuestionTimer() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /* pause/resume — stops the per-question timer without losing remaining time */
  private pausedAt: number | null = null;
  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  pause() {
    if (this.pausedAt !== null || this.finished) return;
    this.pausedAt = performance.now();
    this.stopQuestionTimer();
  }

  resume() {
    if (this.pausedAt === null || this.finished) return;
    this.qStart += performance.now() - this.pausedAt;
    this.pausedAt = null;
    if (this.timeLimit && !this.finished && this.qTimeLeft > 0) {
      this.timerId = window.setInterval(() => this.tick(), 100);
    }
  }

  destroy() {
    this.stopQuestionTimer();
    if (this.elapsedId !== null) clearInterval(this.elapsedId);
    this.tickListeners.clear();
  }

  /* ---------- answering ---------- */

  submit(answerText: string | null, onHeartbeat?: () => void): AnswerOutcome {
    this.stopQuestionTimer();
    const ref = this.current;
    const timeMs = performance.now() - this.qStart;
    this.times.push(timeMs);
    this.answered.push(answerText);

    const type = ref.q.type ?? "multiple";
    const expected = this.expectedTexts(ref);
    const correct = this.judge(ref, answerText);
    if (correct || type === "open") this.correct++;

    let points = 0;
    let speedBonus = false;
    let multiplier = 1;
    let partial = false;

    if (correct) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.combo++;
      if (this.settings.mode !== "practice") {
        const base = ref.q.points ?? 100;
        multiplier = this.settings.combo ? Math.min(2, 1 + Math.floor(this.combo / 3) * 0.25) : 1;
        let pts = base * multiplier;
        if (this.settings.speedBonus && timeMs < 5000) {
          pts *= 1 + 0.25 * (1 - timeMs / 5000);
          speedBonus = true;
        }
        points = Math.round(pts);
        this.points += points;
      }
    } else {
      this.streak = 0;
      this.combo = 0;
      this.wrongStack.push(this.order[this.index]);
      // partial credit: multi-pick with only correct selections, no wrong ones
      if (this.settings.partialCredit && type === "multi" && answerText && this.settings.mode !== "practice") {
        const picked = new Set(answerText.split("\u0001"));
        const corrects = (ref.q.answers ?? []).filter((a) => a.correct).map((a) => a.text);
        const wrongs = (ref.q.answers ?? []).filter((a) => !a.correct).map((a) => a.text);
        const noWrong = wrongs.every((w) => !picked.has(w));
        const goodPicks = corrects.filter((c) => picked.has(c)).length;
        if (noWrong && goodPicks > 0 && goodPicks < corrects.length) {
          points = Math.round(((ref.q.points ?? 100) * goodPicks) / corrects.length);
          this.points += points;
          partial = true;
        }
      }
      if (!partial && this.settings.mode === "standard" && this.settings.negativeMarking) {
        const penalty = -Math.round((ref.q.points ?? 100) * 0.5);
        points = penalty;
        this.points += penalty;
      }
      if (this.settings.mode === "survival" && !partial) {
        this.hearts--;
        onHeartbeat?.();
        this.cb.onHeartbeat();
        if (this.hearts <= 0) {
          this.over = true;
        }
      }
    }

    this.earned.push(points);

    const rankUp =
      this.settings.streaks && this.streak > 0 && this.streak % 5 === 0;

    return {
      correct,
      points,
      streak: this.streak,
      combo: this.combo,
      multiplier,
      speedBonus,
      rankUp,
      hearts: this.hearts,
      gameOver: this.over,
      timeMs,
      expected,
      explanation: ref.q.explanation,
      partial,
    };
  }

  /* Robust text-answer matcher: exact, normalized, numeric, token, substring, fuzzy. */
  private fillMatches(correctText: string, givenRaw: string): boolean {
    const g = givenRaw.trim().toLowerCase().replace(/\s+/g, " ");
    const accepted = correctText.split("|").map((s) => s.trim().toLowerCase().replace(/\s+/g, " "));
    for (const a of accepted) {
      if (!a) continue;
      if (a === g) return true;
      // normalized alphanumeric equality ("J.F.K." === "jfk", "144." === "144")
      const na = a.replace(/[^a-z0-9]/g, "");
      const ng = g.replace(/[^a-z0-9]/g, "");
      if (na && na === ng) return true;
      // numbers: compare numerically with a small tolerance, and accept when the
      // given number appears as a standalone number inside the correct text
      // (e.g. correctText "12 × 12 = 144" with answer "144")
      const numsA = a.match(/-?\d+(?:[.,]\d+)?/g);
      const numsG = g.match(/-?\d+(?:[.,]\d+)?/g);
      if (numsA && numsG) {
        const nA = Number(numsA[numsA.length - 1].replace(",", "."));
        const nG = Number(numsG[numsG.length - 1].replace(",", "."));
        if (!Number.isNaN(nA) && !Number.isNaN(nG)) {
          const rel = 0.02 * Math.max(1, Math.abs(nA));
          if (Math.abs(nA - nG) <= rel) return true;
          for (const tok of numsG) {
            const re = new RegExp(`(^|[^0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`);
            if (re.test(a)) return true;
          }
        }
      }
      // substring: correct text contains the given word answer
      // ("Mount Everest" accepts "everest"; reject single chars)
      if (g.length >= 3 && a.includes(g)) return true;
      // fuzzy (one typo) — only for real words, never for short number-ish strings
      if (a.length >= 3 && g.length >= 3 && this.fuzzy(a, g)) return true;
    }
    return false;
  }

  private judge(ref: QuestionRef, answerText: string | null): boolean {
    const type = ref.q.type ?? "multiple";
    switch (type) {
      case "multiple":
      case "boolean": {
        const ans = ref.q.answers?.find((a) => a.text === answerText);
        return ans?.correct === true;
      }
      case "multi": {
        if (!answerText) return false;
        const picked = new Set(answerText.split("\u0001"));
        const corrects = (ref.q.answers ?? []).filter((a) => a.correct).map((a) => a.text);
        const wrongs = (ref.q.answers ?? []).filter((a) => !a.correct).map((a) => a.text);
        const noWrong = wrongs.every((w) => !picked.has(w));
        const allCorrect = corrects.every((c) => picked.has(c));
        return noWrong && allCorrect && picked.size > 0;
      }
      case "fill": {
        if (!answerText) return false;
        return this.fillMatches(ref.q.correctText ?? "", answerText);
      }
      case "numeric": {
        if (!answerText) return false;
        // extract numbers from both sides — AIs sometimes wrap the answer
        // in text or equations ("12 × 12 = 144")
        const numsA = (ref.q.correctText ?? "").match(/-?\d+(?:[.,]\d+)?/g);
        const numsG = answerText.match(/-?\d+(?:[.,]\d+)?/g);
        if (!numsA || !numsG) return false;
        const n = Number(numsG[numsG.length - 1].replace(",", "."));
        const target = Number(numsA[numsA.length - 1].replace(",", "."));
        if (Number.isNaN(n) || Number.isNaN(target)) return false;
        const tol = ref.q.tolerance ?? 0.5;
        return Math.abs(n - target) <= tol * Math.max(1, Math.abs(target));
      }
      case "order": {
        if (!answerText) return false;
        const picked = answerText.split("\u0001");
        const original = (ref.q.answers ?? []).map((a) => a.text);
        return picked.length === original.length && picked.every((p, i) => p === original[i]);
      }
      case "match": {
        if (!answerText) return false;
        const pairs = (ref.q.pairs ?? []).map((p) => `${p.left}|||${p.right}`);
        return answerText === pairs.join("\u0001");
      }
      case "open":
        return true;
      case "hotspot": {
        if (!answerText) return false;
        const m = answerText.match(/\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/);
        if (!m) return false;
        const x = Number(m[1]);
        const y = Number(m[2]);
        return (ref.q.hotspots ?? []).some(
          (h) => Math.hypot(h.x - x, h.y - y) <= h.r,
        );
      }
    }
    return false;
  }

  submitHotspot(x: number, y: number, onHeartbeat?: () => void): AnswerOutcome {
    return this.submit(`(${x.toFixed(1)}, ${y.toFixed(1)})`, onHeartbeat);
  }

  submitOpen(isCorrect: boolean): AnswerOutcome {
    const ref = this.current;
    const timeMs = performance.now() - this.qStart;
    this.times.push(timeMs);
    this.answered.push(isCorrect ? "✓" : "✗");
    if (isCorrect) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.combo++;
      this.correct++;
      const base = ref.q.points ?? 100;
      const multiplier = this.settings.combo ? Math.min(2, 1 + Math.floor(this.combo / 3) * 0.25) : 1;
      const pts = this.settings.mode === "practice" ? 0 : Math.round(base * multiplier);
      this.points += pts;
      this.earned.push(pts);
      return {
        correct: true, points: pts, streak: this.streak, combo: this.combo,
        multiplier, speedBonus: false, rankUp: this.streak > 0 && this.streak % 5 === 0,
        hearts: this.hearts, gameOver: this.over, timeMs,
        expected: [], explanation: ref.q.explanation,
      };
    }
    this.streak = 0;
    this.combo = 0;
    this.wrongStack.push(this.order[this.index]);
    this.earned.push(0);
    return {
      correct: false, points: 0, streak: 0, combo: 0, multiplier: 1,
      speedBonus: false, rankUp: false, hearts: this.hearts,
      gameOver: this.over, timeMs, expected: [], explanation: ref.q.explanation,
    };
  }

  /* open: force-correct for review flow */
  forceCorrect() {
    if (!this.answered[this.index]) {
      this.correct++;
      this.answered[this.index] = "✓";
    }
  }

  private fuzzy(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 2) return false;
    let dist = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) dist++;
      if (dist > 1) return false;
    }
    return true;
  }

  expectedTexts(ref: QuestionRef): string[] {
    const type = ref.q.type ?? "multiple";
    switch (type) {
      case "multiple":
      case "boolean":
      case "multi":
        return (ref.q.answers ?? []).filter((a) => a.correct).map((a) => a.text);
      case "fill":
        return (ref.q.correctText ?? "").split("|").map((s) => s.trim());
      case "numeric":
        return [String(ref.q.correctText ?? "")];
      case "order":
        return [(ref.q.answers ?? []).map((a) => a.text).join(" → ")];
      case "match":
        return (ref.q.pairs ?? []).map((p) => `${p.left} ↔ ${p.right}`);
      case "hotspot":
        return (ref.q.hotspots ?? []).map((h) => h.label ?? "target");
      default:
        return [];
    }
  }

  advance(): boolean {
    this.next();
    return !this.finished;
  }

  finish(): QuizResult {
    this.finished = true;
    this.destroy();
    const pct = this.maxPoints > 0 ? (this.points / this.maxPoints) * 100 : this.correct ? 100 : 0;
    const acc = this.refs.length ? (this.correct / this.refs.length) * 100 : 0;
    const raw = this.settings.mode === "practice" ? acc : pct;
    const pass = raw >= (this.quiz.passScore ?? 70);
    return {
      quizId: this.quiz.title,
      quizTitle: this.quiz.title,
      accent: this.quiz.accent ?? "#e60012",
      date: Date.now(),
      total: this.refs.length,
      correct: this.correct,
      points: this.points,
      maxPoints: this.maxPoints,
      timeMs: this.elapsedMs,
      bestStreak: this.bestStreak,
      rank: rankFor(raw).key as RankKey,
      pass,
      perQuestion: this.refs.map((_, i) => {
        const played = this.refs[this.order[i]] ?? this.refs[i];
        return {
          section: played.section,
          question: played.q.question,
          correct: this.wasCorrect(i),
          points: this.earned[i] ?? 0,
          ms: this.times[i] ?? 0,
          answer: this.answered[i] ?? undefined,
          correctAnswer: this.expectedTexts(played).join(", "),
          explanation: played.q.explanation,
          flagged: this.flags.includes(this.order[i]),
        };
      }),
    };
  }

  private wasCorrect(i: number): boolean {
    const ref = this.refs[this.order[i]];
    const type = ref.q.type ?? "multiple";
    const ans = this.answered[i];
    if (ans === null || ans === undefined) return false;
    return this.judge(ref, ans) || ans === "✓" || (type === "open" && ans === "✓");
  }

  /* ---------- lifelines ---------- */
  fiftyLeft = 1;
  skipLeft = 2;

  /** "ok" = usable · "used" = already spent · "na" = can't help on this question */
  fiftyStatus(): "ok" | "used" | "na" {
    const ref = this.current;
    if (this.fiftyLeft <= 0) return "used";
    if (!["multiple", "boolean"].includes(ref.q.type ?? "")) return "na";
    const wrong = (ref.q.answers ?? []).filter((a) => !a.correct);
    if (wrong.length <= 1 || (ref.q.answers ?? []).length <= 2) return "na";
    return "ok";
  }

  useFifty(): Answer[] | null {
    if (this.fiftyStatus() !== "ok") return null;
    const ref = this.current;
    const wrong = (ref.q.answers ?? []).filter((a) => !a.correct);
    this.fiftyLeft--;
    // leave exactly one wrong answer standing
    const remove = wrong.slice(0, Math.max(1, wrong.length - 1));
    return remove;
  }

  useSkip(): boolean {
    if (this.skipLeft <= 0) return false;
    this.skipLeft--;
    this.answered.push(null);
    this.earned.push(0);
    this.times.push(performance.now() - this.qStart);
    return true;
  }
}
