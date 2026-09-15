/* ============ P5 QUIZ API — INPUT VALIDATION (zod) ============ */
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username needs 3+ characters")
  .max(24, "Username max 24 characters")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username: letters, numbers, . _ - only");

export const passwordSchema = z
  .string()
  .min(8, "Password needs 8+ characters")
  .max(128, "Password max 128 characters");

export const emailSchema = z
  .string()
  .trim()
  .email("Not a valid email")
  .max(150)
  .optional()
  .or(z.literal(""));

export const classCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,8}$/, "Class code: 4-8 letters/numbers");

export const classNameSchema = z
  .string()
  .trim()
  .min(2, "Class name needs 2+ characters")
  .max(60, "Class name max 60 characters");

export const classIdSchema = z.string().uuid("Bad class id");

export const quizTitleSchema = z.string().trim().min(1).max(120);
export const quizDataSchema = z.record(z.string(), z.unknown()).refine((v) => typeof v.title === "string" && Array.isArray(v.sections), "Quiz must have title + sections");

export const resultSchema = z.object({
  quizTitle: z.string().trim().min(1).max(120),
  points: z.number().int().min(-1_000_000).max(1_000_000),
  maxPoints: z.number().int().min(0).max(1_000_000),
  rank: z.string().regex(/^[SABCDEF]$/, "Bad rank"),
  correct: z.number().int().min(0).max(10_000),
  total: z.number().int().min(1).max(10_000),
});

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
export function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): Parsed<z.infer<S>> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data as z.infer<S> } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid input" };
}
