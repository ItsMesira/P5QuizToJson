import { t } from "./i18n";
import { routeScope } from "./runtime";

/* ============ P5 QUIZ — CLOUD API CLIENT (classes/auth, Vercel functions) ============ */

/* No request may hang forever. A cold Vercel function or a paused Supabase
   pooler used to leave a screen showing "Loading…" indefinitely, because every
   fetch was unbounded. Requests are also tied to the live screen's scope so a
   navigation cancels work that is no longer wanted. */
export const REQUEST_DEADLINE_MS = 12_000;

let inFlight = 0;

/** In-flight request count — used by the diagnostics probe. */
export function pendingRequests(): number {
  return inFlight;
}

export interface CloudUser {
  id: string;
  username: string;
  email: string | null;
  impersonated?: boolean;
}

export interface CloudClass {
  id: string;
  name: string;
  code: string;
  role: "teacher" | "student";
}

export interface CloudSession {
  user: CloudUser;
  cls: CloudClass | null;
}

function csrfToken(): string {
  // last occurrence wins, matching the server's cookie parser
  const hit = [...document.cookie.split("; ")].reverse().find((c) => c.startsWith("p5q_csrf="));
  if (!hit) return "";
  try {
    return decodeURIComponent(hit.slice(9));
  } catch {
    return hit.slice(9);
  }
}

export interface ReqOptions {
  method?: string;
  body?: unknown;
  /** Cancels the request — pass the live screen's `routeScope().signal`. */
  signal?: AbortSignal;
  /** Overrides REQUEST_DEADLINE_MS. */
  timeoutMs?: number;
}

/* Combine a caller's signal with our deadline. AbortSignal.any() is available in
   every browser this app targets; the manual fallback keeps the type honest. */
function withDeadline(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(new DOMException("deadline", "TimeoutError")), ms);
  const done = () => window.clearTimeout(timer);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true, signal: ctrl.signal });
  }
  return { signal: ctrl.signal, done };
}

async function req(
  path: string,
  opts: ReqOptions = {},
  retried = false,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; cancelled?: boolean }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const csrf = csrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;

  /* A screen that is already gone must not start work. */
  if (opts.signal?.aborted) return { ok: false, status: 0, data: {}, cancelled: true };

  const deadline = withDeadline(opts.signal, opts.timeoutMs ?? REQUEST_DEADLINE_MS);
  let res: Response;
  inFlight++;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: deadline.signal,
    });
  } catch (err) {
    deadline.done();
    inFlight--;
    /* Distinguish "we cancelled this" from "the server/network failed": the first
       is not an error the user should ever be shown. */
    if (opts.signal?.aborted) return { ok: false, status: 0, data: {}, cancelled: true };
    const timedOut = ctrlTimedOut(deadline.signal);
    return {
      ok: false,
      status: 0,
      data: { error: timedOut ? t("The server took too long to respond") : t("Cannot reach the server") },
    };
  }
  deadline.done();
  inFlight--;

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  // stale/missing CSRF cookie (e.g. a session restored from before it existed):
  // /auth/me re-issues it, then retry the write exactly once.
  if (!res.ok && !retried && (opts.method ?? "GET") !== "GET" && /csrf/i.test(String(data.error ?? ""))) {
    await req("/auth/me", { signal: opts.signal, timeoutMs: opts.timeoutMs }, true);
    return req(path, opts, true);
  }
  return { ok: res.ok, status: res.status, data };
}

function ctrlTimedOut(signal: AbortSignal): boolean {
  return signal.aborted && (signal.reason as DOMException | undefined)?.name === "TimeoutError";
}

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
  /** True when the request was cancelled (navigation/deadline), not failed. */
  cancelled?: boolean;
}

/* Resolves after the first /auth/me attempt (success or failure). Boot kicks
   this off in the background; screens that need a restored session must await
   it instead of racing a possibly-null cloud.session. Dedupes its own calls. */
let readyPromise: Promise<void> | null = null;

export function cloudReady(): Promise<void> {
  /* Deliberately NOT tied to a route scope: the restored session must survive a
     navigation, otherwise the account screens would keep seeing null. It must
     still PUBLISH the session — delegating to cloud.me() used to do that, and
     dropping it here left cloud.session null so #dashboard bounced to #entry. */
  if (!readyPromise) {
    readyPromise = req("/auth/me")
      .then((r) => {
        const s = r.data?.session as CloudSession | undefined;
        if (r.ok && s) cloud.setSession(s);
      })
      .catch(() => undefined);
  }
  return readyPromise;
}

/* Every request a SCREEN makes belongs to the live route scope, so navigating
   away cancels work whose result the screen can no longer use. Boot-level
   restore (cloudReady) deliberately stays unscoped. */
const screq = (path: string, opts: ReqOptions = {}) =>
  req(path, { ...opts, signal: opts.signal ?? routeScope().signal });

export const cloud = {
  session: null as CloudSession | null,

  async me(): Promise<ApiResult<{ session?: CloudSession }>> {
    const r = await screq("/auth/me");
    if (r.ok && (r.data.session as CloudSession | undefined)) {
      this.setSession(r.data.session as CloudSession);
    }
    return r as never;
  },

  /* Class sync for the load screen. null = not in a classroom (nothing to do). */
  async saveQuizToClass(quiz: unknown): Promise<ApiResult | null> {
    await cloudReady();
    const cls = this.session?.cls;
    if (!cls) return null;
    return this.saveQuiz(cls.id, quiz);
  },

  async register(username: string, password: string, email: string, classCode?: string): Promise<ApiResult<{ session?: CloudSession }>> {
    const r = await screq("/auth/register", { method: "POST", body: { username, password, email: email || null, classCode: classCode || undefined } });
    if (r.ok && r.data.session) this.setSession(r.data.session as CloudSession);
    return r as never;
  },

  async login(username: string, password: string, classCode?: string): Promise<ApiResult<{ session?: CloudSession }>> {
    const r = await screq("/auth/login", { method: "POST", body: { username, password, classCode: classCode || undefined } });
    if (r.ok && r.data.session) this.setSession(r.data.session as CloudSession);
    return r as never;
  },

  async logout(): Promise<ApiResult> {
    const r = await screq("/auth/me", { method: "POST" });
    if (r.ok) this.setSession(null);
    return r as never;
  },

  async deleteAccount(): Promise<ApiResult> {
    const r = await screq("/auth/me", { method: "DELETE" });
    if (r.ok) this.setSession(null);
    return r as never;
  },

  async createClass(name: string): Promise<ApiResult<{ cls?: CloudClass }>> {
    const r = await screq("/classes/create", { method: "POST", body: { name } });
    if (r.ok && r.data.cls) {
      this.setSession({ user: this.session!.user, cls: r.data.cls as CloudClass });
    }
    return r as never;
  },

  async joinClass(code: string): Promise<ApiResult<{ cls?: CloudClass }>> {
    const r = await screq("/classes/join", { method: "POST", body: { code } });
    if (r.ok && r.data.cls) {
      this.setSession({ user: this.session!.user, cls: r.data.cls as CloudClass });
    }
    return r as never;
  },

  async myClasses(): Promise<ApiResult<{ classes?: { id: string; name: string; code: string; role: string; members: number }[] }>> {
    return (await screq("/classes/mine")) as never;
  },

  async classInfo(id: string): Promise<ApiResult<{ cls?: { name: string; code: string; owner: boolean; myRole: string }; members?: { username: string; role: string }[] }>> {
    return (await screq(`/classes/${id}`)) as never;
  },

  async listQuizzes(id: string): Promise<ApiResult<{ quizzes?: { id: string; title: string; author: string; created: string }[] }>> {
    return (await screq(`/classes/${id}/quizzes`)) as never;
  },

  async saveQuiz(id: string, quiz: unknown): Promise<ApiResult> {
    const q = quiz as { title?: string };
    return (await screq(`/classes/${id}/quizzes`, { method: "POST", body: { title: q.title ?? "Quiz", quiz } })) as never;
  },

  async deleteQuiz(id: string, qid: string): Promise<ApiResult> {
    return (await screq(`/classes/${id}/quizzes?qid=${encodeURIComponent(qid)}`, { method: "DELETE" })) as never;
  },

  async fetchQuiz(id: string, qid: string): Promise<ApiResult<{ quiz?: unknown }>> {
    return (await screq(`/classes/${id}/quiz/${qid}`)) as never;
  },

  async classResults(id: string): Promise<ApiResult<{ results?: { username: string; quizTitle: string; points: number; maxPoints: number; rank: string; correct: number; total: number }[] }>> {
    return (await screq(`/classes/${id}/results`)) as never;
  },

  async submitResult(id: string, payload: { quizId: string; quizTitle: string; answers: { q: number; a: string | null }[] }): Promise<ApiResult> {
    return (await screq(`/classes/${id}/results`, { method: "POST", body: payload })) as never;
  },

  setSession(s: CloudSession | null) {
    this.session = s;
    window.dispatchEvent(new CustomEvent("p5q-session", { detail: s }));
  },
};

export function cloudError(r: ApiResult): string {
  return String(r.data?.error ?? (r.status === 0 ? t("Cannot reach the server — is it running?") : t("Server error ({code})", { code: r.status })));
}
