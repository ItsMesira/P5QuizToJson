/* ============ P5 QUIZ — ONE-TIME MIGRATION ============
   Applies db/schema.sql + db/hardening.sql, optionally creates the
   least-privilege app role (P5Q_APP_PASSWORD), and optionally seeds the admin
   (ADMIN_USERNAME + ADMIN_PASSWORD_HASH). Idempotent — safe to re-run.

   Usage:
     node scripts/migrate.mjs                 # schema + hardening
     P5Q_APP_PASSWORD=... node scripts/migrate.mjs
     ADMIN_USERNAME=... ADMIN_PASSWORD_HASH=... node scripts/migrate.mjs
*/
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- .env loader (no dependency) ----
try {
  const env = await readFile(join(root, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required (owner connection — migrations run DDL).");
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

async function runFile(rel) {
  const text = await readFile(join(root, rel), "utf8");
  await pool.query(text);
  console.log(`applied ${rel}`);
}

try {
  await runFile("db/schema.sql");
  await runFile("db/hardening.sql");

  // ---- optional: least-privilege app role ----
  const appPw = process.env.P5Q_APP_PASSWORD;
  if (appPw) {
    await pool.query("SELECT set_config('p5q.app_pw', $1, false)", [appPw]);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'p5q_app') THEN
          EXECUTE format('CREATE ROLE p5q_app LOGIN PASSWORD %L', current_setting('p5q.app_pw'));
        ELSE
          EXECUTE format('ALTER ROLE p5q_app LOGIN PASSWORD %L', current_setting('p5q.app_pw'));
        END IF;
      END $$;`);
    const dbName = new URL(url).pathname.replace(/^\//, "") || "postgres";
    await pool.query(`GRANT CONNECT ON DATABASE "${dbName.replace(/"/g, '""')}" TO p5q_app`);
    await pool.query("GRANT USAGE ON SCHEMA public TO p5q_app");
    await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO p5q_app");
    await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO p5q_app");
    await pool.query("REVOKE CREATE ON SCHEMA public FROM p5q_app");
    // The app role must bypass RLS: the hardening denies the API roles
    // (anon/authenticated) while the app keeps full DML. p5q_app is trusted.
    await pool.query("ALTER ROLE p5q_app BYPASSRLS");
    console.log("applied least-privilege role p5q_app (+BYPASSRLS)");
  }

  // ---- optional: seed the admin (never hardcoded) ----
  const adminUser = process.env.ADMIN_USERNAME;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (adminUser && adminHash) {
    await pool.query(
      `INSERT INTO users (id, username, email, pass_hash, is_admin, must_change_password)
       VALUES ($1, $2, NULL, $3, true, false)
       ON CONFLICT (username)
       DO UPDATE SET is_admin = true, pass_hash = excluded.pass_hash, must_change_password = false`,
      [randomUUID(), adminUser, adminHash],
    );
    console.log(`seeded admin "${adminUser}"`);
  }

  // ---- verification ----
  const rls = await pool.query(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
  const off = rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  const tables = await pool.query(`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'p5q_app'");
  const admins = await pool.query("SELECT count(*)::int AS n FROM users WHERE is_admin");
  console.log("---- verification ----");
  console.log(`tables: ${tables.rows[0].n}`);
  console.log(`RLS enabled on all tables: ${off.length === 0 ? "YES" : "NO -> " + off.join(", ")}`);
  console.log(`p5q_app role: ${role.rows.length ? "present" : "absent"}`);
  console.log(`admins: ${admins.rows[0].n}`);
  if (off.length) process.exitCode = 1;
} catch (err) {
  console.error("migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}