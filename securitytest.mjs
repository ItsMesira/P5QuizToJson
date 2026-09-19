/* ============ P5 QUIZ — SECURITY BATTERY (harsh) ============
   Static config audit + live API abuse tests + DB privilege checks + grading
   integrity. Requires: devapi on 3011 (node devapi.mjs 3011), .env (owner),
   .env.approle, .admin-bootstrap.txt. Exits non-zero on any finding. */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import pg from "pg";
import { hash } from "@node-rs/argon2";

const root = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.P5Q_BASE ?? "http://localhost:3011";
const TEST_ADMIN = "__sectest_admin";
const TEST_PW = "Sectest#2026-strong";

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) fails++;
};
const env = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
    );
  } catch {
    return {};
  }
};
const ownerEnv = env(".env");
const ownerUrl = ownerEnv.DATABASE_URL;
const pool = new pg.Pool({ connectionString: ownerUrl, ssl: /localhost|127\.0\.0\.1/.test(ownerUrl) ? undefined : { rejectUnauthorized: false }, max: 1 });

/* ---------------- 1. static config ---------------- */
console.log("\n== static config ==");
try {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const all = vercel.headers.flatMap((h) => h.headers ?? []);
  const hdr = (k) => all.find((x) => x.key.toLowerCase() === k)?.value ?? "";
  const csp = hdr("content-security-policy");
  check("CSP present", !!csp);
  check("CSP script-src 'self'", /script-src 'self'/.test(csp));
  check("CSP has no unsafe-eval", !/unsafe-eval/.test(csp));
  check("CSP object-src 'none'", /object-src 'none'/.test(csp));
  check("CSP frame-ancestors 'none'", /frame-ancestors 'none'/.test(csp));
  check("CSP base-uri 'self'", /base-uri 'self'/.test(csp));
  check("X-Frame-Options DENY", /DENY/i.test(hdr("x-frame-options")));
  check("nosniff", /nosniff/i.test(hdr("x-content-type-options")));
  check("COOP same-origin", /same-origin/i.test(hdr("cross-origin-opener-policy")));
  check("noindex on admin path", /noindex/i.test(hdr("x-robots-tag")));
} catch (e) {
  check("vercel.json parses", false, String(e));
}

const hardening = readFileSync(join(root, "db/hardening.sql"), "utf8");
for (const t of ["users", "sessions", "classes", "members", "quizzes", "results", "admin_audit", "auth_attempts"]) {
  check(`RLS enabled for ${t}`, new RegExp(`ALTER TABLE IF EXISTS ${t}\\s+ENABLE ROW LEVEL SECURITY`).test(hardening));
}
check("revokes anon/authenticated", /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/.test(hardening) && /FROM authenticated/.test(hardening));
const robots = readFileSync(join(root, "public/robots.txt"), "utf8");
check("robots disallows admin path", robots.includes("/ijustlovehavingtheadminpanel"));
const gi = readFileSync(join(root, ".gitignore"), "utf8");
check(".gitignore ignores .env", /^\.env$/m.test(gi));
check(".gitignore ignores bootstrap file", gi.includes(".admin-bootstrap.txt"));

// function-count cap
const apiFiles = readdirSync(join(root, "api"), { recursive: true })
  .map((f) => String(f))
  .filter((f) => f.endsWith(".ts") && !f.includes("_lib"));
check("serverless functions <= 12", apiFiles.length <= 12, `${apiFiles.length}`);

// no hardcoded secrets / weak defaults in shipped code
const scanDirs = ["src", "api", "scripts", "db"];
const hits = [];
const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.(ts|mjs|sql)$/.test(name)) {
      const txt = readFileSync(p, "utf8");
      if (/admin1234|password123\b/.test(txt)) hits.push(p);
      if (/postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/.test(txt) && !p.endsWith(".example")) hits.push(p + " (connstring)");
    }
  }
};
scanDirs.forEach((d) => existsSync(join(root, d)) && scan(join(root, d)));
check("no hardcoded weak creds/connstrings in code", hits.length === 0, hits.join(", "));

/* ---------------- 2. DB privileges ---------------- */
console.log("\n== database ==");
try {
  const rls = await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false`);
  check("all tables have RLS on (live)", rls.rows.length === 0, rls.rows.map((r) => r.relname).join(","));
  const bypass = await pool.query("SELECT rolbypassrls FROM pg_roles WHERE rolname='p5q_app'");
  check("p5q_app has BYPASSRLS", bypass.rows[0]?.rolbypassrls === true);
  const ddl = await pool.query("SELECT has_schema_privilege('p5q_app','public','CREATE') AS c");
  check("p5q_app cannot CREATE (no DDL)", ddl.rows[0]?.c === false);
  const anon = await pool.query(`SELECT count(*)::int n FROM information_schema.role_table_grants
    WHERE grantee IN ('anon','authenticated') AND table_schema='public'`);
  check("anon/authenticated have NO table grants", anon.rows[0]?.n === 0, `grants=${anon.rows[0]?.n}`);
  const chk = await pool.query(`SELECT conname FROM pg_constraint WHERE conname IN ('members_role_chk','sessions_kind_chk')`);
  check("role/kind CHECK constraints present", chk.rows.length === 2);
} catch (e) {
  check("db privilege queries", false, String(e).slice(0, 120));
}

/* ---------------- 3. grading integrity (unit) ---------------- */
console.log("\n== grading integrity ==");
try {
  await build({ entryPoints: [join(root, "api/_lib/grading.ts")], bundle: true, format: "esm", platform: "node", outfile: "/tmp/p5q-grading.mjs", logLevel: "silent" });
  const { gradeQuiz } = await import("/tmp/p5q-grading.mjs?" + Date.now());
  const quiz = { sections: [{ name: "S", questions: [
    { type: "multiple", points: 100, answers: [{ text: "a", correct: true }, { text: "b" }] },
    { type: "fill", points: 200, correctText: "paris" },
  ] }] };
  const good = gradeQuiz(quiz, ["a", "Paris"]);
  check("grading counts correct answers", good.correct === 2 && good.total === 2, JSON.stringify(good));
  check("grading computes points from the key", good.points === 300 && good.maxPoints === 300);
  check("grading rank S at 100%", good.rank === "S");
  const forged = gradeQuiz(quiz, ["b", "london"]);
  check("forged answers cannot inflate score", forged.points === 0 && forged.correct === 0);
} catch (e) {
  check("grading unit test", false, String(e).slice(0, 120));
}

/* ---------------- 4. live API abuse ---------------- */
console.log("\n== live API ==");
const jarOf = () => {
  const jar = {};
  return {
    header: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
    get: (k) => jar[k],
    absorb: (res) => {
      const sc = res.headers.getSetCookie?.() ?? [];
      for (const c of sc) {
        const kv = c.split(";")[0];
        const i = kv.indexOf("=");
        jar[kv.slice(0, i)] = kv.slice(i + 1);
      }
    },
  };
};
const call = async (path, { method = "POST", body, jar, origin } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (jar) headers.cookie = jar.header();
  if (jar?.get("p5q_csrf")) headers["x-csrf-token"] = decodeURIComponent(jar.get("p5q_csrf"));
  if (origin) headers.origin = origin;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  jar?.absorb(res);
  let data = {};
  try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
};

const health = await fetch(`${BASE}/api/health`);
const hbody = await health.json();
check("health 200", health.status === 200);
check("health does not leak db status", !JSON.stringify(hbody).includes("up") && !JSON.stringify(hbody).includes("db"));

const evil = await call("/api/auth/login", { body: { username: "x", password: "y" }, origin: "https://evil.example" });
check("login rejects cross-origin (CSRF)", evil.status === 403, String(evil.status));

const big = await call("/api/auth/register", { body: { username: `__big${Date.now()}`, password: TEST_PW, email: "x".repeat(700000) } });
check("oversized body rejected", big.status === 400, String(big.status));

const meNoCsrf = await fetch(`${BASE}/api/auth/me`, { method: "POST" });
check("logout requires CSRF", meNoCsrf.status === 401, String(meNoCsrf.status));

// lockout: 9 bad logins for a throwaway username should eventually 429
let locked = false;
for (let i = 0; i < 11; i++) {
  const r = await call("/api/auth/login", { body: { username: `__sec_none_${Date.now()}`, password: "Wrong#pass123" } });
  if (r.status === 429) { locked = true; break; }
  await new Promise((r) => setTimeout(r, 60));
}
check("brute force gets locked out (429)", locked);

// seed a throwaway admin, exercise admin auth
try {
  const h = await hash(TEST_PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await pool.query(`INSERT INTO users (id, username, pass_hash, is_admin, must_change_password)
    VALUES (gen_random_uuid(), $1, $2, true, false)
    ON CONFLICT (username) DO UPDATE SET pass_hash=$2, is_admin=true, must_change_password=false`, [TEST_ADMIN, h]);

  const ajar = jarOf();
  const noAuth = await call("/api/admin", { body: { action: "stats" }, jar: ajar });
  check("admin API rejects anon", noAuth.status === 401, String(noAuth.status));

  const wrong = await call("/api/admin", { body: { action: "login", username: TEST_ADMIN, password: "nope-wrong-123" } });
  check("admin login rejects wrong password", wrong.status === 401, String(wrong.status));

  const login = await call("/api/admin", { body: { action: "login", username: TEST_ADMIN, password: TEST_PW }, jar: ajar });
  check("admin login succeeds", login.status === 200, `${login.status} ${JSON.stringify(login.data).slice(0, 60)}`);

  const rc = jarOf();
  rc.absorb({ headers: { getSetCookie: () => [] } });
  const statsNoCsrf = await fetch(`${BASE}/api/admin`, { method: "POST", headers: { "Content-Type": "application/json", cookie: ajar.header() }, body: JSON.stringify({ action: "stats" }) });
  check("admin API requires CSRF", statsNoCsrf.status === 401, String(statsNoCsrf.status));

  const deleteNoStep = await call("/api/admin", { body: { action: "sessions.revoke", userId: "00000000-0000-0000-0000-000000000000" }, jar: ajar });
  check("destructive admin action needs step-up", deleteNoStep.status === 403 && /re-enter/i.test(String(deleteNoStep.data.error)), String(deleteNoStep.status));

  const step = await call("/api/admin", { body: { action: "stepUp", password: TEST_PW }, jar: ajar });
  check("admin step-up succeeds", step.status === 200, String(step.status));

  const afterStep = await call("/api/admin", { body: { action: "sessions.revoke", userId: "00000000-0000-0000-0000-000000000000" }, jar: ajar });
  check("destructive admin action allowed after step-up", afterStep.status === 200, String(afterStep.status));

const me = await call("/api/admin", { body: { action: "me" }, jar: ajar });
    const selfId = String(me.data.admin?.id ?? "");
    const selfDemote = await call("/api/admin", { body: { action: "users.setAdmin", id: selfId, isAdmin: false }, jar: ajar });
    check("self-demotion blocked", selfDemote.status === 403, String(selfDemote.status));

  const logout = await call("/api/admin", { body: { action: "logout" }, jar: ajar });
  check("admin logout", logout.status === 200);
} catch (e) {
  check("admin flow", false, String(e).slice(0, 140));
} finally {
  await pool.query("DELETE FROM users WHERE username = $1", [TEST_ADMIN]).catch(() => undefined);
  await pool.query("DELETE FROM auth_attempts WHERE key LIKE 'login-user:__sec%' OR key LIKE 'admin:__sectest%'").catch(() => undefined);
  await pool.query("DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)").catch(() => undefined);
}

await pool.end();
console.log(fails ? `\n${fails} SECURITY FAILURES` : "\nSECURITY BATTERY PASS");
process.exit(fails ? 1 : 0);