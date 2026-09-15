/* ============ P5 QUIZ API — DB POOL + SCHEMA ============ */
import { sql, createPool } from "@vercel/postgres";

export const pool = createPool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
});

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
`;

let inited = false;
export async function ensureSchema() {
  if (inited) return;
  inited = true;
  try {
    await sql.query(schema);
  } catch {
    inited = false;
    throw new Error("Database unavailable");
  }
}
