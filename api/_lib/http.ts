/* ============ P5 QUIZ API — RATE LIMITING + HTTP HELPERS ============ */

/* Sliding-window per-IP limiter. In-memory is a best-effort layer for
   serverless warm instances; Vercel's WAF is the hard boundary. */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function rateLimit(ip: string, limit = 10): boolean {
  const now = Date.now();
  // prune the map so a flood of unique IPs can't balloon memory
  if (hits.size > 10_000) {
    for (const [k, arr] of hits) {
      if (arr.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= limit) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

export function clientIp(headers: Record<string, string | undefined>): string {
  return String(headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? headers["x-real-ip"] ?? "local");
}

export function json(res: { setHeader(name: string, value: string): unknown; status(code: number): { json(body: unknown): unknown } }, code: number, body: unknown) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
}

export function ok(res: Parameters<typeof json>[0], body: unknown = { ok: true }) {
  return json(res, 200, body);
}

export function fail(res: Parameters<typeof json>[0], code: number, error: string) {
  return json(res, code, { ok: false, error });
}

export function badRequest(res: Parameters<typeof json>[0], error: string) {
  return fail(res, 400, error);
}

export function unauthorized(res: Parameters<typeof json>[0], error = "You must be logged in") {
  return fail(res, 401, error);
}

export function forbidden(res: Parameters<typeof json>[0], error = "You are not a member of this class") {
  return fail(res, 403, error);
}

export function notFound(res: Parameters<typeof json>[0], error = "Not found") {
  return fail(res, 404, error);
}

export function tooMany(res: Parameters<typeof json>[0]) {
  return fail(res, 429, "Too many attempts — wait a minute");
}

export function serverError(res: Parameters<typeof json>[0]) {
  return fail(res, 500, "Server error");
}

export async function readBody(req: unknown): Promise<unknown> {
  try {
    const r = req as {
      text?: () => Promise<string>;
      body?: unknown;
      [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
    };
    /* fetch-style adapter (devapi) */
    if (typeof r.text === "function") return JSON.parse((await r.text()) || "{}");
    /* Vercel Node runtime pre-parses JSON bodies */
    if (r.body !== undefined && r.body !== null) return r.body;
    /* raw Node IncomingMessage */
    let data = "";
    for await (const c of r as AsyncIterable<Buffer | string>) data += String(c);
    return JSON.parse(data || "{}");
  } catch {
    return null;
  }
}
