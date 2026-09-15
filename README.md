# P5 QUIZ — Steal the Answers

A **Persona 5-styled quiz game** that runs entirely in your browser. No backend, no
account, no tracking. You drop in a `quiz.json` (drag & drop, paste, file picker,
share link, or one of the built-in samples) and play it through a full P5 experience:
ransom-note menus, stripe-wipe transitions, All-Out Attack results, ranks S–F,
streaks, lifelines, synthesized + authentic BGM, and confetti for the worthy.

> **Personal use only.** This project ships game-inspired music and artwork for
> your own device. Do not redistribute or host publicly — see [Assets & rights](#assets--rights).

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5183  (guest mode — no backend needed)
```

For the **classroom features** (accounts, classes, cloud sync) you need the
database + deploy steps — see the
[full setup guide](#-full-setup-guide-supabase--vercel--keep-alive) below.

Production build (static files, hostable anywhere):

```bash
npm run build      # outputs dist/
npm run preview    # serve dist/ locally
```

---

## Themes & languages

**Themes** (Settings → `— THEME —`): CALLING CARD (classic P5 crimson),
NOIR, AZURE, CHALKBOARD, VAPOR — plus **CUSTOM**: pick your own accent /
background / text colors with a live WCAG contrast readout (warns below
4.5:1). Themes recolor the whole app — stripes, panels, ransom lettering,
particles — and persist per device.

**Languages** (Settings → `— LANGUAGE —`): **English, ไทย (Thai), Español,
Français, Deutsch, 日本語** — the entire UI is translated (~390 strings per
locale), including toasts, errors and validation messages. The first visit
auto-detects your browser language; quiz *content* stays in whatever
language the author wrote it in.

Share links can pin both: `?lang=th`, `?theme=vapor`, e.g.
`https://your-domain.com/?lang=th#title`.

Thai notes: ransom lettering segments by grapheme cluster (tone marks never
break apart) and the Kanit font is bundled as the Thai glyph fallback.

---

## Classroom mode (accounts, classes, cloud sync)

The title menu has a **CLASSROOM** entry. The flow is intentionally
**join the class first, then sign in**:

1. **JOIN A CLASS** → enter the 6-character code → then **sign in or create an
   account** (username + password; email optional). The account is
   automatically linked to that class.
2. **MAKE A CLASS** → name it → sign in/register → you become the teacher and
   get a shareable join code.
3. **PLAY AS GUEST** keeps the original fully-offline mode — everything still
   works from localStorage.

While signed in:

- A **class badge** (name + code) stays pinned to the top of the screen on
  every page; click it to open the classroom.
- The **class dashboard** shows members, the class quiz shelf, and the class
  leaderboard.
- **Any member** can add a quiz to the class shelf (drag/drop, paste, or the
  prompt builder — it syncs automatically); the teacher can remove quizzes.
- Every finished run **posts your score** to the class leaderboard
  automatically; the leaderboard screen shows class scores above your
  device-local ones.
- **Log out** is available on the entry screen, the dashboard, the Thief Stats
  page, and the in-quiz pause menu. Logging out destroys the server session
  and returns to the entry screen; local guest data is untouched.

### Backend & security

Serverless functions live in `/api` (Vercel Node runtime) with
`@vercel/postgres`:

- **Passwords**: argon2id (memory 19 MiB, t=2) — never stored in plaintext.
- **Sessions**: 256-bit random tokens in `HttpOnly` + `SameSite=Lax` cookies
  (flagged `Secure` on Vercel/HTTPS), hashed with SHA-256 at rest, 30-day
  expiry.
- **CSRF**: double-submit token — every state-changing request must carry an
  `x-csrf-token` header matching the CSRF cookie, compared with
  `timingSafeEqual`.
- **Validation**: zod on every request body/param; quiz payloads capped at
  300 KB; result numbers bounded.
- **Authorization**: every class route checks session + membership; teacher
  role required for deletes.
- **Rate limiting**: sliding-window per-IP on auth/quiz/result endpoints
  (plus Vercel's WAF as the hard boundary).
- **SQL**: parameterized queries only; UUIDv4 public ids (no enumerable ids).
- **Secrets**: only via `DATABASE_URL` in `.env` (gitignored) or the Vercel
  dashboard. No secrets are ever committed or logged.

## Deploying to Vercel

> Full step-by-step lives in the
> [setup guide](#-full-setup-guide-supabase--vercel--keep-alive).
> Short version:

```bash
npm i -g vercel
vercel                    # first deploy (creates the project)
vercel --prod             # production deploys
```

Then in the Vercel dashboard: **Settings → Environment Variables** →
`DATABASE_URL` (Supabase connection string) → redeploy. `vercel.json` wires
the SPA fallback, `/api/*` functions, and security headers (nosniff, DENY
framing, permissions policy). `api/health.ts` provides the liveness endpoint
used by the keep-alive cron.

---

## ⚙ Full setup guide (Supabase + Vercel + keep-alive)

Everything below is one-time setup. After it, the classroom works for
everyone with the URL.

### Step 1 — Create the Supabase database

1. Go to [supabase.com](https://supabase.com) → **Start your project** →
   sign in (GitHub login works).
2. **New project** → name it (e.g. `p5-quiz`) → set a strong database
   password (save it — you'll need it once) → region closest to you →
   **Create new project** (free tier is fine).
3. Wait ~1 minute for initialization. Now grab the connection string —
   **any one of these three ways works**:

   **A. The Connect button (top bar of the dashboard)**
   - Click **Connect**. A dialog opens with tabs at the top:
     `Session pooler` · `Transaction pooler` · `Direct connection` (plus ORM
     tabs like ORMs/GraphQL).
   - If you see the tabs → choose **Transaction pooler** and copy the string
     (it ends in `:6543`).
   - If the tabs are missing or hidden, scroll inside the dialog and pick the
     **URI** format — or use method B below.

   **B. Settings → Database (always works)**
   - Left sidebar, bottom: ⚙️ **Project Settings** → **Database**.
   - Look for **Connection string** / **Connection info** section, `URI` tab.
   - Copy the **Transaction mode** (port `6543`) or the **Session mode**
     (port `5432`) string — both work with this app.

   **C. Build it manually (never fails)**
   - ⚙️ **Project Settings** → **General** → copy your **Project Reference**
     ID (looks like `abcdefghijklmnop`).
   - The **Direct connection** string always works from Vercel (no pooler
     needed for a small classroom):
     ```
     postgresql://postgres:YOUR-PASSWORD@db.PROJECT-REF.supabase.co:5432/postgres
     ```
   - The **pooler transaction** string (recommended, copy the pooler host from
     the Connect dialog — don't guess it):
     ```
     postgresql://postgres.PROJECT-REF:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
     ```
   - Replace `YOUR-PASSWORD` with the database password from step 2.

   > Either the pooler string (6543) or the direct string (5432) works with
   > this app — the pooler is just better behaved under serverless load.

### Supabase troubleshooting (common errors)

- **"Tenant or user not found"** → you used the pooler host with the direct
  username. Pooler strings must use `postgres.PROJECT-REF` (with the ref),
  direct strings use plain `postgres`.
- **Connection refused / timeout from Vercel** → you're on the direct string
  but your network/deploy is IPv4-only. Switch to the pooler string (methods
  A/B above) — the pooler is IPv4 on every tier.
- **"aws-0" host** → the pooler cluster number (`aws-0`, `aws-1`…) is not
  tied to your region — always copy the host from the dashboard, never
  compose it.
- **Password with special characters** → URL-encode them (e.g. `@` → `%40`,
  `#` → `%23`) in `DATABASE_URL`.

### Step 2 — Run it locally (optional but recommended)

> **No Vercel login?** Use the bundled local API host instead:
> ```bash
> npm run build                 # builds dist/
> node devapi.mjs 3011          # serves the app + /api from dist/ with your .env
> ```
> Put your database URL in `.env` (`DATABASE_URL=...`) and test the classroom
> with `P5Q_BASE=http://localhost:3011 node authtest.mjs`.

```bash
npm i -g vercel
cp .env.example .env
# edit .env → paste the Supabase connection string into DATABASE_URL
vercel dev            # http://localhost:3000 — frontend + /api
```

Verify: open http://localhost:3000/api/health → `{"ok":true,"db":"up"}`.
Then run the classroom end-to-end test:

```bash
node authtest.mjs
```

### Step 3 — Deploy to Vercel

1. `npm i -g vercel` (if you haven't) → run `vercel` in this folder →
   log in → accept defaults → first deploy done.
2. In the [Vercel dashboard](https://vercel.com/dashboard) → your project →
   **Settings → Environment Variables** → add:
   - `DATABASE_URL` = the Supabase connection string from Step 1
   - (no other vars needed — `SECURE_COOKIES` is automatic on Vercel)
3. **Deployments** tab → **Redeploy** the latest deployment so the new
   variable takes effect.
4. Done — share the `*.vercel.app` URL. The classroom works for everyone.

### Step 4 — The daily keep-alive (stops Supabase from pausing)

Supabase free projects **pause after ~7 days without activity**, and GitHub
disables scheduled workflows after 60 days of repo inactivity. The included
[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) fixes
both:

1. After pushing to GitHub, add a repository secret:
   **Settings → Secrets and variables → Actions → New repository secret** →
   name `VERCEL_URL`, value `https://your-app.vercel.app` (no trailing slash).
2. That's it. Every day at 12:00 UTC the workflow calls `/api/health`, which
   runs a real `SELECT 1` against Supabase — real database activity, so the
   project never pauses. The workflow also re-schedules itself so GitHub's
   60-day rule never kills it. You can trigger it manually anytime from the
   **Actions** tab → `keep-alive` → **Run workflow**.

---

## How to play

1. **Load a quiz** — `BEGIN HEIST` → drop a `quiz.json`, browse, paste, fetch a URL,
   or pick a built-in sample (Persona 5 trivia, General, Math, Code).
2. **Answer** — keyboard `1-4` + `Enter`, or click. Lifelines: **50/50**, **skip**,
   **hint**, **flag for review**. `Esc` pauses (timer actually freezes).
3. **Results** — All-Out Attack finale, rank S–F, stat radar, per-question review,
   achievements, XP. `🎯 Reinforce weak areas` builds a retest prompt from your
   actual misses.
4. **Title menu** — `↑↓` navigate · `Enter` confirm · `1-6` jump · `Esc` deselect.
   Click the giant name for a star burst.

---

## Getting quiz JSON — the Master Prompts section

The app has a **MASTER PROMPTS** menu with:

- **14 preset prompts** (Universal, All-9-Types, Study mode, Exam, Kids, Language
  learning, Interview prep, JSON fixer, …)
- **A full Prompt Builder** — pick topic, question count, difficulty mix, question
  types, game mode, tone, Bloom's level, spaced sessions, teacher answer-key, and
  language pairing; it generates a filled-in prompt with a live preview
- **Copy → paste into ANY AI chatbot** (ChatGPT, Gemini, Claude, …) → the AI
  returns a quiz JSON → **paste it back into the builder** to validate it, then
  PLAY NOW or save to your library

The answer checker is intentionally forgiving: it accepts every common AI output
variation (`answer` as string or number, `answer_index`, `correctAnswers[]`,
equations like `"12 × 12 = 144"`, units, comma decimals, one-typo fuzzy words).
Wrong answers are still rejected.

### The JSON schema

```jsonc
{
  "title": "My Quiz",
  "description": "optional",
  "accent": "#e60012",          // optional theme color
  "author": "optional",
  "passScore": 70,               // % needed to pass
  "settings": {                  // all optional
    "mode": "standard",          // standard | practice | survival | rapid | endless
    "timeLimit": 20,             // seconds per question, or null
    "shuffle": true,
    "shuffleAnswers": true,
    "negativeMarking": false,
    "feedback": "instant"        // instant | end
  },
  "sections": [
    {
      "name": "Round 1",
      "questions": [
        {
          "type": "multiple",    // multiple|boolean|multi|fill|order|match|numeric|open|hotspot
          "question": "What is 12 × 12?",
          "answers": [ { "text": "144", "correct": true }, { "text": "12" } ],
          "explanation": "optional — shown after answering",
          "hint": "optional — hint lifeline",
          "difficulty": 1,        // 1–3
          "points": 100
        }
      ]
    }
  ]
}
```

**Question types:** `multiple` (exactly 1 correct) · `boolean` (True/False) ·
`multi` (2+ correct) · `fill` (`correctText`, `|` for alternatives) ·
`order` (answers listed in the *correct* order in the JSON; display is scrambled) ·
`match` (`pairs: [{left, right}]`) · `numeric` (`answer: 144`, `tolerance`) ·
`open` (self-graded) · `hotspot` (`image` + `hotspots: [{x, y, r}]` in %).

---

## Sharing

- **Quiz links** — library card → `⧉ LINK` copies a gzip-compressed URL
  (`?q=…`) that loads the quiz on any device.
- **Prompt links** — the builder output can be shared the same way (`?prompt=…`).
- **Result cards** — results screen downloads a P5-styled PNG of your rank.

---

## Project structure

```
api/                Vercel serverless functions (auth, classes, quizzes, results, health)
  _lib/             pg pool + schema · auth (argon2/sessions/CSRF) · zod validation · rate limiting
src/
  core/     types, validator, store (localStorage), share (gzip links),
            prompts (master-prompt engine + 14 presets), audio (synth + file BGM),
            art (portrait registry), api (cloud client), theme (palettes + custom),
            i18n (t() engine, locale detect, Intl helpers)
  i18n/     th, es, fr, de, ja dictionaries (English keys, typed)
  engine/   quiz runner, scoring, achievements
  fx/       particles (canvas), transitions/cut-ins, ransom lettering (grapheme-safe),
            sprite cursor
  ui/       title, entry, dashboard, load, library, quiz, results, prompts,
            settings, profiles, leaderboard, screens (router)
  styles/   tokens, themes (palette overrides), p5 (ambient/cursor), components, screens
public/
  audio/    background.mp3, select.mp3
  art/      cut-in portraits, card art
  cursors/  30-frame animated cursor sprite strips
  fonts/    Persona5main.ttf
  sample-quizzes/  persona5, general, math, code
```

## Test suite (dev tools)

Extra suites for the newer systems: `node themetest.mjs` (theme presets,
custom colors, persistence), `node langtest.mjs` (all 6 locales: zero missing
keys, Thai grapheme integrity, long-string layouts), `node uifixtest.mjs`
(menu geometry, classroom flows, veil watchdog, double-submit lock),
`node authtest.mjs` (full classroom e2e against a real database — run it with
`node devapi.mjs` + `P5Q_BASE=http://localhost:3011`, no Vercel CLI needed).

`npm i -D puppeteer-core` (Chrome must be installed), then with the dev server
running on `:5183`:

| Script | Covers |
|---|---|
| `node smoke.mjs` | full flow: title → prompts → paste → quiz → results → library/settings/profiles |
| `node matrixtest.mjs` | all 9 question types, all 5 modes, lifelines, AI-output variations |
| `node reviewtest.mjs` | shuffled-quiz review alignment (regression for the scoreboard bug) |
| `node realinput.mjs` | real mouse/keyboard input & hit-testing across screens |
| `node menutest.mjs` | ransom menu anatomy, slash bg, sprite cursor, parallax |
| `node fixtest.mjs` / `resumetest.mjs` | partial credit, pause-freeze, resume restore |
| `node studytest.mjs` | reinforce-weak-areas, goals, prompt links |
| `node porttest.mjs` / `audit.mjs` | P5ex port features; 16-screen UI audit |
| `node authtest.mjs` | classroom e2e (needs `vercel dev` + `DATABASE_URL`; auto-skips otherwise) |

---

## Assets & rights

- **Music** (`public/audio/background.mp3`, `select.mp3`) and **artwork**
  (`public/art/*`, `public/cursors/*`, `public/fonts/Persona5main.ttf`) are
  Persona-series-inspired fan assets collected from other local projects.
  **They are for personal, non-commercial use only.** You are responsible for
  clearing rights before publishing or redistributing anything containing them.
- To ship a rights-clean build: delete `public/audio/`, `public/art/`,
  `public/cursors/`, and `public/fonts/`. The app degrades gracefully — the
  synthesized jazz loop replaces the BGM, CSS-drawn masks replace portraits,
  the normal OS cursor returns, and system fonts take over.
- No telemetry, no network calls (except quiz images/audio you reference in your
  own JSON, and optional GitHub-raw quiz URLs you fetch yourself).

## Privacy

Guest mode lives entirely in `localStorage`: saved quizzes, high scores, XP,
profiles, prompt history, settings. Clear the browser's site data to wipe it
all. Classroom mode additionally stores your account (argon2id hash only),
class membership, shared quizzes, and scores in the configured database —
visible to members of your class. Share links are gzip+base64 of your quiz
JSON — they contain your quiz content and nothing else.

## Troubleshooting

- **"I answered right but it said MISS"** — the built-in samples went through a
  bug early on; current builds normalize every quiz at play time. Hard-refresh
  (⌘+Shift+R) and check the footer shows `BUILD 2.0.0`. Use `🔍 INSPECT` on any
  library card to see exactly what the app expects for each question — if it
  doesn't match what you think is correct, your quiz JSON itself is wrong.
- **No sound** — browsers block audio until the first click; click anywhere
  once. Check the ♫ MUSIC panel bottom-right and Settings → BGM source.
- **Host blocked on a tunnel** — add your domain to `server.allowedHosts` in
  `vite.config.ts` (ngrok wildcards are pre-allowed).

---

*Steal the answers. Take your time.*
