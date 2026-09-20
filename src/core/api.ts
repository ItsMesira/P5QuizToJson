import { t } from "./i18n";

/* ============ P5 QUIZ — CLOUD API CLIENT (classes/auth, Vercel functions) ============ */

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

async function req(path: string, opts: { method?: string; body?: unknown } = {}, retried = false): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const csrf = csrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: t("Cannot reach the server") } };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  // stale/missing CSRF cookie (e.g. a session restored from before it existed):
  // /auth/me re-issues it, then retry the write exactly once.
  if (!res.ok && !retried && (opts.method ?? "GET") !== "GET" && /csrf/i.test(String(data.error ?? ""))) {
    await req("/auth/me", {}, true);
    return req(path, opts, true);
  }
  return { ok: res.ok, status: res.status, data };
}

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

/* Resolves after the first /auth/me attempt (success or failure). Boot kicks
   this off in the background; screens that need a restored session must await
   it instead of racing a possibly-null cloud.session. Dedupes its own calls. */
let readyPromise: Promise<void> | null = null;

export function cloudReady(): Promise<void> {
  if (!readyPromise) readyPromise = cloud.me().then(() => undefined, () => undefined);
  return readyPromise;
}

export const cloud = {
  session: null as CloudSession | null,

  async me(): Promise<ApiResult<{ session?: CloudSession }>> {
    const r = await req("/auth/me");
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
    const r = await req("/auth/register", { method: "POST", body: { username, password, email: email || null, classCode: classCode || undefined } });
    if (r.ok && r.data.session) this.setSession(r.data.session as CloudSession);
    return r as never;
  },

  async login(username: string, password: string, classCode?: string): Promise<ApiResult<{ session?: CloudSession }>> {
    const r = await req("/auth/login", { method: "POST", body: { username, password, classCode: classCode || undefined } });
    if (r.ok && r.data.session) this.setSession(r.data.session as CloudSession);
    return r as never;
  },

  async logout(): Promise<ApiResult> {
    const r = await req("/auth/me", { method: "POST" });
    if (r.ok) this.setSession(null);
    return r as never;
  },

  async deleteAccount(): Promise<ApiResult> {
    const r = await req("/auth/me", { method: "DELETE" });
    if (r.ok) this.setSession(null);
    return r as never;
  },

  async createClass(name: string): Promise<ApiResult<{ cls?: CloudClass }>> {
    const r = await req("/classes/create", { method: "POST", body: { name } });
    if (r.ok && r.data.cls) {
      this.setSession({ user: this.session!.user, cls: r.data.cls as CloudClass });
    }
    return r as never;
  },

  async joinClass(code: string): Promise<ApiResult<{ cls?: CloudClass }>> {
    const r = await req("/classes/join", { method: "POST", body: { code } });
    if (r.ok && r.data.cls) {
      this.setSession({ user: this.session!.user, cls: r.data.cls as CloudClass });
    }
    return r as never;
  },

  async myClasses(): Promise<ApiResult<{ classes?: { id: string; name: string; code: string; role: string; members: number }[] }>> {
    return (await req("/classes/mine")) as never;
  },

  async classInfo(id: string): Promise<ApiResult<{ cls?: { name: string; code: string; owner: boolean; myRole: string }; members?: { username: string; role: string }[] }>> {
    return (await req(`/classes/${id}`)) as never;
  },

  async listQuizzes(id: string): Promise<ApiResult<{ quizzes?: { id: string; title: string; author: string; created: string }[] }>> {
    return (await req(`/classes/${id}/quizzes`)) as never;
  },

  async saveQuiz(id: string, quiz: unknown): Promise<ApiResult> {
    const q = quiz as { title?: string };
    return (await req(`/classes/${id}/quizzes`, { method: "POST", body: { title: q.title ?? "Quiz", quiz } })) as never;
  },

  async deleteQuiz(id: string, qid: string): Promise<ApiResult> {
    return (await req(`/classes/${id}/quizzes?qid=${encodeURIComponent(qid)}`, { method: "DELETE" })) as never;
  },

  async fetchQuiz(id: string, qid: string): Promise<ApiResult<{ quiz?: unknown }>> {
    return (await req(`/classes/${id}/quiz/${qid}`)) as never;
  },

  async classResults(id: string): Promise<ApiResult<{ results?: { username: string; quizTitle: string; points: number; maxPoints: number; rank: string; correct: number; total: number }[] }>> {
    return (await req(`/classes/${id}/results`)) as never;
  },

  async submitResult(id: string, payload: { quizId: string; quizTitle: string; answers: { q: number; a: string | null }[] }): Promise<ApiResult> {
    return (await req(`/classes/${id}/results`, { method: "POST", body: payload })) as never;
  },

  setSession(s: CloudSession | null) {
    this.session = s;
    window.dispatchEvent(new CustomEvent("p5q-session", { detail: s }));
  },
};

export function cloudError(r: ApiResult): string {
  return String(r.data?.error ?? (r.status === 0 ? t("Cannot reach the server — is it running?") : t("Server error ({code})", { code: r.status })));
}
