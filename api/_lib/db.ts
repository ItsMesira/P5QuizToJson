/* ============ P5 QUIZ API — DB POOL ============ */
/* Plain node-postgres — works with Supabase, Neon, RDS and local Postgres.
   `sql` tagged template keeps the call sites terse and parameterized.
   Schema is managed out-of-band by scripts/migrate.mjs; the app role has DML
   only (no DDL), so nothing here creates tables. */
import { Pool, type QueryResultRow } from "pg";

const rawUrl = process.env.DATABASE_URL ?? "";
/* Tolerate the common copy/paste mistakes so a slightly-wrong env value
   doesn't take the whole API down: surrounding quotes, a leading
   "DATABASE_URL=", and stray whitespace/newlines. */
function normalizeDbUrl(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^DATABASE_URL\s*=\s*/i, "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}
const url = normalizeDbUrl(rawUrl);
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const ca = (process.env.DATABASE_CA_CERT ?? "").replace(/\\n/g, "\n").trim();

/* A Supabase pooler URL must carry the project ref in the username
   (`role.<ref>`); without it every connection fails with ENOIDENTIFIER. */
function poolerRefHint(): void {
  if (!url || isLocal || !/pooler\.supabase\.com/.test(url)) return;
  try {
    const u = new URL(url);
    if (!u.username.includes(".")) {
      console.error(
        "[p5q] DATABASE_URL looks wrong: Supabase pooler usernames must be \"role.<project-ref>\" " +
        `(got "${u.username}"). e.g. "postgres.<ref>" or "p5q_app.<ref>".`,
      );
    }
  } catch {
    console.error("[p5q] DATABASE_URL is not a valid URL.");
  }
}
poolerRefHint();

function sslConfig(): false | { ca?: string; rejectUnauthorized: boolean } | undefined {
  if (url === "" || isLocal) return undefined;
  // Verify the server certificate when a CA is supplied (strongest).
  if (ca) return { ca, rejectUnauthorized: true };
  // Explicit opt-in to strict verification without pinning a CA.
  if (process.env.P5Q_DB_VERIFY === "1") return { rejectUnauthorized: true };
  // Supabase's pooler presents a cert the Node trust store does not know, so
  // without DATABASE_CA_CERT we must relax verification. Supply it to harden.
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: url,
  ssl: sslConfig(),
  // serverless guidance (Supabase): one connection per warm instance,
  // keep-alive + a short idle window so frozen instances drop stale sockets
  max: 1,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  // hard caps so a stuck socket can never hang a request forever
  statement_timeout: 10_000,
  query_timeout: 10_000,
});

/* an idle-socket error must never take the whole function down */
pool.on("error", (err) => {
  console.error("[p5q] idle db client error:", err.message);
});

const CONN_ERROR = /terminated|ECONNRESET|ECONNREFUSED|EPIPE|Connection ended|timeout|ETIMEDOUT|Timed out/i;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`query timed out after ${ms}ms`)), ms)),
  ]);

export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  let text = "";
  const params: unknown[] = [];
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  });
  const run = () => pool.query<T>(text, params);
  try {
    return await withTimeout(run(), 10_000);
  } catch (err) {
    // one retry for connection-level failures (cold instances, stale sockets)
    if (CONN_ERROR.test(String((err as Error)?.message ?? ""))) {
      console.warn("[p5q] db connection error — retrying once");
      await new Promise((r) => setTimeout(r, 250));
      return withTimeout(run(), 10_000);
    }
    throw err;
  }
}

/* The runtime no longer creates schema (the app role cannot DDL). This is a
   cached connectivity guard so handlers fail cleanly when the DB is down. */
let ready: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = pool
      .query("SELECT 1")
      .then(() => undefined)
      .catch((err) => {
        console.error("[p5q] database unavailable:", err.message);
        ready = null;
        throw new Error("Database unavailable");
      });
  }
  return ready;
}