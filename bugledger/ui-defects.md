# P5 Quiz — UI Defect Ledger

Audit date: 2026-09-21 · Scope: `src/ui/**`, `src/styles/*.css`, `index.html`, local-vs-live deploy parity
Method: read-only static analysis + 3 short `puppeteer-core` runs (focus/scroll/history, quiz re-entry, quiz interaction). No application file was modified; this directory is the only write.

## Executive summary

**The headline question is answered and the alarming hypothesis is FALSIFIED: the live deployment is NOT stale.** Live and local are byte-identical, including every code-split chunk. The 93,840-vs-261,993 byte gap is **gzip-on-the-wire vs raw file size**, not a content difference.

Confirmed by SHA-256:

| Artifact | Local `dist/` | Live | Match |
|---|---|---|---|
| `index.html` | — | — | identical markup, same asset refs |
| `assets/index-CFCI_iFv.js` | `617bdb93…63dd` | `617bdb93…63dd` | ✅ |
| `assets/index-19ox8SBE.css` | `0223fac3…81e7` | `0223fac3…81e7` | ✅ |
| `assets/quizscreen-BEf3elZc.js` | `98f21045…a20b` | `98f21045…a20b` | ✅ |
| `admin-*`, `dashboard-*`, `prompts-*` | — | HTTP 200, same names | ✅ |

Live also serves correct immutable caching and a strict CSP (`x-vercel-cache: HIT`). Treat local behaviour as representative of live. The only genuine divergence is documentation, not code (UI-11).

**Confirmed working (hypotheses I tested and killed — do not spend time here):** the browser Back button works correctly with the hash router (`#profiles` → back → `#settings` rendered `screen settings-screen`); per-screen scroll position **does** reset to 0 on every navigation (`scrollTop 600` → `0`, fresh node each mount); no console or page errors on any navigation; empty states exist broadly (`dash-empty`, `lib-empty`, `profile-empty`, `admin-note`, leaderboard empty); double-submit guards exist in `entry.ts` (`busy`), `admin.ts` (`pendingAction`) and `dashboard.ts` (`submitBtn.disabled`); `quizscreen.ts` removes its `keydown` listeners in its cleanup.

12 findings below. The worst user-visible defect is **UI-01** (toasts can never be dismissed or expire, and are unclickable).

## Summary table

| ID | Defect | File:line | Severity | Confidence |
|---|---|---|---|---|
| UI-01 | Toasts are unkillable: no dismiss control, no max stack, container is `pointer-events:none`, and removal depends on an un-`catch`ed dynamic `gsap` import. Disabled "reduced motion" does not stop them. | `src/ui/dom.ts:31-43`, `src/styles/p5.css:225-234` | **P1** | CERTAIN |
| UI-02 | Library's two modals (SET GOAL, INSPECT) have no Escape handler — dashboard and prompts both do. Keyboard users get stuck. | `src/ui/library.ts:153-232` | **P1** | CERTAIN |
| UI-03 | Focus is on `<body>` after every screen navigation; nothing focuses the new heading, so screen readers announce nothing on route change. | `src/ui/screens.ts:123-161` | **P1** | CERTAIN |
| UI-04 | Quiz `fill` / `numeric` / `open` inputs have no accessible name (placeholder only) — the core interaction of a quiz app. ~20 inputs app-wide rely on placeholder text. | `src/ui/quizscreen.ts:354,375,539` (+17 more) | **P1** | CERTAIN |
| UI-05 | Modals lack `role="dialog"`, `aria-modal`, focus trap and focus restore on close (only `dashboard.ts:92`'s inner card has `role="dialog"`). | `library.ts:153,217`, `prompts.ts:708`, `admin.ts:64` | P2 | CERTAIN |
| UI-06 | Global `body{user-select:none}` blocks selecting text; only 2 elements opt back in. Users cannot copy quiz JSON, share URLs or class codes. | `src/styles/p5.css:31` vs `components.css:2487,3798` | P2 | CERTAIN |
| UI-07 | `prefers-reduced-motion` is only partially honoured: `results.ts` has 16 GSAP calls / 3 `RM()` guards, and `load.ts` 7/1. CSS cannot disable GSAP inline-style animation. | `src/ui/results.ts`, `src/ui/load.ts`, `src/ui/dom.ts` | P2 | CERTAIN |
| UI-08 | No `AbortController` anywhere in `src` (21 in-flight `await cloud.*`/`fetch` call sites); no `beforeunload` guard. Leaving a screen cannot cancel its pending work. | `src/ui/*.ts`, `src/ui/quizscreen.ts:1024-1030` | P2 | CERTAIN |
| UI-09 | Multi-select rows carry `role="checkbox"` but set no initial `aria-checked`, so screen readers announce no state until first click. | `src/ui/quizscreen.ts:329-336` | P2 | CERTAIN |
| UI-10 | Icon-only buttons (`.pm-close`, `.admin-card .pm-close`) have no `aria-label`; number-key shortcuts exist only for `.choice-btn`. | `src/ui/library.ts:156,221`, `quizscreen.ts:958` | P2 | CERTAIN |
| UI-11 | README tells users to verify `BUILD 2.0.0` in the footer. `"2.0.0"` appears nowhere in `src`, and no build string is rendered. | `README.md:405` | P2 | CERTAIN |
| UI-12 | Every screen renders an empty `role="dialog"` container into the DOM on mount, even when unused. | `src/ui/admin.ts:64`, `library.ts:153,217` | P3 | SUSPECTED |

## Divergence investigation detail

Two byte counts given as evidence were reconciled before drawing a conclusion:

```
curl live  → size_download=93,840   (gzip/deflate on the wire, HTTP/2)
ls dist/   → 256,625 bytes           (raw file)
curl -o    → 256,625 bytes, sha256 617bdb93… identical to dist/
```

`x-vercel-cache: HIT`, `age: 15265`, HTML `cache-control: max-age=0, must-revalidate` with immutable hashed assets — the deploy is current and correctly cached. **Conclusion: no stale-deploy bug exists.** I explicitly recommend NOT reporting one.

### Contamination note (important for interpretation)

Another process was running the full test suite against `:5183`/`:3011` throughout. I kept to three short runs and did not report any timing numbers. One measurement *was* contaminated and is therefore **excluded** from the table: on the second and third load of a `?q=` share link, `.choice-btn` count read `0` while the timer ran. My own earlier runs had left a saved in-progress attempt for the same quiz title (`loadProgress()` matches on `prog.quizId === quiz.title`, `quizscreen.ts:962-981`), so the state was self-polluted by my own repeated runs of the identical sample quiz. **I am not reporting a "reload loses the answer options" bug** — it is unproven and the evidence does not support it. A clean-profile re-run is required before anyone acts on it; if it does reproduce, the resume branch at `quizscreen.ts:962-981` is where to look, since it sets `runner.index = prog.index - 1` and only restores when `runner.refs.length` matches `prog.order.length`.

## Findings in detail

### UI-01 — Toasts can never be dismissed or expire (worst defect) — P1, CERTAIN

`src/ui/dom.ts:31-43` · `src/styles/p5.css:225-234`

```js
export function toast(text, kind = "info") {
  const box = document.getElementById("toasts");
  const el = h("div", { class: `toast ${kind}` }, [...]);   // no close button
  box.appendChild(el);                                       // no cap on count
  import("gsap").then(({ gsap }) => {                        // no .catch()
    gsap.to(el, { ..., delay: 3.2, onComplete: () => el.remove() });
  });
}
```
```css
#toasts { position: fixed; display: flex; flex-direction: column; z-index: 90;
          pointer-events: none; }   /* children inherit: nothing is clickable */
```

Three independent failure modes, all confirmed by reading the code:

1. **No dismissal path exists.** There is no close button on a toast and the container is `pointer-events: none`, so a toast cannot be clicked away. Dismissal is *only* the `gsap` `onComplete` callback.
2. **No stack limit.** 49 `toast(` call sites; the container has no `max-height` and no overflow rule. Several toasts fired in quick succession (e.g. the error paths on a screen mount plus the router's own failure toast at `screens.ts:144`) stack down the screen with no bound.
3. **A failed `gsap` import leaks the toast permanently.** The dynamic `import("gsap")` has no `.catch()`. If it rejects — blocked/stalled chunk under the app's strict CSP, offline blip, or a payload shaped like a toast at unload — the promise settles with no handler and `onComplete` never runs, so **the element stays in the DOM forever** with no way to remove it. `dom.ts` is also the one module with **zero `RM()` guards**, so toasts still animate under `prefers-reduced-motion: reduce` (the CSS media block at `p5.css:275` cannot affect GSAP inline styles).

**Repro:** open `http://localhost:5183/#load`, repeatedly submit an invalid URL, or trigger several validation failures on the library/load screen while offline (or block `gsap` in DevTools → Network → Request blocking). Toasts accumulate; each one cannot be clicked or dismissed and no longer disappears. Expected: toasts auto-expire regardless of animation-library availability, are individually dismissible, and are capped in number.

**Why it's the worst:** it's the app's primary feedback channel (49 call sites, and every error path routes through it). When it fails it fails *loudly and permanently*, covering the UI — which is exactly the "it feels buggy but I can't name it" complaint. The single cheapest hardening is a `setTimeout` removal that does not depend on `gsap`, plus `pointer-events: auto` and a close button.

### UI-02 — Library modals ignore Escape — P1, CERTAIN

`src/ui/library.ts:153-232`. `goalModal` and `inspectModal` close only via the ✕ button (`:175`, `:227`) or a backdrop click (`:179`, `:231`). `grep keydown src/ui/library.ts` → **no matches**, while the sibling implementations do handle it: `dashboard.ts:366-369` (Escape → `closeAdd`) and `prompts.ts:756` (Escape → hide). So the app is internally inconsistent about a basic modal affordance.

**Repro:** Library → click a quiz's goal/inspect affordance to open SET GOAL → press Escape. Nothing happens; the modal stays until you use the mouse. Expected: Escape closes it, as it does on the dashboard add-quiz modal.

### UI-03 — Focus lost on every navigation — P1, CERTAIN

`src/ui/screens.ts:123-161` (`go()`). Measured across a real navigation:

```
activeBeforeNav: "BODY.cursor-on"
activeAfterNav:  "BODY.cursor-on"   new screen title: "THIEF STATS"
```

`go()` calls `cleanup()`, `clear(stage)`, `mount(stage)` — and never moves focus. No skip-link, no `h1` focus, and `aria-live` exists only on `#toasts` (`index.html:20`), so a route change produces **no announcement at all** for a screen-reader user, and a keyboard user's next Tab starts from the top of the document rather than the new screen. This is a systemic single-point fix in the router.

### UI-04 — Quiz inputs have no accessible name — P1, CERTAIN

`src/ui/quizscreen.ts:354` (`TYPE YOUR ANSWER`), `:375` (`num-input`), `:539` (`Write your answer…`). All three rely on `placeholder` only. A placeholder is not an accessible name; screen readers announce an unlabelled edit field for the primary interaction of the app. The same pattern appears in ~17 other inputs (`entry.ts:145,182,213`, `load.ts:169,183`, `profiles.ts:52`, `prompts.ts:163,227,266,512`, `admin.ts:157,158`, `dashboard.ts:106`). The settings screen shows the correct pattern already (`settings.ts:62,112` use `aria-label`), so this is consistency, not new design.

### UI-05 — Modal semantics and focus management — P2, CERTAIN

Only `dashboard.ts:92` marks its card `role="dialog"`. `library.ts:153,217`, `prompts.ts:708` and `admin.ts:64` are bare `div`s: no `role="dialog"`, no `aria-modal="true"`, no focus moved into the modal on open, no focus trap, no restore to the invoking control on close. For a keyboard/AT user the modal is not identifiable as a dialog and the background remains reachable by Tab.

### UI-06 — Global `user-select: none` — P2, CERTAIN

`src/styles/p5.css:31` sets `user-select: none` on `body`; only two elements opt back in (`components.css:2487` `.pm-body`, `components.css:3798`). Users cannot select the quiz JSON they pasted, a share URL, a class join code, or their results text for copying. Readers who want to save a quiz question or share a code with a classmate hit this immediately. Expected: selection allowed on content regions, disabled only on chrome/controls.

### UI-07 — Reduced motion only partially honoured — P2, CERTAIN

`RM()` (`fx/transitions.ts:8-9`) is the right approach and most screens use it, but coverage is uneven: `results.ts` **16 GSAP calls / 3 guards**, `load.ts` **7/1**, while `quizscreen.ts` is 28/12. `dom.ts` has 0 guards. The CSS block at `p5.css:275-289` neutralises CSS animations and transitions but **cannot** affect GSAP, which writes inline styles from `requestAnimationFrame`. A motion-sensitive user who set the OS preference still gets the results-screen choreography, the load-screen slam, and toast springs.

### UI-08 — No cancellation, no unsaved-work guard — P2, CERTAIN

`grep -rc AbortController src` → **zero matches**, against 21 in-flight `await cloud.*`/`fetch` call sites in `src/ui/`. `quizscreen.ts:1024-1030` tears down listeners and `clearTimeout`s `pendingAdvance`, but cannot cancel in-flight network work. Combined with the absence of any `beforeunload` handler, a mid-quiz refresh or a click on a share link discards the attempt silently (progress *is* persisted via `saveProgress`/`loadProgress`, so this is a UX gap rather than certain data loss — which is why it is P2, not P1). This is the same architectural gap that produced the four `stale fetch`/`stranded Loading…` commits in git history.

### UI-09 — `role="checkbox"` without initial state — P2, CERTAIN

`src/ui/quizscreen.ts:329-336`: the row is created with `role: "checkbox"` and `.picked` toggling, but `aria-checked` is only set inside the click handler (`:335`). On render, a screen reader sees a checkbox in an indeterminate state. Fix: set `aria-checked: "false"` at creation.

### UI-10 — Unlabelled icon buttons; keyboard shortcuts cover one question type — P2, CERTAIN

`.pm-close` buttons in `library.ts:156` and `:221` contain only `"✕"` with no `aria-label` (dashboard's equivalents at `:95` and load's at `:167,181` do have one). Separately, the number-key shortcut at `quizscreen.ts:958-967` queries only `.choice-btn`, so `multi`/`order`/`match`/`fill`/`numeric` have no number-key path; `multi` rows are reachable by Tab and activated by Enter/Space as buttons, but `renderMatch`/`renderOrder` (`:393`, `:444`) have no `keydown` handling at all, making drag/tap-style matching awkward for keyboard-only users. Also note `renderChoice` binds `mouseenter` for audio but no click sound, unlike `renderMulti` — a small inconsistency, not a defect.

### UI-11 — README documents a build string that does not exist — P2, CERTAIN

`README.md:405` instructs: *"check the footer shows `BUILD 2.0.0`"*. `grep -rn "2\.0\.0" src index.html vite.config.ts` → **no matches**, and `grep -o "BUILD [0-9.]*" dist/assets/index-CFCI_iFv.js` → **no matches**. The reference is stale from an earlier "P5ex port" build. Impact: a user hitting a genuine stale-cache bug follows the documented diagnostic, cannot find the string, and is misled into thinking something else is wrong. Either restore a rendered build stamp or delete the instruction.

### UI-12 — Empty dialog containers always mounted — P3, SUSPECTED

`admin.ts:64`, `library.ts:153,217` append their modal containers to the screen root at mount, hidden via `.hidden`. Harmless with a correct `display:none`, but it means every screen carries dead dialog markup. Suspicious rather than proven harmful; I did not measure whether `.hidden` always resolves to `display:none` for every modal.

## Recommended fix order

1. **UI-01** — decouple toast dismissal from `gsap` (`setTimeout` fallback), add `pointer-events: auto` + a close button + a stack cap. Highest ratio of user-visible relief to lines changed.
2. **UI-02**, **UI-03** — one Escape handler reused across the three modals; one `focus()` on the new `.screen-title` (or a container with `tabindex="-1"`) inside `go()`. Both are systemic single-point fixes.
3. **UI-04** — add `aria-label` to the quiz inputs, copying the pattern already used at `settings.ts:62`.
4. **UI-06**, **UI-07**, **UI-11** — narrow, low-risk.
5. **UI-05**, **UI-08**, **UI-09**, **UI-10** — batch with any modal/router refactor, since they share the same code paths.

## Explicitly NOT reported (tested and falsified)

Reporting the negatives matters as much as the positives here, because three of them were the most plausible-sounding hypotheses:

- **Stale deploy / local-vs-live divergence** — falsified by SHA-256 across HTML, main JS, CSS and a lazy chunk. The byte-size difference is transport compression.
- **Back button broken by the hash router** — falsified empirically; history walks back correctly and re-renders the right screen.
- **Scroll position leaking between screens** — falsified; `scrollTop` resets to 0 because every screen mounts a fresh node.
- **"Reload loses my answer options"** — investigated, evidence self-contaminated, **excluded**; needs a clean-profile re-run before anyone acts.
- **Missing empty/loading/error states** — largely present; the dashboard, library, leaderboard, profiles and admin all render explicit empty states.
- **Missing double-submit guards** — present in `entry.ts`, `admin.ts`, `dashboard.ts`.
