/* ============ P5 QUIZ — LOCAL STORAGE ============ */
import type { Profile, Quiz, QuizResult, Settings } from "./types";
import type { Preset } from "./prompts";
import { DEFAULT_SETTINGS } from "./types";

const K = {
  quizzes: "p5q.quizzes",
  settings: "p5q.settings",
  scores: "p5q.scores",
  xp: "p5q.xp",
  achievements: "p5q.achievements",
  profiles: "p5q.profiles",
  profile: "p5q.profile",
  progress: "p5q.progress",
  promptHistory: "p5q.promptHistory",
  promptFavs: "p5q.promptFavs",
  customPresets: "p5q.customPresets",
  topicStats: "p5q.topicStats",
  goals: "p5q.goals",
};

export interface SavedQuiz {
  id: string;
  quiz: Quiz;
  savedAt: number;
  source: string; // file name / url / "sample"
}

/* Every localStorage touch goes through these two. Bare localStorage calls throw
   in storage-restricted contexts (Safari private mode, embedded webviews, a full
   quota), and an uncaught throw at the top of a screen mount used to replace the
   whole screen with "Something broke on that screen". */
function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / storage unavailable — ignore */
  }
}
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}
function removeRaw(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — ignore */
  }
}

/* ---------- quizzes ---------- */
export function savedQuizzes(): SavedQuiz[] {
  return read<SavedQuiz[]>(K.quizzes, []);
}
export function saveQuiz(quiz: Quiz, source: string): SavedQuiz {
  const list = savedQuizzes();
  const existing = list.find((s) => s.quiz.title === quiz.title && s.source === source);
  if (existing) {
    existing.quiz = quiz;
    existing.savedAt = Date.now();
    write(K.quizzes, list);
    return existing;
  }
  const entry: SavedQuiz = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    quiz,
    savedAt: Date.now(),
    source,
  };
  list.unshift(entry);
  write(K.quizzes, list.slice(0, 60));
  return entry;
}
export function deleteQuiz(id: string) {
  write(K.quizzes, savedQuizzes().filter((s) => s.id !== id));
}
export function findQuiz(id: string): SavedQuiz | undefined {
  return savedQuizzes().find((s) => s.id === id);
}

/* ---------- settings ---------- */
export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) };
}
export function storeSettings(s: Settings) {
  write(K.settings, s);
}

/* ---------- scores / xp / achievements ---------- */
export function highScores(): QuizResult[] {
  return read<QuizResult[]>(K.scores, []);
}
export function addScore(r: QuizResult) {
  const list = highScores();
  list.push(r);
  list.sort((a, b) => b.points - a.points);
  write(K.scores, list.slice(0, 100));
}
export function bestForQuiz(quizId: string): QuizResult | undefined {
  return highScores()
    .filter((s) => s.quizId === quizId)
    .sort((a, b) => b.points - a.points)[0];
}
export function xp(): number {
  return read<number>(K.xp, 0);
}
export function addXp(n: number): number {
  const v = xp() + n;
  write(K.xp, v);
  return v;
}
export function unlockedAchievements(): string[] {
  return read<string[]>(K.achievements, []);
}
export function unlockAchievement(id: string): boolean {
  const have = unlockedAchievements();
  if (have.includes(id)) return false;
  have.push(id);
  write(K.achievements, have);
  return true;
}

/* ---------- profiles ---------- */
export function profiles(): Profile[] {
  return read<Profile[]>(K.profiles, []);
}
export function currentProfile(): Profile | null {
  const id = readRaw(K.profile);
  if (!id) return null;
  return profiles().find((p) => p.id === id) ?? null;
}
export function createProfile(name: string): Profile {
  const p: Profile = { id: `${Date.now().toString(36)}`, name, xp: 0, created: Date.now() };
  const list = profiles();
  list.push(p);
  write(K.profiles, list);
  writeRaw(K.profile, p.id);
  return p;
}
export function switchProfile(id: string) {
  writeRaw(K.profile, id);
}
export function addProfileXp(n: number) {
  const p = currentProfile();
  if (!p) return;
  const list = profiles();
  const cur = list.find((x) => x.id === p.id);
  if (cur) {
    cur.xp += n;
    write(K.profiles, list);
  }
}

/* ---------- progress (resume) ---------- */
export interface Progress {
  quizId: string;
  index: number;
  points: number;
  correct: number;
  streak: number;
  hearts: number;
  elapsedMs: number;
  flags: number[];
  answers: (string | null)[];
  earned: number[];
  times: number[];
  seed?: number;   // reproduces this attempt's randomization on resume
  order?: number[]; // the shuffled question order for this attempt
}
export function saveProgress(p: Progress) {
  write(K.progress, p);
}
export function loadProgress(): Progress | null {
  return read<Progress | null>(K.progress, null);
}
export function clearProgress() {
  removeRaw(K.progress);
}

/* ---------- prompt history / favorites / custom presets ---------- */
export interface PromptHistoryEntry {
  id: string;
  title: string;
  text: string;
  date: number;
}
export function promptHistory(): PromptHistoryEntry[] {
  return read<PromptHistoryEntry[]>(K.promptHistory, []);
}
export function addPromptHistory(title: string, text: string): PromptHistoryEntry {
  const entry: PromptHistoryEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    text,
    date: Date.now(),
  };
  const list = promptHistory();
  list.unshift(entry);
  write(K.promptHistory, list.slice(0, 40));
  return entry;
}
export function deletePromptHistory(id: string) {
  write(K.promptHistory, promptHistory().filter((p) => p.id !== id));
}

export function favoritePromptIds(): string[] {
  return read<string[]>(K.promptFavs, []);
}
export function toggleFavoritePrompt(id: string): boolean {
  const favs = favoritePromptIds();
  const has = favs.includes(id);
  if (has) write(K.promptFavs, favs.filter((f) => f !== id));
  else write(K.promptFavs, [...favs, id]);
  return !has;
}

export function customPresets(): Preset[] {
  return read<Preset[]>(K.customPresets, []);
}
export function saveCustomPreset(p: Preset) {
  const list = customPresets().filter((x) => x.id !== p.id);
  list.unshift(p);
  write(K.customPresets, list.slice(0, 30));
}
export function deleteCustomPreset(id: string) {
  write(K.customPresets, customPresets().filter((p) => p.id !== id));
}

/* ---------- topic stats / goals / misses (study loop) ---------- */
export interface TopicStat {
  plays: number;
  bestRank: string;
  bestPct: number;
  last: number;
  misses: string[];
}
export function topicStats(): Record<string, TopicStat> {
  return read<Record<string, TopicStat>>(K.topicStats, {});
}
export function recordPlay(title: string, rank: string, pct: number, misses: string[]) {
  const stats = topicStats();
  const cur = stats[title];
  if (!cur) {
    stats[title] = { plays: 1, bestRank: rank, bestPct: pct, last: Date.now(), misses: [...new Set(misses)].slice(0, 30) };
  } else {
    cur.plays++;
    if (pct > cur.bestPct) cur.bestPct = pct;
    const rankOrder = ["S", "A", "B", "C", "D", "F"];
    if (rankOrder.indexOf(rank) < rankOrder.indexOf(cur.bestRank)) cur.bestRank = rank;
    cur.last = Date.now();
    cur.misses = [...new Set([...cur.misses, ...misses])].slice(0, 30);
  }
  write(K.topicStats, stats);
}
export function addMiss(title: string, miss: string) {
  const stats = topicStats();
  const cur = stats[title];
  if (!cur) {
    stats[title] = { plays: 0, bestRank: "F", bestPct: 0, last: Date.now(), misses: [miss].slice(0, 30) };
  } else if (!cur.misses.includes(miss)) {
    cur.misses = [...cur.misses, miss].slice(0, 30);
  }
  write(K.topicStats, stats);
}

export interface Goal {
  title: string;
  targetRank: string;
  started: number;
}
export function goals(): Goal[] {
  return read<Goal[]>(K.goals, []);
}
export function setGoal(title: string, targetRank: string) {
  const list = goals().filter((g) => g.title !== title);
  list.push({ title, targetRank, started: Date.now() });
  write(K.goals, list);
}
export function goalFor(title: string): Goal | undefined {
  return goals().find((g) => g.title === title);
}
export function clearGoal(title: string) {
  write(K.goals, goals().filter((g) => g.title !== title));
}
