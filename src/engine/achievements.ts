/* ============ P5 QUIZ — ACHIEVEMENTS ============ */
import type { Achievement, QuizResult } from "../core/types";

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first", name: "FIRST HEIST", desc: "Finish your first quiz", icon: "🃏", check: () => true },
  { id: "perfect", name: "TAKE THE WORLD", desc: "Finish with 100% correct", icon: "👑", check: (r) => r.correct === r.total && r.total > 0 },
  { id: "srank", name: "SHOWTIME", desc: "Earn an S rank", icon: "⚡", check: (r) => r.rank === "S" },
  { id: "streak5", name: "HEART OF GOLD", desc: "Hit a 5-streak", icon: "💛", check: (r) => r.bestStreak >= 5 },
  { id: "streak10", name: "UNSTOPPABLE", desc: "Hit a 10-streak", icon: "🔥", check: (r) => r.bestStreak >= 10 },
  { id: "speedrun", name: "TIME TRIAL", desc: "Finish 10+ questions in under 2 minutes", icon: "⏱", check: (r) => r.total >= 10 && r.timeMs < 120000 },
  { id: "marathon", name: "MARATHON", desc: "Finish a quiz with 20+ questions", icon: "🏃", check: (r) => r.total >= 20 },
  { id: "close", name: "LAST SECOND", desc: "Answer correctly in the last 2 seconds", icon: "⌛", check: () => false },
  { id: "savage", name: "NO MERCY", desc: "Finish with negative points", icon: "💀", check: (r) => r.points < 0 },
  { id: "redemption", name: "REDEMPTION", desc: "Get D rank or worse, then S rank", icon: "🌅", check: () => false },
];

export function checkAchievements(r: QuizResult): Achievement[] {
  return ACHIEVEMENTS.filter((a) => {
    try {
      return a.check(r);
    } catch {
      return false;
    }
  });
}
