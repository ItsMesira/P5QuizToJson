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

/* Login must accept ANY existing password — old accounts may be short/weak.
   The policy above is enforced only when creating or setting a password. */
export const loginPasswordSchema = z.string().min(1, "Password required").max(128);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
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

/* Scores are recomputed server-side from the submitted answers — the client
   never sends points/rank, so a tampered client cannot forge a leaderboard. */
export const resultSubmitSchema = z.object({
  quizId: z.string().uuid(),
  quizTitle: z.string().trim().min(1).max(120),
  answers: z
    .array(z.object({ q: z.number().int().min(0).max(10_000), a: z.string().max(5000).nullable() }))
    .min(1)
    .max(10_000),
});

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
export function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): Parsed<z.infer<S>> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data as z.infer<S> } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid input" };
}
