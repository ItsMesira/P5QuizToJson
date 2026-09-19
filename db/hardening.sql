-- ============ P5 QUIZ — SUPABASE HARDENING ============
-- Closes the PostgREST / anon-key side door. The app talks to Postgres
-- directly as the table owner (which bypasses RLS), so enabling RLS with NO
-- policies denies every other role while leaving the app fully functional.
-- Run once in the Supabase SQL editor (or `node scripts/migrate.mjs`).
--
-- Verify afterwards:
--   SELECT relname, relrowsecurity FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r';
--   -- every row must show relrowsecurity = true

BEGIN;

ALTER TABLE IF EXISTS users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS quizzes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS auth_attempts ENABLE ROW LEVEL SECURITY;

-- Revoke the API roles' table access. Guarded so this also runs on plain
-- Postgres (local/dev) where anon/authenticated do not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated';
  END IF;
END $$;

COMMIT;