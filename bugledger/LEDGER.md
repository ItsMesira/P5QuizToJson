# P5 QUIZ — BUG LEDGER

Generated from evidence on 2026-09-21 against the working tree at `594d22b` (clean),
local build served by `devapi.mjs` on `:3011`, dev server on `:5183`, live
`https://www.tykunanon.online`.

**47 raw findings** from four parallel audits, merging to **10 root causes**.
Nothing was fixed. Nothing outside `bugledger/` was modified.

> **UPDATE — the fix pass has run.** Fixes 1-6 are implemented, two P0s are proven
> fixed against the pre-fix build, and a **new P0 was found in the process**
> (RC-5: the no-class dashboard crash). See "Fix status" at the end.

| Source | File | Findings |
|---|---|---|
| Async / lifecycle audit | `races.md` | 21 (19 certain, 2 suspected) |
| Optimization audit | `optimization.md` | 14 |
| UI / a11y / local-vs-live audit | `ui-defects.md` | 12 |
| Full 27-harness suite run | `suite-results.json` | 24 pass, 2 fail, 1 missing |

## Verification status of this ledger

Every claim below is labelled. This matters — three plausible hypotheses were
**falsified** during this work and are recorded so nobody re-chases them.

| Label | Meaning |
|---|---|
| **PROVEN** | Reproduced by running the app / reading the code path end to end |
| **MEASURED** | Number captured from a real instrumented run |
| **PLAUSIBLE** | Code path read; mechanism real; **not reproduced** |
| **FALSIFIED** | Actively tested and shown to be untrue |

---

## Root causes (the actual news)

47 findings are not 47 bugs. Four missing primitives generate almost all of them.

### RC-1 — There is no cancellation primitive · **PROVEN**

`src/ui/screens.ts:123-161` gives a screen exactly one teardown hook:

```ts
cleanup?.();
clear(stage);          // detaches the old tree, does NOT destroy it
```

`clear(stage)` **detaches** nodes, so a late async continuation writing to a
detached node fails *silently* instead of throwing. There is **no
`AbortController` anywhere in `src/`** (21 in-flight call sites), and **no fetch
has a deadline** (`src/core/api.ts:42`, `src/ui/admin.ts:22`).

Consequences:
- A hung request leaves `Loading…` on screen forever. In the dashboard those are
  literal `Loading…` text nodes (`src/ui/dashboard.ts:62,73,79`).
- This is precisely why these bugs survive a green test suite.

Emits: RACE-04, RACE-11, RACE-15, UI-08, plus the admin "stranded Loading…"
family already visible in git history.

### RC-2 — Awaited work is not guarded against the screen going away · **PROVEN**

One shape explains 7 of 21 race findings, appearing in **8 of 12 screens**:

```
await cloudCall()  →  DOM writes + GSAP animation  →  no re-check that the screen is still mounted
```

Two P0 instances, both new (in no commit, covered by no harness):

- **`RACE-01`** — `src/ui/quizscreen.ts:766-769`. `finishQuiz()` awaits a
  `cutIn(...)` GSAP timeline, then calls `go({name:"results"})` unconditionally.
  ABANDON HEIST (`:888`) and pause-LOG OUT (`:896`) call `runner.destroy()` and
  route away — but cannot cancel the awaited timeline. Net effect: **quitting
  during the finale dumps you on the results screen anyway**, and
  `clearProgress()` already ran at `:760`, so the abandoned attempt is gone too.
  Same hole at `:697` (an uncleared 1600 ms game-over timer).
- **`RACE-03`** — `src/ui/results.ts:32-41`. The class-score POST is
  `void`-ed with no error check. If it fails, the player sees ALL-OUT ATTACK,
  **the teacher never sees the score**, and there is no toast and no retry.

### RC-3 — Timers have no owner · **PROVEN — 29 sites, 3 ever cleared**

29 bare `setTimeout`/`setInterval` calls in `src/`, only 3 sites ever clear one.
Timers outlive their screen and write into detached DOM or resurrect stale state.

Emits: RACE-07, RACE-09, RACE-16, RACE-17, RACE-18, RACE-19, RACE-21.

### RC-4 — Errors are deliberately swallowed · **PROVEN**

`write()` (`src/core/store.ts`) and `req()` (`src/core/api.ts`) swallow failures.
So the app *looks* fine while silently doing nothing. Worst instance:

- **`RACE-10`** — `src/core/store.ts:121-136`. `currentProfile()` and friends call
  bare `localStorage.getItem/setItem` with **no try/catch**, unlike every other
  accessor in the file. `addProfileXp` runs at the top level of the results mount
  (`src/ui/results.ts:27`), so on a storage-restricted browser (Safari private
  mode, embedded webview, quota) the throw is caught by the router's mount
  try/catch and **replaces the entire results screen with the title screen** plus
  "Something broke on that screen".

### RC-5 — `!` assertions inside conditional DOM · **PROVEN (found during the fix pass)**

Discovered while fixing RC-1, not by the original four audits. `src/ui/dashboard.ts`
builds its shelf column only when the user has a class (`cls ? … : null`), then
asserts elements that live inside it:

- `listBox` / `pagerBox` / `searchInput` / `sortSelect` (`:141-144`)
- `.dash-add` (`:413`)

For a **signed-in user with no class** — i.e. every brand-new account — the mount
threw `Cannot read properties of null (reading 'addEventListener')`. The router's
`catch` around the mount then replaced the whole dashboard with the title menu and
a toast. Result: a new account could never see its own dashboard or the
"NO CLASSROOM YET" screen at all.

This is the clearest example of why the bugs felt unidentifiable. `uifixtest.mjs`
had been reporting exactly this ("refresh #dashboard keeps session — screen
title-screen", "no-class dashboard shows NO CLASSROOM YET panel" ×2) and it read
as test flakiness rather than a broken user flow. Three of the suite's failures
were this one crash.

**The generalisable lesson:** a screen that builds DOM conditionally must never
`!`-assert below the branch. RC-5 is that rule, not one selector.


---

## Ranked fix list

Relief per line of code, not severity theatre.

| # | Fix | Root cause | Evidence | Effort |
|---|---|---|---|---|
| 1 | Toast removal must not depend on `gsap`'s `onComplete`; add a plain `setTimeout` teardown, a dismiss control, `pointer-events:auto`, and a stack cap | RC-4 | **PROVEN** — `src/ui/dom.ts:31-43`, 49 call sites, no cap | ~15 lines |
| 2 | A mount guard + `AbortController` per route; hang a `signal` on every `req()` and give it a deadline | RC-1 | **PROVEN** — zero `AbortController` in `src/` | ~60 lines |
| 3 | `RACE-01` guard: re-check the screen is still current after every `await` in `finishQuiz()` | RC-2 | **PROVEN** — quit during finale lands on results, progress already cleared | ~10 lines |
| 4 | `RACE-03`: await the class-score submit, surface failure, offer retry | RC-2 | **PROVEN** — silent score loss for teachers | ~15 lines |
| 5 | `RACE-10`: route all `localStorage` access through the existing `read`/`write` helpers | RC-4 | **PROVEN** — results screen blanked on storage-restricted browsers | ~5 lines |
| 6 | `RACE-04`: deadlines on every fetch | RC-1 | **PROVEN** — permanent `Loading…` | ~20 lines |
| 7 | Lazy-load the 5 locale dictionaries | OPT-03 | **MEASURED** — 103,621 B = **45%** of the eager entry chunk | ~30 lines |
| 8 | Load KaTeX only when a quiz actually contains `$` | OPT-02/07 | **MEASURED** — KaTeX is **88.7%** of the 294 kB quiz chunk | ~20 lines |
| 9 | `RACE-08` session fix: await the session instead of racing it | RC-1 | **PLAUSIBLE** — see below | ~10 lines |

Items 1-6 are all one primitive each and share two mechanisms, so they are best
done as one pass: cancellation + owned timers + surfaced errors.

### The optimization findings worth knowing

- **OPT-03 (biggest single win)** — `src/core/i18n.ts:19-23` statically imports
  `th, es, fr, de, ja` = 103,621 B, **45% of the eager chunk**, to serve exactly
  one locale.
- **OPT-02** — 258,446 B of the 291,242 B attributed `quizscreen` chunk is KaTeX,
  for an inline-`$…$` feature. Only 1 of 4 bundled samples uses it.
- **OPT-09** — the particle canvas never sleeps: ~1,235 draw calls/sec at idle,
  title-screen task time 46.28 ms/s; hiding the canvas drops it to 31.80.
- **OPT-10** — idle cost **grows** after visiting screens (46.28 → 75.02 ms/s,
  16 animations still live on the title). Heap returns to baseline, so it is
  teardown residue, **not a leak**.
- **OPT-08** — the quiz timer animates `width` (a layout property): 60 layout/s,
  105.85 ms/s task time while idle.
- **OPT-12/13** — 5,411 B of exactly duplicated CSS (95 copies), 14 selectors with
  zero source references, 34 `!important`.

---

## Falsified hypotheses (do not re-chase)

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Production runs a stale/older build than local | **FALSIFIED** | SHA-256 identical: `index-CFCI_iFv.js` = `617bdb93…63dd` both sides; `index-19ox8SBE.css` and `quizscreen-BEf3elZc.js` match too; live sends `x-vercel-cache: HIT` |
| Live is 2.8× better optimized than local | **FALSIFIED** | Transfer artifact: local `devapi` serves raw with `no-store`; live brotli-compresses the same bytes (256,625 → 91,206) |
| `admintest` "all admin tabs render content" is broken | **FALSIFIED** | Failed once under CPU contention, then passed **3/3** (local + production) on clean re-runs. Flaky harness, not an app bug |
| Thai font loads eagerly for English users | **FALSIFIED** | All Kanit faces report `unloaded`, 0 bytes fetched; `unicode-range` works |
| Browser Back button is broken by the hash router | **FALSIFIED** | `#profiles → back → #settings` rendered correctly, `history.length` sane |
| Scroll position is not reset between screens | **FALSIFIED** | Resets 600 → 0 on every navigation, fresh node per mount |
| `uifixtest` 3× dashboard failures | **LOCAL ARTIFACT** | Not a bug — but also **not yet proven safe**, see RACE-08 below |

## Unproven risks (recorded honestly)

- **RACE-08 — the 2.5s boot cap.** `src/main.ts:110-113` races session restore
  against a 2500 ms timeout, and `src/ui/dashboard.ts:23-27` treats
  `cloud.session === null` as "not signed in" → bounce to sign-in. Measured
  production `/api/auth/me` latency was **433 ms and 2370 ms** — the slow call is
  within 130 ms of the cap. I then delayed `/api/auth/me` by 4000 ms with a
  genuinely signed-in session and the dashboard **stayed put**. So: real
  mechanism, plausible production trigger, **not reproduced**. Either verify with
  a real cold Supabase and a deep link, or fix it as a cheap hardening (~10 lines)
  rather than as a confirmed bug.
- **`load.ts:28` awaits `cloudReady()` correctly while `dashboard.ts:23` reads it
  synchronously.** One of the two is wrong; the inconsistency is the finding.
- **Resume path** (`src/ui/quizscreen.ts:962-981`) sets
  `runner.index = prog.index - 1` and restores only when order lengths match. An
  earlier measurement suggesting a reload loses answer options was
  **self-contaminated and deliberately excluded**; it needs a clean-profile re-run.
- `uifixtest.mjs`'s failing assertions are unreliable locally because the app
  works over HTTP while `SECURE_COOKIES` is set in `.env`.
- All browser evidence is headless Chrome. No WebKit/Safari, no real mobile device.
- `studiestest.mjs` does not exist; the file is `studytest.mjs` (see README:372).

---

## Why this changes the rewrite decision

The rewrite question was asked before this ledger existed. Now it can be answered
with numbers:

- The suite is **24/27 green** and the deploy is **current**. The codebase is not
  rotten — it is *unhardened in four specific, shared primitives*.
- **Four mechanisms generate 19 of 21 async findings.** A rewrite does not remove
  them; it re-implements them, in new code, with new bugs — and it would discard
  the 25 harnesses, the quiz normalisation that prevents "answered right, said
  MISS", resume/shuffle alignment, and the whole tested `api/` + `db/` layer.
- The real defects are **~135 lines of surgical work** (fixes 1-6), each with a
  deterministic repro. Items 7-8 are another ~50 lines for a measured 45% and
  88.7% payload reduction.
- Therefore: **harden the primitives first, then decide.** If those six fixes make
  the app feel stable, there is nothing to rewrite. If new bug classes keep
  appearing *after* cancellation, owned timers and surfaced errors are in place,
  that is the honest signal to strangle the UI layer screen by screen — keeping
  `src/core`, `src/engine`, `api/` and `db/` intact.

## Reproduce this ledger

```bash
node bugledger/run-suite.mjs                      # 27 harnesses, sequential, JSON out
node bugledger/regression.mjs --base http://localhost:5183   # the 6 primitives, from source
node bugledger/regression.mjs --base http://localhost:3011   # same guards, on the built bundle
node bugledger/session-proof.mjs --base http://localhost:3011 --delay 4000
P5Q_BASE=http://localhost:3011 node mobileaudit.mjs
P5Q_BASE=http://localhost:3011 node perfaudit.mjs --label postfix --baseline .gauntlet/artifacts/baseline.json
```

Requires the dev server on `:5183` (`npx vite --port 5183`) and `node devapi.mjs 3011`.
Tests run sequentially on purpose: parallel puppeteer runs contend for CPU and
produce misleading timings and false failures.

---

# Fix status — all six primitives implemented and verified

## What changed

| Fix | Root cause | Files |
|---|---|---|
| 1. Toast lifetime independent of gsap, capped stack, dismiss control, honours reduced motion | RC-4 | `src/ui/dom.ts`, `src/styles/p5.css` |
| 2. Route-scoped `AbortController`; `resetRouteScope()` on every navigation; `scopedTimeout`/`scopedInterval`/`scopedRaf` helpers | RC-1, RC-3 | **new** `src/core/runtime.ts`, `src/ui/screens.ts` |
| 3. `RACE-01` finale-quit guard (mount re-check + idempotent finish) | RC-2 | `src/ui/quizscreen.ts` |
| 4. `RACE-03` class-score submit awaited, failure surfaced, retry offered | RC-2 | `src/ui/results.ts`, `src/styles/screens.css` |
| 5. `RACE-10` all `localStorage` routed through safe helpers | RC-4 | `src/core/store.ts` |
| 6. Request deadlines (12s) on every fetch, with timeout distinguished from cancellation | RC-1 | `src/core/api.ts` |
| **7. RC-5 (new P0): no-class dashboard crash** | RC-5 | `src/ui/dashboard.ts` |

## Proof the fixes are real, not just green

The regression guards were run against a **pre-fix build** (`594d22b` in a git
worktree, built and served separately), so every claim below is a demonstrated
before/after, not an assertion:

| Check | Pre-fix build | Fixed build |
|---|---|---|
| T3 quitting during the finale | **FAIL** — `final=screen results-screen hash=#results` | PASS — `final=screen title-screen hash=#title` |
| T4 hung request | **FAIL** — `before=3 after=3 text="Loading…"` (stranded forever) | PASS — `after=0 text="The server took too long to respond"` |
| T1 toast expiry with gsap blocked | PASS (gsap loaded fine) | PASS |
| T2 toast stack bound | could not measure (no dismiss control in pre-fix build) | PASS — `kept=4` |
| T5 navigation aborts the old scope | n/a (primitive did not exist) | PASS — `oldAlive=false newAlive=true` |

## Suite result: 27 pass, 0 fail, 0 timeout, 0 missing

Down from **24 pass / 2 fail / 1 missing** at the start of this work. `uifixtest`'s
three long-standing failures were all RC-5 and are now green, and the "missing"
entry was a filename typo in my own runner (`studiestest.mjs` vs `studiest.mjs`),
now fixed and verified passing.

## Performance after the changes

`485,945` eager bytes vs the `492,804` baseline (still below it), title boot
66-113 ms, CSS `91,305` within the contract's `0.90` budget (`<= 92,494`).

---

# Pass 2 — perceived latency, the loading screen, and spam clicking

Reported symptom: *"when I click something there's a delay… too long for users,
people think it's a misclick so they spam click and the UI breaks."*

## What was actually measured

`bugledger/latency.mjs` and `bugledger/shots.mjs`, on the built bundle:

| Observation | Value |
|---|---|
| Click → first question visible | **~280–800 ms** |
| Window showing a dark veil with **no indication anything is happening** | **80 ms → 600 ms** |
| At 160 ms the screen contained literally only the cursor sprite | screenshot `bugledger/shots/0160ms.png` |
| The old library PLAY path | ~800 ms to first question |

So the complaint was accurate, and its cause was not one slow function: it was a
**600 ms window with zero feedback**, which reads as a dropped tap.

## Fix 1 — cut the real payload (OPT-02/OPT-07)

KaTeX was **88.7% of the quiz chunk** and was imported eagerly, so *every* quiz
start downloaded it, including the 3 of 4 bundled samples with no math at all.
It is now imported on first actual `$…$` use.

| Chunk | Before | After |
|---|---|---|
| `quizscreen-*.js` | 294.17 kB (87.27 kB gzip) | **32.95 kB (10.39 kB gzip)** |
| `katex-*.js` | (inside quizscreen) | 255.2 kB — **only when math exists** |

Verified both directions in `bugledger/loading-ux.mjs`: a math quiz renders
KaTeX (`katexNodes: 2`, no raw `$`), and a math-free quiz fetches
**`fetchCount=0`** KaTeX bytes. That is **~261 kB off the critical path** for most
quizzes — the part that matters on a real network, which localhost cannot show.

## Fix 2 — the heist loader

New `src/fx/loader.ts` + `src/styles/p5.css`. It renders inside the **existing
veil**, so it needs no new timing logic and dies with the wipe it belongs to.

- kicker **TAKING YOUR HEART** in the display face, skewed
- a route-specific subtitle — `INFILTRATING THE PALACE`, `TALLYING THE LOOT`,
  `CHECKING THE CREDENTIALS`… because a specific label reads as faster and more
  trustworthy than a generic spinner
- a red→gold progress bar and blinking diamond ticks
- a drifting diagonal band behind it, offset left of the wipe's stripe axis so the
  card sits *in* the composition instead of floating on top of it
- 140 ms show delay, so fast routes stay flicker-free; reduced motion never shows it

Effect: the transition went **800 ms → 420 ms** and is now covered end to end.

## Fix 3 — the tap is acknowledged in the same frame

`.is-busy` is applied on **`pointerdown`** (which fires *before* activation, so it
cannot suppress the action). The control dims, desaturates and gets a moving
stripe overlay immediately — no more waiting 600 ms to find out if the click took.

## Fix 4 — spam cannot start competing navigations

One lock in `go()` covers all **11 `startQuiz` call sites**. It absorbs repeat taps
on the *same* route, lets a genuinely different navigation through, and has a
4 s watchdog so navigation can never be permanently locked out.

## Bugs I introduced during this pass, and caught

Recording these because they are the strongest argument for the harness:

1. **`pointer-events:none` on `.is-busy` swallowed the click itself.** Setting it
   on pointerdown removed the control from hit-testing, so the tap did nothing —
   the exact bug I was trying to fix. It is now purely cosmetic; duplicates are
   absorbed by the router instead. Caught by `loading-ux.mjs`.
2. **The nav lock dropped legitimate navigations.** Holding it through the
   wipe-out meant a real navigation made in that window was silently ignored while
   the hash had already changed, desynchronising URL and screen. It is now
   released the moment the screen mounts. Caught by `loading-ux.mjs`.
3. **Disabling the control on acknowledge swallowed the in-flight click.**
   Removed; `.is-busy` alone carries the feedback.

## Also removed: 2,981 bytes of dead CSS

13 selectors with zero references anywhere (`has-art-home`, `menu-art`,
`title-menu`, `profiles-body`, `profile-*`, `prompts-intro`, `prompt-fix`, `shine`)
were deleted. This is what paid for the new CSS rather than moving the budget:
CSS is `91,305` bytes against the `<= 92,494` contract bound.

Evidence: `bugledger/loading-ux.mjs` (8 checks), `bugledger/latency.mjs`,
`bugledger/shots.mjs`, `bugledger/loader-mobile.mjs` (3 phone viewports),
`screenshots in `bugledger/shots/` (`0160ms.png` desktop, `loader-390x844.png`).

The suite runner now includes these three ledger suites, so the count is **30
harnesses** (`run-suite.mjs`), all passing.

## Still open

- **Locales (OPT-03)** remain the single biggest payload win: 103,621 B = **45% of
  the eager chunk** for one locale. Not done yet.
- Particle canvas still never sleeps (OPT-09); idle cost still grows after
  navigating screens (OPT-10).
- RACE-08 still unproven.

## Two bugs I introduced and the suite caught (pass 1)

1. `cloudReady()` was rewritten to bypass `cloud.me()` and stopped calling
   `setSession()`, so the restored session was never published and `#dashboard`
   bounced to `#entry`. Caught by `stalechunktest.mjs`.
2. The RC-5 crash itself was pre-existing, not introduced — but it only became
   visible once fix 1 was in place, because the router's catch had been quietly
   substituting the title menu for the broken dashboard.

## Still open (deliberately not done)

- **RACE-08** session-vs-2.5s-cap: still unproven. Harden or verify with a real
  cold Supabase — do not treat as confirmed.
- The remaining **optimization findings**: locales are still 45% of the eager
  chunk, the particle canvas still never sleeps, and the title screen still costs
  46–75 ms/s at idle. (KaTeX is now fixed — see pass 2.)
- Other RC-1/RC-3 call sites outside the six fixed paths still use bare timers;
  the primitive now exists, but the sweep is not finished.

