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
npm run dev        # http://localhost:5183
```

Production build (static files, hostable anywhere):

```bash
npm run build      # outputs dist/
npm run preview    # serve dist/ locally
```

No server is required — open the built `dist/index.html` from any static host
(GitHub Pages, Netlify, `python -m http.server`, …). Everything (scores, quizzes,
prompts, settings) is stored in your browser's `localStorage`.

---

## How to play

1. **Load a quiz** — `BEGIN HEIST` → drop a `quiz.json`, browse, paste, fetch a URL,
   or pick a built-in sample (Persona 5 trivia, General, Math, Code).
2. **Answer** — keyboard `1-4` + `Enter`, or click. Lifelines: **50/50**, **skip**,
   **hint**, **flag for review**. `Esc` pauses (timer actually freezes).
3. **Results** — All-Out Attack finale, rank S–F, stat radar, per-question review,
   achievements, XP. `🎯 Reinforce weak areas` builds a retest prompt from your
   actual misses.
4. **Title menu** — `↑↓` navigate · `Enter` confirm · `1-5` jump · `Esc` deselect.
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
src/
  core/     types, validator, store (localStorage), share (gzip links),
            prompts (master-prompt engine + 14 presets), audio (synth + file BGM),
            art (portrait registry)
  engine/   quiz runner, scoring, achievements
  fx/       particles (canvas), transitions/cut-ins, ransom lettering, sprite cursor
  ui/       title, load, library, quiz, results, prompts, settings, profiles,
            leaderboard, screens (router)
  styles/   tokens, p5 (ambient/cursor), components, screens
public/
  audio/    background.mp3, select.mp3
  art/      cut-in portraits, card art
  cursors/  30-frame animated cursor sprite strips
  fonts/    Persona5main.ttf
  sample-quizzes/  persona5, general, math, code
```

## Test suite (dev tools)

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

Everything lives in `localStorage`: saved quizzes, high scores, XP, profiles,
prompt history, settings. Clear the browser's site data to wipe it all.
Share links are gzip+base64 of your quiz JSON — they contain your quiz content
and nothing else.

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
