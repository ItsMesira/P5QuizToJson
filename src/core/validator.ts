/* ============ P5 QUIZ — VALIDATOR & NORMALIZER ============ */
import type { Answer, MatchPair, Question, QuestionType, Quiz, QuizSettings, Section } from "./types";
import { DEFAULT_QUIZ_SETTINGS } from "./types";
import { t } from "./i18n";

export interface FieldError {
  path: string;
  message: string;
}

export type Validation = { ok: true; quiz: Quiz } | { ok: false; errors: FieldError[] };

const TYPES: QuestionType[] = [
  "multiple", "multi", "boolean", "fill", "order", "match", "numeric", "open", "hotspot",
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* Only https or inline images may reach an <img src> — blocks http/privacy
   leaks and non-image schemes from untrusted quiz JSON. */
const IMG_RE = /^(https:\/\/|data:image\/)/i;
function safeImage(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return IMG_RE.test(s) ? s : undefined;
}

/* Accepts loose formats: `{options: [{text, correct}]}`, `{choices: [...]}`, plain answer strings. */
function normalizeAnswer(a: unknown): Answer | null {
  if (typeof a === "string") return { text: a, correct: false };
  if (!isObj(a) || typeof a.text !== "string") return null;
  return { text: a.text, correct: a.correct === true };
}

/* The correct answer as a string, pulled from every field name AIs use. */
function answerField(q: Record<string, unknown>): string | null {
  const v = q.answer ?? q.correct_answer ?? q.correctAnswer ?? q.answerKey ?? null;
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

/* Correct answers as an ARRAY (multi-pick quizzes from AIs). */
function answersField(q: Record<string, unknown>): string[] | null {
  const v = q.correct_answers ?? q.correctAnswers ?? null;
  if (!Array.isArray(v)) return null;
  return v
    .map((x) => (typeof x === "string" ? x.trim() : isObj(x) && typeof x.text === "string" ? x.text.trim() : null))
    .filter((x): x is string => x !== null && x !== "");
}

function detectType(q: Record<string, unknown>): QuestionType {
  if (typeof q.type === "string" && (TYPES as string[]).includes(q.type)) return q.type as QuestionType;
  if (q.pairs) return "match";
  if (q.hotspots) return "hotspot";
  const ans = (q.answers ?? q.options ?? q.choices ?? []) as unknown[];
  if (Array.isArray(ans) && ans.length > 0) {
    const corrects = ans.filter((a) => isObj(a) && a.correct === true).length;
    const multi = answersField(q);
    if (multi && multi.length > 1) return "multi";
    if (corrects > 1) return "multi";
    if (corrects === 1 && ans.length === 2) {
      const t = ans.map((a) => (isObj(a) ? String(a.text).toLowerCase() : typeof a === "string" ? a.toLowerCase() : ""));
      if (t.includes("true") || t.includes("false") || t.includes("yes") || t.includes("no")) return "boolean";
    }
    return "multiple";
  }
  if (typeof q.answer === "number") return "numeric";
  if (q.correctText || answerField(q)) return "fill";
  return "open";
}

function normalizeQuestion(raw: unknown, path: string): { q?: Question; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (!isObj(raw)) return { errors: [{ path, message: t("Question must be an object.") }] };
  if (typeof raw.question !== "string" || !raw.question.trim()) {
    errors.push({ path, message: t("Missing \"question\" text.") });
  }
  const type = detectType(raw);
  const q: Question = {
    type,
    question: String(raw.question ?? "").trim(),
    explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
    hint: typeof raw.hint === "string" ? raw.hint : undefined,
    image: safeImage(raw.image),
    difficulty: raw.difficulty === 2 ? 2 : raw.difficulty === 3 ? 3 : 1,
    points: typeof raw.points === "number" && raw.points > 0 ? raw.points : 100,
    tolerance: typeof raw.tolerance === "number" ? raw.tolerance : 0.5,
    timeLimit: typeof raw.timeLimit === "number" && raw.timeLimit > 0 ? raw.timeLimit : undefined,
  };

  if (type === "multiple" || type === "multi" || type === "boolean") {
    const rawAns = (raw.answers ?? raw.options ?? raw.choices ?? []) as unknown[];
    const answers = rawAns.map(normalizeAnswer).filter((a): a is Answer => a !== null);
    if (answers.length < 2) errors.push({ path: `${path}.answers`, message: t("Needs at least 2 answers.") });
    // infer correctness when AIs used answer_index / answer / correctAnswers instead of flags
    if (answers.length >= 2 && answers.filter((a) => a.correct).length === 0) {
      const idx = typeof raw.answer_index === "number" ? raw.answer_index : undefined;
      const one = answerField(raw);
      const many = answersField(raw);
      if (idx !== undefined && answers[idx]) {
        answers[idx].correct = true;
      } else if (many) {
        const set = new Set(many.map((m) => m.toLowerCase()));
        answers.forEach((a) => {
          if (set.has(a.text.toLowerCase())) a.correct = true;
        });
      } else if (one) {
        const hit = answers.find((a) => a.text.toLowerCase() === one.toLowerCase());
        if (hit) hit.correct = true;
      }
    }
    const corrects = answers.filter((a) => a.correct).length;
    if (type === "multi" && corrects < 2)
      errors.push({ path: `${path}.answers`, message: t("\"multi\" needs 2+ correct answers.") });
    if (type !== "multi" && corrects !== 1)
      errors.push({ path: `${path}.answers`, message: t("Needs exactly 1 correct answer (found {n}).", { n: corrects }) });
    q.answers = answers;
  } else if (type === "fill") {
    const ct = q.correctText ?? raw.correctText ?? raw.correct_text ?? answerField(raw);
    q.correctText = typeof ct === "number" ? String(ct) : typeof ct === "string" ? ct : "";
    if (!q.correctText)
      errors.push({ path: `${path}.correctText`, message: t("Fill-in needs \"correctText\" (or \"answer\").") });
  } else if (type === "order") {
    const rawAns = (raw.answers ?? raw.options ?? raw.choices ?? []) as unknown[];
    const answers = rawAns.map(normalizeAnswer).filter((a): a is Answer => a !== null);
    if (answers.length < 2) errors.push({ path: `${path}.answers`, message: t("Order needs 2+ answers (listed in correct order).") });
    q.answers = answers;
  } else if (type === "match") {
    const pairs = (raw.pairs ?? []) as unknown[];
    const good = pairs
      .map(normalizePair)
      .filter((p): p is MatchPair => p !== null);
    if (good.length < 2) errors.push({ path: `${path}.pairs`, message: t("Match needs 2+ pairs.") });
    q.pairs = good;
  } else if (type === "numeric") {
    const v = answerField(raw);
    const nums = v ? v.replace(",", ".").match(/-?\d+(?:\.\d+)?/g) : null;
    if (v && nums && nums.length) {
      q.correctText = nums[nums.length - 1];
    } else {
      errors.push({ path: `${path}.answer`, message: t("Numeric needs a numeric \"answer\".") });
    }
  } else if (type === "hotspot") {
    const hs = (raw.hotspots ?? []) as unknown[];
    if (!hs.length) errors.push({ path: `${path}.hotspots`, message: t("Hotspot needs at least one hotspot.") });
    q.hotspots = hs.filter(isObj).map((h) => ({
      x: Number(h.x) || 50,
      y: Number(h.y) || 50,
      r: Number(h.r) || 8,
      label: typeof h.label === "string" ? h.label : undefined,
    }));
    q.answers = q.hotspots.map((h) => ({ text: h.label ?? `(${h.x}, ${h.y})`, correct: true }));
  }
  if (errors.length === 0 && !q.question && type === "open") {
    errors.push({ path, message: t("Question needs text.") });
  }
  return { q, errors };
}

function normalizePair(p: unknown): MatchPair | null {
  if (!isObj(p)) return null;
  if (typeof p.left === "string" && typeof p.right === "string") return { left: p.left, right: p.right };
  return null;
}

export function validateQuiz(raw: unknown): Validation {
  const errors: FieldError[] = [];
  if (!isObj(raw)) return { ok: false, errors: [{ path: "$", message: "Root must be a JSON object." }] };
  if (typeof raw.title !== "string" || !raw.title.trim()) {
    errors.push({ path: "$.title", message: t("Missing \"title\".") });
  }
  let sectionsRaw: unknown[] = [];
  if (Array.isArray(raw.sections)) {
    sectionsRaw = raw.sections as unknown[];
  } else if (Array.isArray(raw.questions)) {
    sectionsRaw = [{ name: "Main", questions: raw.questions }];
  } else {
    errors.push({ path: "$.sections", message: t("Missing \"sections\" (or \"questions\") array.") });
  }

  const sections: Section[] = [];
  sectionsRaw.forEach((s, i) => {
    const path = `$.sections[${i}]`;
    if (!isObj(s) || !Array.isArray(s.questions)) {
      errors.push({ path, message: t("Section must have a \"questions\" array.") });
      return;
    }
    const qs: Question[] = [];
    (s.questions as unknown[]).forEach((qq, j) => {
      const { q, errors: qErr } = normalizeQuestion(qq, `${path}.questions[${j}]`);
      if (q) qs.push(q);
      errors.push(...qErr);
    });
    sections.push({ name: typeof s.name === "string" && s.name ? s.name : `Section ${i + 1}`, questions: qs });
  });

  const total = sections.reduce((n, s) => n + s.questions.length, 0);
  if (total === 0 && !errors.some((e) => e.path.includes("sections"))) {
    errors.push({ path: "$.sections", message: t("The quiz has zero questions.") });
  }

  if (errors.length) return { ok: false, errors };

  // authors who disable "shuffle" almost always mean everything stays in order
  const userSettings = isObj(raw.settings) ? { ...(raw.settings as Partial<QuizSettings>) } : {};
  if (userSettings.shuffle === false && userSettings.shuffleAnswers === undefined) {
    userSettings.shuffleAnswers = false;
  }
  const quiz: Quiz = {
    title: String(raw.title).trim(),
    description: typeof raw.description === "string" ? raw.description : undefined,
    accent: typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent : "#e60012",
    cover: safeImage(raw.cover),
    author: typeof raw.author === "string" ? raw.author : undefined,
    passScore: typeof raw.passScore === "number" ? Math.max(0, Math.min(100, raw.passScore)) : 70,
    settings: { ...DEFAULT_QUIZ_SETTINGS, ...userSettings },
    sections,
  };
  return { ok: true, quiz };
}

export function totalQuestions(quiz: Quiz): number {
  return quiz.sections.reduce((n, s) => n + s.questions.length, 0);
}
