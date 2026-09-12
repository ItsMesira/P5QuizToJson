/* ============ P5 QUIZ — TYPES & SCHEMA ============ */

export type QuestionType =
  | "multiple"
  | "multi"
  | "boolean"
  | "fill"
  | "order"
  | "match"
  | "numeric"
  | "open"
  | "hotspot";

export type QuizMode = "standard" | "practice" | "survival" | "rapid" | "endless";
export type FeedbackMode = "instant" | "end";
export type FxLevel = "subtle" | "theatrical" | "maximum";

export interface Answer {
  text: string;
  correct?: boolean;
}

export interface MatchPair {
  left: string;
  right: string;
}

export interface Hotspot {
  x: number; // 0..100 (% of image width)
  y: number; // 0..100
  r: number; // radius in % of image width
  label?: string;
}

export interface Question {
  type?: QuestionType;
  question: string;
  answers?: Answer[];
  pairs?: MatchPair[];
  hotspots?: Hotspot[];
  image?: string;
  explanation?: string;
  difficulty?: 1 | 2 | 3;
  points?: number;
  hint?: string;
  tolerance?: number; // for numeric
  correctText?: string; // for fill: accepted answers
  timeLimit?: number; // seconds, overrides quiz default
}

export interface Section {
  name: string;
  questions: Question[];
}

export interface QuizSettings {
  mode: QuizMode;
  timeLimit: number | null; // seconds per question, null = off
  shuffle: boolean;
  shuffleAnswers: boolean;
  streaks: boolean;
  combo: boolean;
  speedBonus: boolean;
  lifelines: boolean;
  negativeMarking: boolean;
  partialCredit: boolean;
  feedback: FeedbackMode;
  fx: FxLevel;
}

export interface Quiz {
  title: string;
  description?: string;
  accent?: string;
  cover?: string;
  author?: string;
  passScore?: number; // 0..100
  settings?: Partial<QuizSettings>;
  sections: Section[];
}

export interface QuestionRef {
  section: string;
  index: number; // index within section
  q: Question;
}

export interface QuizResult {
  quizId: string;
  quizTitle: string;
  accent: string;
  date: number;
  total: number;
  correct: number;
  points: number;
  maxPoints: number;
  timeMs: number;
  bestStreak: number;
  rank: RankKey;
  pass: boolean;
  perQuestion: {
    section: string;
    question: string;
    correct: boolean;
    points: number;
    ms: number;
    answer?: string;
    correctAnswer?: string;
    explanation?: string;
    flagged: boolean;
  }[];
}

export type RankKey = "S" | "A" | "B" | "C" | "D" | "F";

export interface RankInfo {
  key: RankKey;
  label: string;
  minPct: number;
  color: string;
}

export const RANKS: RankInfo[] = [
  { key: "S", label: "PHANTOM", minPct: 95, color: "#ffd76a" },
  { key: "A", label: "ACE", minPct: 85, color: "#e8b93b" },
  { key: "B", label: "BURGLAR", minPct: 70, color: "#f6f4f0" },
  { key: "C", label: "PICKPOCKET", minPct: 55, color: "#cfcac1" },
  { key: "D", label: "ROOKIE", minPct: 40, color: "#8a8a93" },
  { key: "F", label: "CAUGHT", minPct: 0, color: "#e60012" },
];

export function rankFor(pct: number): RankInfo {
  return RANKS.find((r) => pct >= r.minPct) ?? RANKS[RANKS.length - 1];
}

export interface Settings {
  fx: FxLevel;
  particles: boolean;
  shake: boolean;
  slowmo: boolean;
  crt: boolean;
  music: boolean;
  bgm: "authentic" | "synth";
  sfx: boolean;
  volume: number; // 0..1
  autoAdvance: boolean;
  fullscreen: boolean;
  reducedMotion: boolean;
}

export interface Profile {
  id: string;
  name: string;
  xp: number;
  created: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  check: (r: QuizResult) => boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fx: "maximum",
  particles: true,
  shake: true,
  slowmo: true,
  crt: false,
  music: true,
  bgm: "authentic",
  sfx: true,
  volume: 0.7,
  autoAdvance: false,
  fullscreen: false,
  reducedMotion: false,
};

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  mode: "standard",
  timeLimit: null,
  shuffle: true,
  shuffleAnswers: true,
  streaks: true,
  combo: true,
  speedBonus: true,
  lifelines: true,
  negativeMarking: false,
  partialCredit: true,
  feedback: "instant",
  fx: "maximum",
};
