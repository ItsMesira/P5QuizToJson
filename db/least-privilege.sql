-- ============ P5 QUIZ — LEAST-PRIVILEGE APP ROLE ============
-- Applied by `node scripts/migrate.mjs` (it creates the role with a generated
-- password and writes the resulting URL to `.env.approle`, which is gitignored).
--
-- The app connects as p5q_app, which has DML only on the app tables — no DDL,
-- no superuser, no access to other schemas. The owner (postgres) is used only
-- by the migration script. Replace __APP_PASSWORD__ if running this by hand.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'p5q_app') THEN
    EXECUTE format('CREATE ROLE p5q_app LOGIN PASSWORD %L', '__APP_PASSWORD__');
  ELSE
    EXECUTE format('ALTER ROLE p5q_app LOGIN PASSWORD %L', '__APP_PASSWORD__');
  END IF;
END $$;

GRANT CONNECT ON DATABASE postgres TO p5q_app;
GRANT USAGE ON SCHEMA public TO p5q_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO p5q_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO p5q_app;
-- never grant CREATE / DDL to the app role
REVOKE CREATE ON SCHEMA public FROM p5q_app;

-- The hardening (db/hardening.sql) enables RLS deny-all so the Supabase API
-- roles (anon/authenticated) cannot read the tables. The trusted app role must
-- bypass RLS to do its DML, otherwise every insert/select is denied.
ALTER ROLE p5q_app BYPASSRLS;