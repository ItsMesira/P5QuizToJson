# Security

Hardening applied to the quiz app + Supabase. Verified by `securitytest.mjs`,
`csptest.mjs`, `admintest.mjs`, `authtest.mjs`, and the 19 UI suites.

## Controls now in place

- **Supabase**: RLS deny-all on every table (`db/hardening.sql`) + `anon`/`authenticated`
  grants revoked. The app connects as `p5q_app` (DML only, no DDL, `BYPASSRLS`) —
  created by `scripts/migrate.mjs`. Runtime no longer creates schema; migrations are
  one-time. Supply `DATABASE_CA_CERT` for verified TLS.
- **Auth**: argon2id, 7-day user / 8-hour admin sessions, 256-bit tokens stored only as
  SHA-256, `HttpOnly; SameSite=Lax; Secure`, CSRF double-submit on every state change,
  DB-backed lockout, generic errors, constant-time dummy verify, login origin check.
- **Admin panel** (`/ijustlovehavingtheadminpanel`): separate admin session + CSRF +
  password step-up for destructive actions, allowlisted actions, full audit log
  (`admin_audit`), last-admin/self-delete guards, `noindex`, lazy chunk. No credentials
  in code — seeded from env, forced change on first login.
- **Integrity**: class-quiz scores are recomputed server-side from the stored answer
  key (`api/_lib/grading.ts`); the client cannot submit points/rank.
- **Frontend**: strict CSP (`script-src 'self'`, no `unsafe-eval`, `object-src 'none'`,
  `frame-ancestors 'none'`), COOP/CORP, all `innerHTML` sinks removed, image URL
  allowlist, decompression caps (zip-bomb), prototype-pollution guards, CSS/selector
  value validation.
- **Ops**: dev server + devapi bind loopback only; CI least-privilege token + Dependabot;
  `robots.txt`/`noindex` on the admin path.

## One-time setup (owner)

```bash
export P5Q_APP_PASSWORD="$(openssl rand -base64 24)"     # app-role password
ADMIN_USERNAME=blue ADMIN_PASSWORD_HASH="$argon2_hash" P5Q_APP_PASSWORD="$P5Q_APP_PASSWORD" \
  node scripts/migrate.mjs
# then set Vercel env DATABASE_URL to the value in .env.approle (+ DATABASE_CA_CERT)
```

- **Vercel**: set `DATABASE_URL` (app role), optional `DATABASE_CA_CERT`; add WAF
  rate-limit rules for `/api/auth/*` and `/api/classes/join`; enable account MFA.
- **Supabase**: confirm backups/PITR; rotate the DB password if it was ever exposed.
- **GitHub**: MFA + Dependabot (config committed).

## Tests

```bash
node devapi.mjs 3011        # API (uses .env.approle)
npx vite --port 5183        # UI
node securitytest.mjs       # static + DB + API abuse + grading
node csptest.mjs            # serves dist with the real CSP and drives the app
node admintest.mjs          # admin panel routing/login/forced-change
node authtest.mjs           # classroom end-to-end
```

## Residual risk (not "unhackable")

No MFA on the admin login (password step-up only), XSS-while-admin-logged-in,
and the confidentiality of your Vercel/Supabase/GitHub accounts. See the audit
plan for optional TOTP and a dedicated admin origin.