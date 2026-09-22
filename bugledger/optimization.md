# P5 Quiz — Optimization Bug Ledger

Audit date: 2026-09-21. Repo: `/Users/blue/Projects/QuiztojsonPB` (working tree clean, `tsc --noEmit` clean).
Read-only audit: **no repository file was modified.** All measurement scripts live in `/tmp/p5build/`; every browser
override was injected at runtime. The only repo write is this file under `bugledger/`.

Targets measured: local built app + real API/DB on `http://localhost:3011` (devapi), Vite dev on `:5183`
(not used for byte numbers — it serves unbundled TS), live production `https://www.tykunanon.online`.

---

## Summary table

| ID | Finding | Measured evidence | Impact | Severity |
|---|---|---|---|---|
| OPT-01 | Live looks "2.8–4.7× lighter" than local only because local serves raw bytes | local `/assets/index-*.js` `content-length: 256625`, **no** `content-encoding`, `cache-control: no-store`; live same file `content-encoding: br`, 91,206 B on the wire (**2.8×**), `max-age=31536000, immutable`. CSS: local 90,354 raw vs live 19,713 br (**4.6×**). Same build hash `index-CFCI_iFv.js` on both | Not a user-facing win — **measurement artifact**. Nothing to fix on the server; it does invalidate every local byte budget | P2 |
| OPT-02 | The 294 kB `quizscreen` chunk is 88.7 % KaTeX, used only for `$…$` formulas | sourcemap attribution: `node_modules/katex/dist/katex.mjs` = **258,446 B of 291,242 B (88.7 %)**; rest is `ui/quizscreen.ts` 22,452 B + `engine/quiz.ts` 9,966 B. Chunk raw 294,134 / gzip 86,730 / brotli 72,642 | Every entry into a quiz pays 258 kB of parser work for a feature most quizzes never use | P0 |
| OPT-03 | All 5 language dictionaries are in the **eager** entry chunk | attribution: th 20,648 + es 22,043 + fr 22,092 + de 21,952 + ja 16,886 = **103,621 B (45 % of the 230,021 B attributed entry chunk)**. `src/core/i18n.ts:19-23` statically imports all five; `main.ts:32` imports `t` | English users download and parse ~104 kB (≈40 kB brotli) of Thai/Spanish/French/German/Japanese strings to see the title screen | P0 |
| OPT-04 | 6 font files (124,964 B) are fetched to paint the title, one of them a 19 kB Kanit face used by a single glyph run | live+browser: 6 font requests = 124,964 B; `kanit-latin-700-normal-xfKc2BN3.woff2` **19,276 B**. Title body copy resolves to `"Barlow Condensed", Kanit, "Arial Narrow", sans-serif`; the Thai subset is correctly **not** fetched (`status: "unloaded"`, 0 bytes) | ~19 kB + 1 RTT spent on the one face that only a menu/ransom string needs | P1 |
| OPT-05 | `dist/` ships every KaTeX face in 3 formats; only woff2 is ever fetched | dist/assets: 20 `.ttf` = **513,664 B**, 20 `.woff` = 483,224 B, 19 `.woff2` = 489,116 B (60 files, ~1.49 MB). Built CSS declares all three per face (`@font-face{…src:url(*.woff2),url(*.woff),url(*.ttf)}`) | 513,664 B of dead truetype payload in every deploy and in any offline/precache payload. Not on the first-load path | P2 |
| OPT-06 | KaTeX cost lands on the wire at the moment math renders: +42,712 B of fonts on top of the 258 kB module | forcing the real `$x^2$` DOM: `KaTeX_Main-Regular-B22Nviop.woff2` 26,272 B + `KaTeX_Math-Italic-t53AETM-.woff2` 16,440 B = **42,712 B**, `font-display:block` on those faces | A single formula costs ~44 kB of fonts + a block-period of invisible math text | P1 |
| OPT-07 | Module-level `import katex from "katex"` in the screen, with no `$` guard | `src/ui/quizscreen.ts:3` static import; `renderMarkdown` (`:110-140`) calls `katex.render` at `:118` only for `$…$`; only 1 of 4 bundled sample quizzes contains a `$` (math.json). No `text.includes("$")` fast path | Guarantees the 258 kB chunk is loaded for every quiz, including quizzes with zero math | P1 |
| OPT-08 | The quiz timer animates `width` — a layout property — for the whole quiz | `src/ui/quizscreen.ts:918` `fill.style.width = pct%` (measured **10 writes/sec**, not 60); a live `width` transition, and the app writes `style.width` inline while `.timer-fill` also animates `blade-slide` (`src/styles/components.css:386-401`). Quiz idle shows **60 recalc/s + 60 layout/s, 105.85 ms/s of main-thread task time** vs **1.3 recalc/s + 20.4 ms/s** for the same app on the title screen | The quiz screen is the most expensive idle state in the app; `width` cannot be composited, so the whole layout pipeline stays hot. *Caveat: the layout attribution is not isolated — see Uncertainties* | P1 |
| OPT-09 | The particle canvas never sleeps: ~1,235 draw calls/second forever | instrumented `ctx.fillRect/arc/drawImage/fill/stroke`: **1,187–1,235 draws/sec** while idle; app loop dispatches **60 frames/sec** on desktop (`window.__p5qPerf.frameCount()`), canvas 1280×800 @ dpr 1.5. Disabling animations *and* the canvas drops title idle task time from 46.28 → 20.4 ms/s; hiding the canvas alone accounts for ≈11.4 ms/s (46.28 with anims on → 31.8 with anims off; 31.8 − 20.4 = 11.4). `src/core/perf.ts:59` `ambientDust = !mobile` intentionally keeps it awake | ~11 ms/s of main thread plus a permanently warm GPU/CPU on a decorative background, on battery-powered devices too (mobile gets 220 particles @30 fps instead of 0) | P1 |
| OPT-10 | Idle cost grows after visiting other screens (teardown residue, not a heap leak) | title idle task time **46.28 ms/s** on a fresh load → **75.02 ms/s** after `library → settings → profiles → title`; style work 10.21 → 20.39 ms/s, recalc 60 → 64.7/s. Live animation count on the title screen after a cycle: **16** (`ch::jitter` ×11, `cursor-mark::pulse`, `bg-layer::stripe-drift-115`, `star-spin` ×2, `bg-layer::halftone-drift`, plus `menu-item` opacity/transform) | Cost creeps up as a session goes on; a user who browses screens and returns to the menu pays ~60 % more idle CPU than at boot | P1 |
| OPT-11 | No `@preload`/`modulepreload` for the entry asset and no font preload in the built HTML | `dist/index.html` contains only the module script + stylesheet; fonts are discovered only after `index-19ox8SBE.css` (90 kB raw) is parsed. HTML also has no early connection hint | Fonts start ~1 CSS round-trip later than they could; with `font-display:swap` this is the FOUT window | P2 |
| OPT-12 | 5,411 B of exactly duplicated declaration blocks; 95 redundant rule copies | brace-exact parser over `src/styles/*.css`: 53 groups, 95 redundant copies, **5,411 B**. Worst: `.admin-tabs .sticker-btn.active{background:var(--red);color:var(--paper)}` ×6 across admin/components/p5/screens; `.match-col{display:flex;flex-direction:column;gap:8px}` ×6; `.q-section{color:var(--red)}` ×7 | Dead weight in the critical-path stylesheet and a divergence hazard (edit one copy, not the other) | P2 |
| OPT-13 | 14 class selectors have no reference anywhere in `src/**/*.ts` or `index.html` | token scan of 507 CSS classes against the full TS+HTML corpus: `profile-card, profile-mask, profile-grid, profile-eyes, profile-name, profile-xp, profiles-body, shine, has-art-home, menu-art, title-menu, prompts-intro, prompts-intro-sub, prompt-fix` (0 references each) | ~14 stale selectors kept alive; each is a rule a future edit can silently "fix" without effect | P2 |
| OPT-14 | `!important` is used 34 times, 22 of them in one file | `screens.css` 22, `components.css` 6, `p5.css` 5, `admin.css` 1 (+ `:lang(th)` overrides) | Specificity is being patched at the leaves; every later layout fix must out-`!important` the last one | P2 |

**Headline number:** OPT-03 alone is **103,621 B (45 %)** of the eager application chunk — the single largest
removable block of first-load JavaScript in the product.

---

## 1. Bundle composition

### Method (exact, not estimated)

`/tmp/p5build/build.mjs` runs the **same Vite build** as `npm run build` (same root, target `es2022`, esbuild
minifier) with `outDir: /tmp/p5build/out` and `sourcemap: true`. Output is byte-identical to `dist/`
(`index-CFCI_iFv.js` 256,625 B, `quizscreen-BEf3elZc.js` 294,134 B — same hashes). `/tmp/p5build/attribute.mjs`
decodes the real sourcemap VLQ mappings and attributes every generated byte to its originating source module.
Sourcemaps are used only for measurement and are never emitted into `dist/`.

### Eager entry `index-CFCI_iFv.js` — 256,625 B raw / 85,467 gzip / 73,808 brotli

230,021 B of it is attributable JavaScript (the rest is module boilerplate/runtime):

| Bytes | % of chunk | Module |
|---:|---:|---|
| 51,471 | 22.4 % | `node_modules/gsap/gsap-core.js` |
| 22,092 | 9.6 % | `src/i18n/fr.ts` |
| 22,043 | 9.6 % | `src/i18n/es.ts` |
| 21,952 | 9.5 % | `src/i18n/de.ts` |
| 20,648 | 9.0 % | `src/i18n/th.ts` |
| 19,002 | 8.3 % | `node_modules/gsap/CSSPlugin.js` |
| 16,886 | 7.3 % | `src/i18n/ja.ts` |
| 8,226 | 3.6 % | `src/fx/particles.ts` |
| 7,301 | 3.2 % | `src/core/audio.ts` |
| 5,806 | 2.5 % | `src/core/validator.ts` |
| … | | 15 more modules, all ≤ 4,554 B |

Two findings fall straight out:

* **GSAP = 70,473 B (30.6 % of the attributed entry chunk)** — `gsap-core` + `CSSPlugin`. It is in the *eager*
  chunk because `main.ts:24` imports `./ui/dom` at boot (`h`, `clear`, `toast`), `ui/dom.ts:40-41` uses
  `gsap.fromTo` for the toast animation, and `main.ts:23` imports `./fx/cursor`, whose `fx/cursor.ts:2` pulls
  `./transitions` → `gsap`. Twelve call sites across `ui/title.ts`, `ui/profiles.ts`, `ui/load.ts`, `ui/dom.ts`
  are all `fromTo` fade/slide tweens that CSS transitions cover.
* **The 5 dictionaries = 103,621 B (45 %)** — loaded at boot, one of them used.

### Lazy `quizscreen-BEf3elZc.js` — 294,134 B raw / 86,730 gzip / 72,642 brotli

291,242 B attributable, **three** modules:

| Bytes | % | Module |
|---:|---:|---|
| 258,446 | 88.7 % | `node_modules/katex/dist/katex.mjs` |
| 22,452 | 7.7 % | `src/ui/quizscreen.ts` |
| 9,966 | 3.4 % | `src/engine/quiz.ts` |

**KaTeX is 88.7 % of the quiz screen chunk**, and it is *eagerly* imported at `src/ui/quizscreen.ts:3` with
`katex.min.css` at `:4`. The only consumer is `renderMarkdown` (`:110-140`), which calls `katex.render` at
`:118` for text between `$` delimiters — i.e. an inline-math feature. Of the 4 bundled sample quizzes
(`public/sample-quizzes/`), only `math.json` contains a `$`, in one question (`sections[0].questions[3]`,
`"What is the derivative of $x^2$?"`).

*Measured, not inferred:* forcing the real KaTeX DOM for `x²` into the running quiz page downloaded exactly two
font files — `KaTeX_Main-Regular-B22Nviop.woff2` (26,272 B) and `KaTeX_Math-Italic-t53AETM-.woff2` (16,440 B)
= **42,712 B** — and flipped 2 of the 20 `KaTeX_*` font faces from `unloaded` to `loaded` (the other 18 stayed
`unloaded`, confirming per-glyph subsetting works).

### Chunk graph / other lazy chunks

`repair-CBafquXc.js` 15,166 B (jsonrepair, lazily imported by `main.ts:175`, `ui/load.ts:9`, `ui/prompts.ts:21`) —
correctly code-split. `prompts-CZMRLjK7.js` 44,831 B, `dashboard` 12,896, `results` 12,485, `load` 8,987,
`entry` 8,786, `admin` 8,279, `library` 7,159, `settings` 6,542, `profiles` 5,492, `title` 5,313,
`leaderboard` 2,588 — all correctly one-per-screen.

---

## 2. Fonts

Measured on a real English first load (Chrome 1280×800, local build):

| File | Bytes | Why |
|---|---:|---|
| `barlow-condensed-latin-700-normal-v1xN8_Wq.woff2` | 22,444 | ransom headings |
| `barlow-condensed-latin-600-normal-DepVgxBB.woff2` | 22,308 | menu labels |
| `barlow-condensed-latin-400-normal-Dc2u_eUW.woff2` | 21,164 | body |
| `jetbrains-mono-latin-400-normal-V6pRDFza.woff2` | 21,168 | `.mono` / counters |
| `archivo-black-latin-400-normal-BTVu2TQR.woff2` | 18,604 | display |
| `kanit-latin-700-normal-xfKc2BN3.woff2` | **19,276** | only face resolving to Kanit |
| **total** | **124,964** | 6 requests, all uncompressed (woff2 is already compressed) |

* **The Thai (kanit) face is NOT pulled eagerly.** `main.ts:8-9` imports the full `@fontsource/kanit/400.css`
  and `/700.css`, whose `@font-face` blocks carry real `unicode-range` values; the built CSS shows
  `unicode-range:U+0E01-0E5B…` for the Thai subset. On an English page every Kanit face reported
  `status: "unloaded"` and no `kanit-thai-*` file was requested. **Measured: the Thai subset costs 0 bytes on an
  English load.** The full-package import is safe here — the earlier concern does not reproduce.
* **The Kanit *latin* 700 face does load (19,276 B)** because one title element resolves to Kanit 700 (the
  ransom/menu string whose first family is missing a 700 face, or a `.ch` span in the fallback chain). Title
  copy otherwise renders in `"Barlow Condensed", Kanit, "Arial Narrow", sans-serif`.
* `font-display`: `swap` for every @fontsource face (good); **`block` for all 20 KaTeX faces**
  (`@font-face{font-display:block;font-family:KaTeX_AMS;…}` in the built quiz CSS) — math is invisible until the
  font arrives, with no swap fallback.
* **OPPORTUNITY (inferred, sized from measured bytes):** Barlow Condensed ships 3 weights totalling 65,916 B of
  the 124,964 B. `jetbrains-mono` at 21,168 B serves `.mono` tokens.
* The built HTML preloads nothing (`dist/index.html` = script + stylesheet only), so all six faces are
  discovered only after the 90 kB stylesheet is parsed.

---

## 3. Runtime

Method: `puppeteer-core` 25.10.0, Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `headless: "shell"`, 1280×800 (dpr 1),
cursor trail disabled unless stated. Metrics from CDP `Performance.getMetrics`
(`RecalcStyleCount`, `LayoutCount`, `RecalcStyleDuration`, `LayoutDuration`, `ScriptDuration`, `TaskDuration`,
`JSHeapUsedSize`, `Nodes`), each value normalized to **per second** over a 3–4 s window and reported with its
raw millisecond figure. Long tasks came from `PerformanceObserver({entryTypes:["longtask"]})`.

### 3.1 Title screen (the app's cheapest screen) — idle, nothing happening

| Scenario | recalc/s | layout/s | style ms/s | layout ms/s | script ms/s | **task ms/s** |
|---|---:|---:|---:|---:|---:|---:|
| real | 60.0 | 1.0 | 10.21 | 0.16 | 5.29 | **46.28** |
| all CSS animations paused | 1.3 | 1.0 | 0.11 | 0.24 | 5.66 | **31.80** |
| animations paused **and** canvas hidden | 1.3 | 1.3 | 0.11 | 0.21 | 5.45 | **20.40** |
| after 4 screen navigations (back on title) | 64.7 | 5.3 | 20.39 | 0.83 | 8.32 | **75.02** |
| cursor trail enabled + 40 mouse moves | 61.5 | 1.0 | 15.97 | 0.21 | 7.16 | **65.68** |

* rAF cadence is a locked **60.3 fps** (median 16.7 ms, p95 16.7 ms, max 16.8 ms) and the app's own capped
  scheduler dispatched **exactly 60 frames/s**; `longtask` entries: **0**. The app is smooth — it is simply
  never idle.
* **16 animations run continuously on the title screen**: `ch::jitter` ×11 (ransom letters), `cursor-mark::pulse`,
  `bg-layer::stripe-drift-115`, `star-spin` ×2, `bg-layer::halftone-drift`, plus `menu-item` `opacity`/`transform`.
  `src/core/perf.ts:59-61` caps the *canvas* work on mobile but nothing stops the CSS animation set.
* **Not a heap leak:** heap delta over a 4 s idle window was −32,972 B / −374,944 B (shrinking, i.e. GC winning).
  Across 4 navigation cycles (library → settings → profiles → title) heap went 2,162,116 → 2,358,876 → 2,530,900
  → 2,407,132 B and nodes 323 → 709 → 417 → 323, with listeners 40 → 106 → 48 → 40 — it **returns to baseline**,
  so screens do tear down. The *sustained cost* is what grows (OPT-10), not the retained memory.

### 3.2 Quiz screen, mid-question, idle

| Scenario | recalc/s | layout/s | style ms/s | layout ms/s | task ms/s |
|---|---:|---:|---:|---:|---:|
| real | 60 | 60 | 18.86 | 15.16 | **105.85** |
| canvas hidden + animations paused | 60 | 60 | 5.64 | 8.34 | **49.42** |
| canvas hidden, animations running | 60 | 60 | 7.61 | 7.73 | **48.36** |
| canvas visible, animations paused | 60 | 60 | 6.61 | 8.23 | **54.03** |

The quiz is the most expensive idle screen: **~106 ms of main-thread work per second** while the user is just
reading a question. The isolation runs are internally inconsistent (the "everything off" floor still reports 60
layout/s), so the *split* between CSS animations and the canvas is not trustworthy at the 60/s granularity —
what is solid is (a) the totals above, (b) that the canvas alone contributes ~1,235 draws/s, and (c) that the
timer writes `style.width` 10×/s. See Uncertainties.

Node counts stay small on every screen (223–546), so this is compute, not DOM size.

---

## 4. CSS

Source: `src/styles/*.css` = 117,511 B total; `components.css` = 79,394 B / 3,851 lines. Built critical-path
stylesheet `index-19ox8SBE.css` = 90,354 B raw / 17,472 gzip / 15,107 brotli.

| File | Bytes | `!important` |
|---|---:|---:|
| `components.css` | 79,394 | 6 |
| `screens.css` | 17,196 | **22** |
| `responsive.css` | 7,746 | 0 |
| `p5.css` | 7,017 | 5 |
| `admin.css` | 2,151 | 1 |
| `themes.css` | 2,135 | 0 |
| `tokens.css` | 1,872 | 0 |
| **total** | **117,511** | **34** |

**Duplicated declaration blocks (brace-exact):** 820 rules parsed; **53 groups, 95 redundant copies, 5,411 B**.
Largest:

| Copies | Bytes | Selector | Files |
|---:|---:|---|---|
| 6 | 336 | `.admin-tabs .sticker-btn.active` | admin, components, p5, screens |
| 6 | 319 | `.match-col` | components ×6 |
| 4 | 291 | `.toggle-text` | responsive ×4 |
| 7 | 228 | `.q-section` | components, screens |
| 5 | 223 | `.lib-actions` | components ×5 |
| 6 | 202 | `.admin-card.hidden` | admin, components, p5 |
| 4 | 196 | `.q-feedback` | components ×4 |
| 5 | 184 | `.order-chip:hover` | components ×5 |
| 4 | 162 | `.pseg.done` | components ×4 |
| 4 | 141 | `.toggle-row` | responsive ×4 |

**Dead-class candidates** (class token appears in zero `src/**/*.ts` + `index.html` references; 507 classes
scanned, 14 hits): `.profile-card`, `.profile-mask`, `.profile-grid`, `.profile-eyes`, `.profile-name`,
`.profile-xp`, `.profiles-body`, `.shine`, `.has-art-home`, `.menu-art`, `.title-menu`, `.prompts-intro`,
`.prompts-intro-sub`, `.prompt-fix`. Note `profiles-body` and `leaderboard-body` share one selector list, so
removal must keep the live half.

`!important` concentration: `screens.css` holds 22 of 34, including `:lang(th) .menu-item:nth-child(2) .menu-ransom`
font-size overrides that appear as ×2 duplicate blocks (97 B each).

---

## 5. Accidental cost

* **OPT-07 / OPT-02 (KaTeX):** a module eagerly imported for a per-quiz feature; the import is a bare top-level
  `import katex from "katex"` with no `text.includes("$")` guard, so the 258 kB chunk is fetched, parsed and
  evaluated on entering *any* quiz. A cheap guard plus a dynamic `import()` would make it on-demand.
* **OPT-03 (i18n):** static imports of all 5 dictionaries in `src/core/i18n.ts:19-23`; the locale is already
  known from `detectLocale()` at boot, so only one is needed synchronously.
* **OPT-09 (canvas):** `src/core/perf.ts:59` deliberately keeps ambient dust awake on desktop
  (`ambientDust = !mobile && !reducedMotion`) and the frame loop redraws a full-viewport canvas forever
  (1,235 draw calls/s measured). Nothing pauses it while the user reads.
* **Not found / not a problem:** no O(n²) DOM loop was identified. `ransomizeAll` (`src/fx/ransom.ts:60-74`) is a
  single `querySelectorAll` pass per selector. Forced-reflow reads are rare: only 12 read sites in the whole
  `src/` tree (`quizscreen` 6, `prompts` 3, `title` 1, `screens` 1, `theme` 1) and **zero** inside
  `fx/particles.ts`. `validateQuiz` is called on load/import, not per render.
* **Per-render parsing:** `renderMarkdown` runs per question render but only builds DOM; the expensive part is
  the KaTeX call, not parsing.

---

## What I MEASURED vs what I INFERRED

**Measured (numbers in this document):** every byte figure from a real build/sourcemap or a real HTTP response;
every ms/s, count/s, node count, frame cadence and font-file list from a real browser session against the
running app and the live site; CSS counts from a brace-exact parse of the actual stylesheets.

**Inferred (labelled in place):** the *causal split* of idle cost between CSS animations and the canvas on the
**quiz** screen (the isolation matrix did not produce a clean zero floor, so I report the totals and the
canvas draw rate instead of a fabricated attribution); the size of the win from lazy-loading KaTeX/i18n
(derived from the measured module bytes, not from a patched build); the Barlow-weight trimming opportunity.

**Uncertainties / limits**

1. Headless Chrome only (no WebKit/Safari, no real Android/iOS device); dpr 1 and no touch, so mobile
   `lowPower` behaviour (220 particles @30 fps) is not reproduced here.
2. The quiz-screen "all effects off" floor still reported 60 recalc/s + 60 layout/s, which means one
   per-frame style/layout source on that screen is still unattributed. A precise attribution needs CDP
   tracing with `disabled-by-default-devtools.timeline` and per-event inspection, or a bisect build — both
   beyond a read-only audit.
3. The `Performance.getMetrics` deltas fluctuate run to run (quiz totals ranged 74.38 → 105.85 ms/s across
   identical runs), so treat per-second figures as ±20 %.
4. Colour/canvas fidelity and `:5183` (Vite dev, unbundled) were deliberately not used for byte numbers.
5. Local numbers are uncompressed by construction; only live numbers represent real transfer size.

## Reproduction

```bash
# per-module byte attribution (same build as npm run build, output to /tmp)
node /tmp/p5build/build.mjs
node /tmp/p5build/attribute.mjs /tmp/p5build/out/assets/index-CFCI_iFv.js      /tmp/p5build/out/assets/index-CFCI_iFv.js.map
node /tmp/p5build/attribute.mjs /tmp/p5build/out/assets/quizscreen-BEf3elZc.js /tmp/p5build/out/assets/quizscreen-BEf3elZc.js.map

# CSS waste
node /tmp/p5build/cssaudit.mjs

# runtime (servers must be running: devapi on :3011)
node /tmp/p5build/residual.mjs      # title idle / canvas / cursor
node /tmp/p5build/causes.mjs        # animation inventory + KaTeX + timer
node /tmp/p5build/orthogonal.mjs    # quiz fx × animation matrix
node /tmp/p5build/timerab.mjs       # timer width writes + A/B
node /tmp/p5build/katexforce.mjs    # forced KaTeX render → font bytes

# live/local transfer comparison
curl -s -o /dev/null -D- -H 'Accept-Encoding: gzip, deflate, br' https://www.tykunanon.online/assets/index-CFCI_iFv.js
curl -s -o /dev/null -D- http://localhost:3011/assets/index-CFCI_iFv.js
```

Raw JSON evidence: `/tmp/p5build/causes.json`, `/tmp/p5build/residual.json`, `/tmp/p5build/isolate3.json`,
`/tmp/p5build/probe.json`.
