/* ============ P5 QUIZ API — SERVER-SIDE GRADING ============
   Pure, dependency-free mirror of the client engine's answer judging, used to
   recompute class-quiz scores on the server so the leaderboard cannot be
   forged by a tampered client. Keep in sync with src/engine/quiz.ts. */

export interface GAnswer {
  text: string;
  correct?: boolean;
}
export interface GQuestion {
  type?: string;
  answers?: GAnswer[];
  correctText?: string;
  pairs?: { left: string; right: string }[];
  hotspots?: { x: number; y: number; r: number; label?: string }[];
  tolerance?: number;
  points?: number;
}
export interface GSection {
  name: string;
  questions: GQuestion[];
}
export interface GQuiz {
  sections: GSection[];
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fuzzy(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let dist = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) dist++;
    if (dist > 1) return false;
  }
  return true;
}

function fillMatches(correctText: string, givenRaw: string): boolean {
  const g = normalize(givenRaw);
  const accepted = correctText.split("|").map((s) => normalize(s));
  for (const a of accepted) {
    if (!a) continue;
    if (a === g) return true;
    const na = a.replace(/[^a-z0-9]/g, "");
    const ng = g.replace(/[^a-z0-9]/g, "");
    if (na && na === ng) return true;
    const numsA = a.match(/-?\d+(?:[.,]\d+)?/g);
    const numsG = g.match(/-?\d+(?:[.,]\d+)?/g);
    if (numsA && numsG) {
      const nA = Number(numsA[numsA.length - 1].replace(",", "."));
      const nG = Number(numsG[numsG.length - 1].replace(",", "."));
      if (!Number.isNaN(nA) && !Number.isNaN(nG)) {
        const rel = 0.02 * Math.max(1, Math.abs(nA));
        if (Math.abs(nA - nG) <= rel) return true;
      }
    }
    if (g.length >= 3 && a.includes(g)) return true;
    if (a.length >= 3 && g.length >= 3 && fuzzy(a, g)) return true;
  }
  return false;
}

export function expectedTexts(q: GQuestion): string[] {
  switch (q.type ?? "multiple") {
    case "multiple":
    case "boolean":
    case "multi":
      return (q.answers ?? []).filter((a) => a.correct).map((a) => a.text);
    case "fill":
      return (q.correctText ?? "").split("|").map((s) => s.trim());
    case "numeric":
      return [String(q.correctText ?? "")];
    case "order":
      return [(q.answers ?? []).map((a) => a.text).join(" → ")];
    case "match":
      return (q.pairs ?? []).map((p) => `${p.left} ↔ ${p.right}`);
    case "hotspot":
      return (q.hotspots ?? []).map((h) => h.label ?? "target");
    default:
      return [];
  }
}

export function judge(q: GQuestion, answerText: string | null): boolean {
  const type = q.type ?? "multiple";
  switch (type) {
    case "multiple":
    case "boolean": {
      const ans = (q.answers ?? []).find((a) => a.text === answerText);
      return ans?.correct === true;
    }
    case "multi": {
      if (!answerText) return false;
      const picked = new Set(answerText.split("\u0001"));
      const corrects = (q.answers ?? []).filter((a) => a.correct).map((a) => a.text);
      const wrongs = (q.answers ?? []).filter((a) => !a.correct).map((a) => a.text);
      const noWrong = wrongs.every((w) => !picked.has(w));
      const allCorrect = corrects.every((c) => picked.has(c));
      return noWrong && allCorrect && picked.size > 0;
    }
    case "fill":
      return answerText ? fillMatches(q.correctText ?? "", answerText) : false;
    case "numeric": {
      if (!answerText) return false;
      const na = (q.correctText ?? "").match(/-?\d+(?:[.,]\d+)?/g);
      const ng = answerText.match(/-?\d+(?:[.,]\d+)?/g);
      if (!na || !ng) return false;
      const target = Number(na[na.length - 1].replace(",", "."));
      const given = Number(ng[ng.length - 1].replace(",", "."));
      if (Number.isNaN(target) || Number.isNaN(given)) return false;
      const tol = q.tolerance ?? 0.5;
      return Math.abs(given - target) <= tol * Math.max(1, Math.abs(target));
    }
    case "order": {
      if (!answerText) return false;
      const picked = answerText.split("\u0001");
      const original = (q.answers ?? []).map((a) => a.text);
      return picked.length === original.length && picked.every((p, i) => p === original[i]);
    }
    case "match": {
      if (!answerText) return false;
      const pairs = (q.pairs ?? []).map((p) => `${p.left}|||${p.right}`);
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
      return (q.hotspots ?? []).some((h) => Math.hypot(h.x - x, h.y - y) <= h.r);
    }
    default:
      return false;
  }
}

export interface GradeResult {
  correct: number;
  total: number;
  points: number;
  maxPoints: number;
  rank: string;
  perQuestion: { q: number; correct: boolean }[];
}

/* answers[i] corresponds to the i-th question of the flattened quiz. */
export function gradeQuiz(quiz: GQuiz, answers: (string | null)[]): GradeResult {
  const flat: GQuestion[] = [];
  for (const s of quiz.sections ?? []) for (const q of s.questions ?? []) flat.push(q);
  let correct = 0;
  let points = 0;
  let maxPoints = 0;
  const perQuestion: { q: number; correct: boolean }[] = [];
  flat.forEach((q, i) => {
    maxPoints += q.points ?? 100;
    const ok = judge(q, answers[i] ?? null);
    if (ok) {
      correct++;
      points += q.points ?? 100;
    }
    perQuestion.push({ q: i, correct: ok });
  });
  const pct = maxPoints > 0 ? (points / maxPoints) * 100 : correct ? 100 : 0;
  const rank = pct >= 95 ? "S" : pct >= 85 ? "A" : pct >= 70 ? "B" : pct >= 55 ? "C" : pct >= 40 ? "D" : "F";
  return { correct, total: flat.length, points, maxPoints, rank, perQuestion };
}