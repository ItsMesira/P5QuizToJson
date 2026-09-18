/* ============ P5 QUIZ API — DB POOL + SCHEMA ============ */
/* Plain node-postgres — works with Supabase, Neon, RDS and local Postgres.
   `sql` tagged template keeps the call sites terse and parameterized. */
import { Pool, type QueryResultRow } from "pg";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(url);

export const pool = new Pool({
  connectionString: url,
  ssl: isLocal || url === "" ? undefined : { rejectUnauthorized: false },
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

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  pass_hash TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student',
  joined TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS results (
  id UUID PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_title TEXT NOT NULL,
  points INTEGER NOT NULL,
  max_points INTEGER NOT NULL,
  rank TEXT NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_results_class ON results (class_id, points DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);

/* one-time .env drops for the prank-agent installer — consumed on first read */
CREATE TABLE IF NOT EXISTS prank_drops (
  code_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prank_drops_expires ON prank_drops (expires);
`;

let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(schema)
      .then(() => undefined)
      .catch((err) => {
        console.error("[p5q] ensureSchema failed:", err);
        schemaReady = null;
        throw new Error("Database unavailable");
      });
  }
  return schemaReady;
}
