/* ============ P5 QUIZ — QUIZ JSON AUTO-REPAIR ============ */
/* Deterministic, offline repair for pasted/file/URL quizzes: recovers broken
   JSON syntax, un-wraps odd shapes, and fixes the content errors the validator
   still rejects (missing/extra correct answers, aliased fields, duplicates).
   Never invents or drops questions; every change is listed in `report`. */
import { jsonrepair } from "jsonrepair";
import { validateQuiz, type FieldError } from "./validator";
import type { Answer, QuestionType, Quiz } from "./types";
import { t } from "./i18n";

export type RepairOutcome =
  | { ok: true; quiz: Quiz; report: string[] }
  | { ok: false; errors: FieldError[]; report: string[] };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return ["true", "yes", "y", "correct", "1"].includes(v.trim().toLowerCase());
  return false;
}

const TYPE_MAP: Record<string, QuestionType> = {
  single: "multiple", single_choice: "multiple", singlechoice: "multiple", "single-choice": "multiple",
  multiple_choice: "multiple", "multiple-choice": "multiple", mcq: "multiple", choice: "multiple",
  multi_select: "multi", "multi-select": "multi", multiselect: "multi", multiple_select: "multi",
  multiple_selects: "multi", checkbox: "multi", "select-all": "multi",
  boolean: "boolean", true_false: "boolean", "true-false": "boolean", truefalse: "boolean", tf: "boolean",
  fill: "fill", fill_blank: "fill", "fill-blank": "fill", "fill-in-the-blank": "fill", fillintheblank: "fill",
  fillblank: "fill", short_answer: "fill", shortanswer: "fill", "short-answer": "fill", text: "fill",
  numeric: "numeric", number: "numeric", integer: "numeric", calculation: "numeric",
  order: "order", ordering: "order", sequence: "order", sort: "order",
  match: "match", matching: "match", pairing: "match",
  open: "open", essay: "open", free: "open", "free-response": "open", freeresponse: "open",
  hotspot: "hotspot",
};

const SECTION_KEYS = ["parts", "chapters"];
const QUESTION_KEYS = ["items", "qs"];
const hasBody = (x: Obj): boolean =>
  x.sections !== undefined || x.questions !== undefined || x.parts !== undefined || x.chapters !== undefined;

/* --- 1. text → value: fence/prose stripping + tolerant parse --------------- */
export function parseLoose(text: string): { value: unknown; report: string[] } {
  const report: string[] = [];
  let body = text.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    body = fence[1].trim();
    report.push(t("Removed text around the JSON"));
  } else {
    const first = body.search(/[{[]/);
    if (first >= 0) {
      const last = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
      if (first > 0 || last < body.length - 1) {
        body = body.slice(first, last >= first ? last + 1 : undefined).trim();
        report.push(t("Removed text around the JSON"));
      }
    }
  }

  try {
    return { value: JSON.parse(body), report };
  } catch {
    /* fall through to jsonrepair */
  }
  const fixed = jsonrepair(body);
  report.push(t("Fixed broken JSON syntax"));
  return { value: JSON.parse(fixed), report };
}

/* --- 2. value → { title, sections: [{ name, questions: [] }] } ------------ */
export function repairShape(input: unknown, report: string[]): Obj {
  let v: unknown = input;

  if (isObj(v)) {
    for (const k of ["quiz", "data", "result", "payload", "output"]) {
      const inner = v[k];
      if (isObj(inner) && !hasBody(v) && hasBody(inner)) {
        v = inner;
        report.push(t("Unwrapped a nested quiz object"));
        break;
      }
    }
  }

  if (Array.isArray(v)) {
    v = { title: t("Repaired Quiz"), sections: [{ name: "Main", questions: v }] };
    report.push(t("Wrapped the questions in a section"));
  }
  if (!isObj(v)) {
    v = { title: t("Repaired Quiz"), sections: [] };
  }
  const o = v as Obj;

  if (typeof o.title !== "string" || !o.title.trim()) {
    o.title = typeof o.name === "string" && o.name.trim() ? o.name : t("Repaired Quiz");
    report.push(t("Filled in a missing title"));
  }

  if (o.sections === undefined) {
    for (const k of SECTION_KEYS) {
      if (o[k] !== undefined) {
        o.sections = o[k];
        report.push(t("Converted sections to a list"));
        break;
      }
    }
  }
  if (o.sections === undefined) {
    for (const k of ["questions", "items"]) {
      if (o[k] !== undefined) {
        o.sections = [{ name: "Main", questions: o[k] }];
        report.push(t("Wrapped the questions in a section"));
        break;
      }
    }
  }

  const rawSections = o.sections;
  let sections: unknown[];
  if (Array.isArray(rawSections)) sections = rawSections;
  else if (isObj(rawSections)) {
    sections = Object.entries(rawSections).map(([name, qs]) => ({ name, questions: qs }));
    report.push(t("Converted sections to a list"));
  } else sections = [];

  o.sections = sections.map((s, i) => {
    if (Array.isArray(s)) return { name: `Section ${i + 1}`, questions: s };
    const sec: Obj = isObj(s) ? s : {};
    if (sec.name === undefined && typeof sec.title === "string") sec.name = sec.title;
    if (sec.questions === undefined) {
      for (const k of QUESTION_KEYS) {
        if (sec[k] !== undefined) {
          sec.questions = sec[k];
          report.push(t("Wrapped the questions in a section"));
          break;
        }
      }
    }
    let qs = sec.questions;
    if (isObj(qs)) {
      qs = Object.values(qs);
      report.push(t("Wrapped the questions in a section"));
    }
    sec.questions = Array.isArray(qs) ? qs : [];
    if (typeof sec.name !== "string" || !sec.name) sec.name = `Section ${i + 1}`;
    return sec;
  });

  return o;
}

/* --- 3. content: aliased fields, answer flags, duplicates ----------------- */
function coerceAnswer(v: unknown): Answer | null {
  if (typeof v === "string") return { text: v, correct: false };
  if (typeof v === "number") return { text: String(v), correct: false };
  if (!isObj(v)) return null;
  const text = v.text ?? v.answer ?? v.value ?? v.label ?? v.option ?? v.content;
  if (typeof text !== "string" && typeof text !== "number") return null;
  const correct =
    truthy(v.correct) || truthy(v.is_correct) || truthy(v.isCorrect) || truthy(v.right) || truthy(v.isTrue);
  return { text: String(text), correct };
}

function idxFor(spec: number | string, n: number): number | null {
  if (typeof spec === "number") {
    if (Number.isInteger(spec) && spec >= 0 && spec < n) return spec;
    if (Number.isInteger(spec) && spec >= 1 && spec <= n) return spec - 1;
    return null;
  }
  const s = spec.trim();
  const letter = s.match(/^([A-Za-z])(?:[).:\-\s].*)?$/);
  if (letter) {
    const i = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < n) return i;
  }
  if (/^\d+$/.test(s)) {
    const v = Number(s);
    if (v >= 0 && v < n) return v;
    if (v >= 1 && v <= n) return v - 1;
  }
  return null;
}

function markCorrect(answers: Answer[], spec: unknown): boolean {
  const hit = (a: Answer, s: string): boolean => s.trim().toLowerCase() === a.text.trim().toLowerCase();
  if (Array.isArray(spec)) {
    let any = false;
    for (const s of spec) {
      if (typeof s === "number") {
        const i = idxFor(s, answers.length);
        if (i !== null) answers[i].correct = true;
        any = any || i !== null;
      } else if (typeof s === "string") {
        const match = answers.find((a) => hit(a, s));
        if (match) match.correct = true;
        else {
          const i = idxFor(s, answers.length);
          if (i !== null) answers[i].correct = true;
        }
        any = true;
      }
    }
    return any;
  }
  if (typeof spec === "number") {
    const i = idxFor(spec, answers.length);
    if (i === null) return false;
    answers[i].correct = true;
    return true;
  }
  if (typeof spec === "string") {
    const match = answers.find((a) => hit(a, spec));
    if (match) {
      match.correct = true;
      return true;
    }
    const i = idxFor(spec, answers.length);
    if (i === null) return false;
    answers[i].correct = true;
    return true;
  }
  return false;
}

export function repairContent(o: Obj, report: string[]): Obj {
  const sections = Array.isArray(o.sections) ? (o.sections as unknown[]) : [];
  let mapped = false;
  let inferred = false;
  let trimmed = false;
  let deduped = false;

  for (const s of sections) {
    if (!isObj(s) || !Array.isArray(s.questions)) continue;
    for (const raw of s.questions) {
      if (!isObj(raw)) continue;
      const q = raw as Obj;

      if (typeof q.question !== "string" || !q.question.trim()) {
        const alt = q.q ?? q.prompt ?? q.stem ?? q.text ?? q.title;
        if (typeof alt === "string") {
          q.question = alt;
          mapped = true;
        }
      }
      if (typeof q.explanation !== "string") {
        const alt = q.explain ?? q.rationale ?? q.reason ?? q.why;
        if (typeof alt === "string") {
          q.explanation = alt;
          mapped = true;
        }
      }
      if (typeof q.hint !== "string") {
        const alt = q.clue ?? q.tip;
        if (typeof alt === "string") {
          q.hint = alt;
          mapped = true;
        }
      }
      if (typeof q.points !== "number") {
        const alt = q.score ?? q.marks;
        if (typeof alt === "number") {
          q.points = alt;
          mapped = true;
        }
      }
      if (typeof q.type === "string") {
        const t2 = TYPE_MAP[q.type.toLowerCase()];
        if (t2 && t2 !== q.type) {
          q.type = t2;
          mapped = true;
        }
      }
      if (typeof q.correctText !== "string") {
        const alt = q.correct_text ?? q.correctText;
        if (typeof alt === "string") {
          q.correctText = alt;
          mapped = true;
        }
      }

      const src = q.answers ?? q.options ?? q.choices ?? q.answerOptions ?? q.answer_options;
      let answers: Answer[] = [];
      if (Array.isArray(src)) {
        answers = src.map(coerceAnswer).filter((a): a is Answer => a !== null);
      } else if (isObj(src)) {
        answers = Object.entries(src)
          .map(([k, v]) => {
            const a = coerceAnswer(v);
            if (a && !a.text.trim() && /^[A-Za-z]$/.test(k.trim())) a.text = k;
            return a;
          })
          .filter((a): a is Answer => a !== null);
        if (answers.length) mapped = true;
      }

      if (answers.length) {
        const seen = new Map<string, Answer>();
        for (const a of answers) {
          const key = a.text.trim().toLowerCase();
          const prev = seen.get(key);
          if (prev) {
            prev.correct = prev.correct || a.correct;
            deduped = true;
          } else seen.set(key, a);
        }
        answers = [...seen.values()];

        const single = q.type === "multiple" || q.type === "boolean";
        let nCorrect = answers.filter((a) => a.correct).length;

        if (nCorrect === 0) {
          const spec =
            q.answer ?? q.answer_index ?? q.answerIndex ?? q.correct_index ?? q.correctIndex ??
            q.correctAnswer ?? q.correct_answer ?? q.answerKey ?? q.correct_answers ?? q.correctAnswers ?? q.correct;
          if (spec !== undefined && markCorrect(answers, spec)) inferred = true;
          nCorrect = answers.filter((a) => a.correct).length;
          if (nCorrect === 0) {
            answers[0].correct = true;
            inferred = true;
            const note = t("Verify this answer — the correct choice was not marked in the source.");
            q.explanation =
              typeof q.explanation === "string" && q.explanation.trim()
                ? `${q.explanation}\n\n(${note})`
                : `(${note})`;
          }
        } else if (single && nCorrect > 1) {
          let kept = false;
          for (const a of answers) {
            if (!a.correct) continue;
            if (kept) a.correct = false;
            else kept = true;
          }
          trimmed = true;
        }

        q.answers = answers;
      }
    }
  }

  if (mapped) report.push(t("Mapped the answers to the standard format"));
  if (inferred) report.push(t("Inferred the correct answer"));
  if (trimmed) report.push(t("Trimmed extra correct answers"));
  if (deduped) report.push(t("Removed duplicate answer options"));
  return o;
}

/* --- entry point ----------------------------------------------------------- */
export function repairQuiz(input: string | unknown): RepairOutcome {
  const report: string[] = [];
  let raw: unknown;
  try {
    if (typeof input === "string") {
      const parsed = parseLoose(input);
      raw = parsed.value;
      report.push(...parsed.report);
    } else {
      raw = JSON.parse(JSON.stringify(input));
    }
  } catch {
    return {
      ok: false,
      errors: [{ path: "$", message: t("Not valid JSON — check commas and quotes.") }],
      report,
    };
  }

  const shaped = repairShape(raw, report);
  const content = repairContent(shaped, report);
  const v = validateQuiz(content);
  if (v.ok) return { ok: true, quiz: v.quiz, report };
  return { ok: false, errors: v.errors, report };
}