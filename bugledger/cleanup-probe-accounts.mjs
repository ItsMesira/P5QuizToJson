/* One-off cleanup: remove the two probe accounts this ledger created in the
   live database. Guarded — it refuses to run unless it finds exactly the
   expected usernames and nothing else matches. */
import { readFile } from "node:fs/promises";
import pg from "pg";

const TARGETS = ["ledgermubck8xe", "ledgermubcjr6l"];

/* load .env the same way devapi.mjs does */
try {
  const env = await readFile(new URL("../.env", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* fall back to the environment */
}

const url = (process.env.DATABASE_URL ?? "").trim();
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
})();
console.log(`target host: ${host}`);
if (!/supabase/.test(host)) {
  console.error("refusing to run: expected a supabase host");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

const before = await pool.query("SELECT username, email, created FROM users WHERE username = ANY($1)", [TARGETS]);
console.log(`found ${before.rowCount} of ${TARGETS.length} target accounts:`);
for (const r of before.rows) console.log(`  ${r.username}  ${r.email}  ${r.created?.toISOString?.() ?? r.created}`);

if (before.rowCount !== TARGETS.length) {
  console.error("refusing to delete: did not find exactly the expected accounts");
  await pool.end();
  process.exit(1);
}

const del = await pool.query("DELETE FROM users WHERE username = ANY($1) RETURNING username", [TARGETS]);
console.log(`deleted ${del.rowCount}: ${del.rows.map((r) => r.username).join(", ")}`);

const after = await pool.query("SELECT count(*)::int AS n FROM users WHERE username = ANY($1)", [TARGETS]);
console.log(`verify: ${after.rows[0].n} remaining (expected 0)`);
await pool.end();
