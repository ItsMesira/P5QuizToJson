# Client-side bug ledger — async / lifecycle races

**Scope:** framework-less TypeScript DOM UI under `src/`, plus the router (`src/ui/screens.ts`),
the quiz engine (`src/engine/quiz.ts`), the fetch client (`src/core/api.ts`), local storage
(`src/core/store.ts`) and the canvas/cursor FX layer (`src/fx/`).

**Method:** read the real source end to end and traced every async continuation, every
`setTimeout`/`setInterval`, and every `window`/`document` listener to its teardown path in the
router's `cleanup()`. Nothing here is inferred from naming; each entry names a concrete trigger
and the code path that produces the wrong behaviour.

**The structural fact that generates most of these:** the router gives a screen exactly one
teardown hook and then clears the stage.

```ts
// src/ui/screens.ts:123-161
export async function go(route: Route, opts: { instant?: boolean } = {}) {
  current = route;
  location.hash = route.name;
  ...
  cleanup?.();          // ← the only cancellation a screen ever gets
  cleanup = null;
  clear(stage);         // ← the old screen's DOM is detached here
  ...
}
```

`clear(stage)` detaches the old tree, so most post-unmount DOM writes become *silent* rather than
throwing — which is why these bugs survive testing and surface as "wrong screen / stuck spinner /
sound after I left". There is **no global navigation token** and **no `AbortController` anywhere in
`src/`** (verified: `grep -rn "AbortController\|signal" src` → 0 hits), so a screen cannot invalidate
its own in-flight work even when it knows it has unmounted.

---

## Summary

| ID | Where | Sev | Conf |
|---|---|---|---|
| RACE-01 | `src/ui/quizscreen.ts:766-769`, `1024-1030` | P0 | CERTAIN |
| RACE-02 | `src/ui/admin.ts:419-432` | P0 | CERTAIN |
| RACE-03 | `src/ui/results.ts:32-41` | P0 | CERTAIN |
| RACE-04 | `src/core/api.ts:35-64`, `src/ui/admin.ts:17-38` | P0 | CERTAIN |
| RACE-05 | `src/ui/screens.ts:123-161` | P1 | SUSPECTED |
| RACE-06 | `src/ui/dashboard.ts:23-27`, `407-420` | P1 | CERTAIN |
| RACE-07 | `src/ui/results.ts:345-382`, `388-391` | P1 | CERTAIN |
| RACE-08 | `src/main.ts:110-113` + `src/ui/dashboard.ts:23-27` | P1 | CERTAIN |
| RACE-09 | `src/ui/entry.ts:209`, `290-316` | P1 | CERTAIN |
| RACE-10 | `src/core/store.ts:121-136` | P1 | CERTAIN |
| RACE-11 | `src/core/api.ts:57-62` | P1 | CERTAIN |
| RACE-12 | `src/ui/leaderboard.ts:51-76` | P1 | CERTAIN |
| RACE-13 | `src/ui/prompts.ts:94-105`, `381-394` | P1 | CERTAIN |
| RACE-14 | `src/core/store.ts:37-43` | P1 | CERTAIN |
| RACE-15 | `src/ui/library.ts:120-132`, `src/ui/dashboard.ts:219-229` | P2 | CERTAIN |
| RACE-16 | `src/ui/title.ts:163-195` | P2 | CERTAIN |
| RACE-17 | `src/core/audio.ts:230-275` | P2 | CERTAIN |
| RACE-18 | `src/fx/particles.ts:136-154` | P2 | CERTAIN |
| RACE-19 | `src/fx/cursor.ts:33-34`, `61-62` | P2 | CERTAIN |
| RACE-20 | `src/ui/quizscreen.ts:371`, `389`, `554` | P2 | SUSPECTED |
| RACE-21 | `src/ui/screens.ts:110-116`, `137-140` | P2 | CERTAIN |

**Totals: 21 findings — 19 CERTAIN, 2 SUSPECTED (RACE-05, RACE-20).
Severity: 4 × P0, 10 × P1, 7 × P2.**

---

## P0 — breaks a flow

### RACE-01 — Quitting the quiz during the finale is overridden; the results screen mounts anyway
**File:** `src/ui/quizscreen.ts:759-770` (continuation), `:888-903` (quit handlers), `:1024-1030` (cleanup)

```ts
const finishQuiz = async () => {
  clearProgress();
  const result = runner.finish();
  audio.setIntensity(0);
  const scope = root;
  const p = randomPortrait();
  await cutIn(scope, {...});      // ← 766: ~1.4s of uncancellable GSAP timeline
  void import("../ui/results");
  app.lastResult = result;
  void go({ name: "results" });   // ← 769: unconditional
};
```

**Trigger:** the last question is answered (or survival mode hits 0 hearts, which arms a second
uncleared `setTimeout(() => void finishQuiz(), 1600)` at `:697`). While the cut-in plays, the user
presses **Escape → ABANDON HEIST** (`:888-893`) or **✕ LOG OUT** (`:896-902`), both of which call
`runner.destroy()` and `go({ name: "title" })` / `go({ name: "entry" })`.

**Wrong behaviour:** `go()` runs `cleanup()` and `clear(stage)`, but the pending `await cutIn(...)` is
not a cancellable resource — nothing in the cleanup path can reach it. When the timeline finishes,
`finishQuiz` resumes and executes line 769 unconditionally.

**Symptom:** the user abandons the heist and lands on the results screen anyway; then the back
button appears to "do nothing" the first time, because the queued `go({name:"results"})` wins the
race. Progress was also already cleared at `:760`, so the abandoned attempt cannot be resumed.

**Severity:** P0 · **CERTAIN** (the continuation has no mount/stale guard, and neither quit handler
cancels it — `cleanup()` only touches `runner`, listeners, and `pendingAdvance`).

---

### RACE-02 — Admin panel keeps fetching and rebuilding after you leave the screen
**File:** `src/ui/admin.ts:419-432`

```ts
const boot = async () => {          // 419
  const me = await adminReq("me");  // ← no cancellation
  if (me.ok) { await renderImpersonationBanner(); await renderPanel(); }
  else { renderLogin(); }
};
void boot();                        // 429: fire-and-forget
return () => { /* nothing to clean up */ };   // 430-432
```

**Trigger:** open the admin URL, then navigate away (⌂ HOME, or a `hashchange`) before `/api/admin`
`me` resolves.

**Wrong behaviour:** every subsequent stage runs. `renderLogin()` → `notify()` prepends the notice to
`body()`, which is now a detached subtree — so the login error is **never visible**. If `me` succeeds,
`renderPanel()` and `renderTab()` keep issuing real authenticated admin requests (`users.list`,
`stats`, …) after the screen is gone. The stale-render guard at `:273` only orders renders relative to
each other; it has no notion of "this screen is unmounted", and `body()` (`:47`) still resolves inside
the detached tree.

**Symptom:** a slow admin boot can fire a burst of pointless authed requests after you have left the
panel, and genuine errors are swallowed instead of shown.

**Severity:** P0 · **CERTAIN** (the comment at `:431` asserts listeners are node-scoped, which is true
for listeners but does not cover the async continuation).

---

### RACE-03 — `results` persists everything, then installs an unhandled rejection at the top of the mount
**File:** `src/ui/results.ts:32-41`

```ts
void import("../core/api").then(({ cloud }) => {
  const quizId = app.currentQuiz?.quizId;
  if (cloud.session?.cls && quizId) {
    void cloud.submitResult(cloud.session.cls.id, {...});   // ← floating promise
  }
});
```

**Trigger:** finish a quiz that was started from the class shelf (`app.currentQuiz.quizId` is set),
then navigate away — or simply be on a flaky connection.

**Wrong behaviour:** `submitResult` is a bare `void`. `req()` (`src/core/api.ts:35`) converts network
errors into `{ok:false,status:0}`, but the caller never inspects it and there is no `catch` on the
floating promise or the outer `.then`.

**Symptom:** the score silently never reaches the class leaderboard. The player sees "ALL-OUT ATTACK"
and their rank, the teacher sees nothing, and no toast or retry is offered. If the import or the
promise rejects for any other reason, it surfaces as an unhandled rejection in the console only.

**Severity:** P0 · **CERTAIN**.

---

### RACE-04 — No fetch timeout anywhere: a hung request strands a Loading state forever
**File:** `src/core/api.ts:35-64` (app client), `src/ui/admin.ts:17-38` (admin client)

```ts
res = await fetch(`/api${path}`, { method, credentials, headers, body });  // api.ts:42 — no signal, no timeout
```

**Trigger:** the API accepts the connection but never responds — cold-starting Vercel function, a
paused Supabase pooler, a captive-portal network, or a request that is simply slow.

**Wrong behaviour:** `fetch` has no default timeout. `req()` awaits forever, `cloudReady()`'s
`readyPromise` (`:75-80`) never settles, and every screen that renders a placeholder and awaits a
cloud call keeps that placeholder on screen permanently. There is no `AbortController` and no
`setTimeout` race scoped to the request anywhere in `src/`.

**Symptom:** the classroom screens sit on literal `Loading…` nodes (`src/ui/dashboard.ts:62`, `73`,
`79`) with no error, no retry, and no way out except a manual reload. `main.ts:110-113` guards *boot*
with a 2.5s `Promise.race`, which proves the hazard was recognised — but nothing guards the screens'
own requests.

**Severity:** P0 · **CERTAIN** (mechanism verified in code; the user-visible "stuck Loading…" depends
on the server hanging, which is exactly the failure mode the boot race already anticipates).

---

## P1 — wrong, stuck, or lying UI
### RACE-05 — Double `go()` during a transition can commit the stale route and lose the hash
**File:** `src/ui/screens.ts:123-161`

```ts
location.hash = route.name;             // 125
await ensureScreen(route.name);         // 127
if (!opts.instant) await slashWipe(veil, "in");   // 128
cleanup?.(); clear(stage);              // 130-135
const mount = mounts[route.name];       // 137 — read AFTER the awaits
```

**Trigger:** any two navigations within ~0.5s of each other — e.g. a `hashchange` (back button) while
a menu click's wipe is still running, or `library.ts:195` re-entering the same screen.

**Wrong behaviour:** nothing serialises concurrent `go()` calls. Call A and call B both pass line 125
and then both await. A's `finally` at `:158-160` issues a `slashWipe(veil,"out")` while B's `:128`
wipe is still in flight, so two timelines write `veil.style.opacity` and the same stripe elements
concurrently; both `finally` blocks then resolve on their own timelines. Because `current` is set
before any await, the later `hashToRoute` comparison at `:240-243` sees `r.name === current.name` and
will not re-issue the navigation — so if the loser's mount ran last, the URL and the rendered screen
disagree permanently until the user navigates again.

**Symptom:** the veil can be left mid-sweep, and the wrong screen (or a visibly double-animated
screen) is shown for the hash in the address bar.

**Severity:** P1 · **SUSPECTED** (the interleaving is unambiguous in code; the exact visible outcome
depends on GSAP timeline ordering, which I did not run the browser to pin down).

---


### RACE-06 — Dashboard writes into three detached containers and animates them
**File:** `src/ui/dashboard.ts:407-488` (writer), `:66-80` (targets), `:498-500` (cleanup)

**Trigger:** open the class dashboard, then tap **⌂ TITLE** / **▶ PLAY SOLO** before
`classInfo`/`listQuizzes`/`classResults` resolve.

**Wrong behaviour:** `loadData()` reads `membersBox`, `boardBox` and `listBox` up front (`:408-409`,
`:141`) and never re-checks them. `Promise.allSettled` never rejects, so the continuation always
runs — writing rows into detached nodes and firing `gsap.fromTo` for every member, quiz and score
row (`:434`, `:451`, `:473`). The `loading` flag (`:404`, `:410`) only prevents *double* loads; it is
not a stale-mount guard.

**Symptom:** after leaving the dashboard the browser keeps building and animating rows nobody can
see; with a 100-member class that is hundreds of detached nodes plus GSAP tweens during whatever
screen the user moved to.

**Severity:** P1 · **CERTAIN**.

---

### RACE-07 — Results screen keeps talking, flashing and raining stars after you leave
**File:** `src/ui/results.ts:345-382` (timeline), `:53-59` (goal toast), `:388-391` (cleanup)

```ts
if (!RM()) {
  const tl = gsap.timeline();                       // 348 — never stored, never killed
  ...
  .call(() => { void cutIn(el, {...p2}); }, [], 4.4)   // 363-365
  tl.to(".xp-fill", { width: "100%", ... }, 4.9);      // 382
}
return () => { audio.setIntensity(0); fx.setAmbientGold(false); };   // 388-391
```

**Trigger:** reach the results screen and immediately press **⌂ HOME**, **🏆 LEADERBOARD**, **↻ RETRY**
or **🎯 REINFORCE** — all available from ~4.6s, while the timeline is still scheduled out to 5.0s+.
Separately, correct answers that beat a goal arm an uncleared
`window.setTimeout(..., 5400)` that plays `audio.sfx("rankup")` **and** `fx.starRain(2)`.

**Wrong behaviour:** the cleanup restores `fx` and audio intensity but does not kill `tl` and does not
clear the 5.4s timer. GSAP keeps ticking detached nodes; `cutIn` appends a fresh `.cutin` element to
the old `el`; `fx` is a boot-time singleton (`src/main.ts:100`), so `starRain` draws onto the global
canvas and `rankup` plays through the global audio graph — both of which outlive the screen.

**Symptom:** the goal-reached jingle and gold star rain fire while the user is on the title screen or
in the library, with no screen open that explains them.

**Severity:** P1 · **CERTAIN**.

---

### RACE-08 — Dashboard redirects a restored session to the login screen
**File:** `src/main.ts:110-113` (the boot race), `src/ui/dashboard.ts:23-27`

```ts
// main.ts
const sessionReady = Promise.race([
  import("./core/api").then(({ cloudReady }) => cloudReady()),
  new Promise((r) => setTimeout(r, 2500)),      // ← boot stops waiting after 2.5s
]);
// dashboard.ts:23-27
const session = cloud.session;
if (!session) { void go({ name: "entry" }, { instant: true }); return () => undefined; }
```

**Trigger:** open `#dashboard` directly (bookmark, refresh, or a post-login redirect) on a slow
connection, where `/auth/me` takes longer than 2.5s. `main.ts:198` awaits `sessionReady` before
routing to `dashboard`/`entry`, so the 2.5s cap is what actually decides.

**Wrong behaviour:** `cloudReady()` has resolved (as a timeout), `cloud.session` is still `null`, and
the dashboard mount treats that as "not signed in". Note `load.ts:28` handles the same hazard
*correctly* via `cloud.saveQuizToClass()`, which awaits `cloudReady()` internally — the dashboard's
synchronous `cloud.session` read is the outlier.

**Symptom:** a signed-in user is bounced to "JOIN A CLASS / SIGN IN"; the session then arrives moments
later, so pressing back shows them as signed in — the app appears to log them out at random.

**Severity:** P1 · **CERTAIN**.

---

### RACE-09 — Entry screen's async form continuation renders into a detached stage and runs a delayed render
**File:** `src/ui/entry.ts:290-317` (continuation), `:168-171` (`render()` clears the stage), `:328-339` (listener)

```ts
const attempt = (isRegister: boolean) =>
  lockWhile([signIn, register, backBtn], async () => {
    ...
    const r = isRegister ? await cloud.register(...) : await cloud.login(...);   // 299-301
    if (r.ok) { ... void go({ name: "dashboard" }); return; }
    showError(err, apiErrorText(r));                                             // 312 — writes `err`
    if (r.status === 404) { mode = "join"; window.setTimeout(() => render(), 900); }   // 315
  });
```

**Trigger:** submit a sign-in, then press **Escape** while the request is in flight. `onKey`
(`:328-334`) calls `back()` → `mode = "root"` → `render()` → `stage.textContent = ""` (`:169`), which
destroys the form — but does not cancel the pending `cloud.login`.

**Wrong behaviour:** `lockWhile`'s `finally` (`:156-159`) sets `busy = false` and re-enables buttons
on nodes that are already detached, freezing only the render at that instant. The continuation then
runs `audio.sfx("wrong")` + `fx.shake(6)` + `render()` after the user is already on the root menu.

**Symptom:** a belated error line is painted into a detached subtree (so the user sees an unexplained
screen shake and error buzz with no message), and if the failure was a 404 the uncleared
`setTimeout(render, 900)` re-renders the entry stage ~0.9s after the user moved on — which can wipe a
form they had already started filling in.

**Severity:** P1 · **CERTAIN**.

---

### RACE-10 — `localStorage` profile access throws inside a hot path and takes the results screen down
**File:** `src/core/store.ts:121-136`

```ts
export function currentProfile(): Profile | null {
  const id = localStorage.getItem(K.profile);   // 122 — no try/catch
  ...
}
export function createProfile(name: string): Profile { ... localStorage.setItem(K.profile, p.id); }   // 131
export function switchProfile(id: string) { localStorage.setItem(K.profile, id); }                     // 135
```

**Trigger:** storage blocked or over quota — Safari private browsing (where even `getItem` throws),
"block all cookies", or a full disk. Contrast with every other accessor in this module, which goes
through `read`/`write` and swallows failures (`:29-43`).

**Wrong behaviour:** `results.ts:27` calls `addProfileXp(gained)` at the top level of the mount;
`addProfileXp` calls `currentProfile()` (`:138`). A throw here is caught by the router's mount
`try/catch` (`src/ui/screens.ts:142-157`) — which means **the whole results screen is replaced by the
title screen plus "Something broke on that screen"**.

**Symptom:** on a storage-restricted browser, finishing a quiz and pressing ↻ RETRY (which re-arms the
same path) permanently bounces the user to the menu with a generic error; the quiz result never
renders.

**Severity:** P1 · **CERTAIN** (the asymmetry between `read`/`write` and these four call sites is
explicit in the file).

---

### RACE-11 — CSRF retry re-sends non-idempotent POSTs
**File:** `src/core/api.ts:57-62` (client), mirrored by `src/ui/quizscreen.ts:22`/`results.ts:32` flows

```ts
if (!res.ok && !retried && (opts.method ?? "GET") !== "GET" && /csrf/i.test(String(data.error ?? ""))) {
  await req("/auth/me", {}, true);
  return req(path, opts, true);      // ← the original POST body is sent a second time
}
```

**Trigger:** the first POST is actually applied server-side but the response is lost or misread — a
gateway error page that still matches `/csrf/i`, a proxy 502 with a CSRF-ish body, or the request
being retried after a network hiccup.

**Wrong behaviour:** the retry condition is a *response-body regex*, not a guarantee that the write
did not execute. Every write endpoint here is additive: `saveQuiz` (POST `/classes/:id/quizzes`),
`submitResult` (POST `/classes/:id/results`), `register`.

**Symptom:** the same quiz appears twice on the class shelf, or a player's score is posted twice, with
no way for the client to detect it.

**Severity:** P1 · **CERTAIN** (the retry mechanism is real and the endpoints are additive; whether a
duplicate is rejected server-side is outside this client audit).

---

### RACE-12 — Class leaderboard has no stale guard and its error branch writes a server string
**File:** `src/ui/leaderboard.ts:51-76`

```ts
void cloud.classResults(classSession.id).then((r) => {
  if (!r.ok || !r.data.results) {
    box.textContent = "";
    box.appendChild(h("p", { class: "profile-empty" }, [r.data.error ?? "Couldn't load class scores"]));  // 56
```

**Trigger:** open the leaderboard while `cloud.session.cls` is set, then leave before the request
resolves — or hit it twice from two screens.

**Wrong behaviour:** `box` is captured at `:52` with no unmount check, so the whole list is rebuilt
into a detached node. The error branch also pushes an arbitrary server-provided string and a
hard-coded English fallback through the DOM builder, so this one path escapes the i18n layer that
every neighbouring line uses (`t(...)`).

**Symptom:** leaked work after navigation, plus an untranslated/attacker-influenced line for non-English
users on the one screen teachers read most.

**Severity:** P1 · **CERTAIN** (the missing guard and the un-i18n'd error string are both explicit).

---

### RACE-13 — Prompts builder leaks an interval and writes to buttons that no longer exist
**File:** `src/ui/prompts.ts:381-394` (dice), `:94-105` (copy), `:784-786` (cleanup)

```ts
const id = window.setInterval(() => {          // 381
  ...
  topicInput.value = fields.topic;
  if (++n > 10) { clearInterval(id); ... renderBuilder(); }   // 387-393
}, 70);
...
window.setTimeout(() => (btn.textContent = orig), 1400);      // 103
```

**Trigger:** press **🎲 SURPRISE ME**, then navigate away within ~700ms; or press any **⧉ COPY** button
(the prompt itself is large, so this is the normal "copy then leave" flow).

**Wrong behaviour:** the dice interval is a local variable with no teardown hook — `cleanup()`
(`:784-786`) only removes the keydown listener. Its final iteration calls `renderBuilder()`, which
rebuilds the entire form into the detached `builderBox`. The copy button's 1400ms timer likewise
writes `textContent` into a detached button.

**Symptom:** the form is rebuilt and the topic input mutated ~0.7s after the user left the screen;
visible as a stutter/jank while the next screen animates in, and as a "lost" spinner-free rebuild
during fast navigation.

**Severity:** P1 · **CERTAIN**.

---

### RACE-14 — Every `localStorage` write is fire-and-forget
**File:** `src/core/store.ts:37-43`

```ts
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — ignore */ }
}
```

**Trigger:** quota exhaustion. The quiz library keeps up to 60 saved quizzes **including inline image
and audio URLs** (`savedQuizzes`, `:65`), plus 100 scores, 40 prompt-history entries (each holding a
full prompt), 30 custom presets, and topic stats.

**Wrong behaviour:** the failure is swallowed with no signal to any caller. `saveQuiz` (`:49-67`)
returns the new `SavedQuiz` as if it persisted, `results.ts:24-28` reports "＋XP / TOTAL" from a value
that only exists in memory, and `library.ts` will render the card in the current session.

**Symptom:** the user saves a quiz, sees a success toast, and it is gone after a refresh; XP and
high scores silently stop accruing with no error ever shown. `currentProfile`/`switchProfile`
(RACE-10) are the same hazard, only louder.

**Severity:** P1 · **CERTAIN**.

---

### RACE-15 — Deleting a quiz/result is animated before it is committed, with no interruption handling
**File:** `src/ui/library.ts:120-132`, `src/ui/dashboard.ts:219-229`

**Trigger:** tap **✕** on a library card and navigate away within the 400ms tween.

**Wrong behaviour:** `deleteQuiz` + `card.remove()` live in the tween's `onComplete` (`library.ts:126`).
A detached node still animates, so with the GSAP ticker running the delete *does* commit — but the
optimistic path in `dashboard.ts:224` (`shelf = shelf.filter(...); renderShelf()`) is written to a
detached `listBox`, so the two screens disagree about what is on the shelf until the next load.

**Symptom:** after a fast delete-then-leave, the class shelf briefly re-shows the deleted row when
reopened, and the local library is missing a quiz the user believes they still have.

**Severity:** P2 · **CERTAIN**.

---

## P2 — polish and leaked work

### RACE-16 — Title screen re-activates the menu 1.4s after you have left
**File:** `src/ui/title.ts:195` (the timer), `:163-203` (the one handle that *is* cleared)

```ts
window.setTimeout(() => activate(0, true), 1400);   // 195 — handle not stored
...
return () => { window.removeEventListener("keydown", onKey); clearInterval(clockId); };  // 200-203
```

**Trigger:** click a menu row within 1.4s of the title screen appearing (the common case — the rows
are clickable immediately).

**Wrong behaviour:** the clock interval is correctly cleared, which shows the author knew the rule,
but the activation timer is not. `activate(0, true)` runs against the detached menu, mutating
`classList`/`style.opacity` and calling `audio.sfx("hover")`.

**Symptom:** a stray hover blip ~1.4s after the user has already left the menu.

**Severity:** P2 · **CERTAIN**.

---

### RACE-17 — SFX scheduled on bare `setTimeout`s keep playing after a screen teardown
**File:** `src/core/audio.ts:230-275`

Nine timers, e.g. `case "correct"` (`:232`: four notes at `i*55`), `rankup` (`:251-255`: a nested 90ms
timer that fans out five more at `i*70`), `heartbeat` (`:261`), `unlock` (`:273`). None are stored or
cleared; `audio` is a boot-time singleton (`:392`) with no `stopAll`.

**Trigger:** answer the final question (fires `correct` or `rankup`) and immediately abandon, or leave
the results screen as it plays `rankup` (`results.ts:338`).

**Wrong behaviour:** the arpeggio is scheduled on the global audio graph and keeps firing into the
next screen; `tone()` calls `ensure()` (`:153`), which resumes the `AudioContext` if the browser
suspended it.

**Symptom:** a congratulation jingle plays on the title screen, disconnected from anything visible.

**Severity:** P2 · **CERTAIN**.

---

### RACE-18 — `starRain` spawns up to ~70 uncleared timers per call
**File:** `src/fx/particles.ts:136-154`

```ts
starRain(duration = 2.4, gold = true) {
  const count = Math.floor(duration * 22);
  for (let i = 0; i < count; i++) { setTimeout(() => { this.add({...}); }, i * (duration * 1000) / count); }
}
```

**Trigger:** any screen that calls it — `quizscreen.ts:689` (rank up), `results.ts:57` and `:342`,
`prompts`/`dashboard` celebrations.

**Wrong behaviour:** no handles are kept, and `fx.destroy()` (`:69-75`) exists but is **never called by
any screen** — the canvas is a boot-time singleton (`:495`). A rank-up storm plus a results-screen
celebration leaves a few hundred pending timers, every one of which pushes a particle into the
shared array; `perf.onFrame` (`:66`) is likewise subscribed once, for the tab's lifetime.

**Symptom:** CPU and GC work continues after the celebration's screen is gone; on desktop this
compounds with `perf.ambientDust` (enabled at `perf.ts:59`), which by design keeps the canvas loop
awake forever.

**Severity:** P2 · **CERTAIN**.

---

### RACE-19 — Cursor sprite interval and document listeners are registered once, forever
**File:** `src/fx/cursor.ts:33-34`, `:59-67`

```ts
const frameTimer = window.setInterval(advance, 55);       // 33 — 18fps, forever
window.addEventListener("pagehide", () => window.clearInterval(frameTimer));   // 34 — only on unload
document.addEventListener("mouseover", overLink, { passive: true });            // 61
document.addEventListener("mouseout", outLink, { passive: true });              // 62
```

**Trigger:** always, on a fine-pointer device.

**Wrong behaviour:** `advance` (`:28-32`) early-returns when the tab is hidden, so the cost is bounded,
and the `started` latch (`:11`) prevents double init. But the interval and the two document-level
listeners are app-lifetime by construction; nothing short of a page unload releases them.

**Symptom:** a permanent 18fps timer and two document listeners consulting a large `LINK_SELECTOR`
(`:8`, ~25 selectors) on every hover boundary, for the whole session.

**Severity:** P2 · **CERTAIN** (by design, but it is the same "no teardown" class as the rest of this
ledger and belongs in the ledger).

---

### RACE-20 — Deferred `focus()` calls fire after their question is gone
**File:** `src/ui/quizscreen.ts:371`, `:389`, `:554`

```ts
window.setTimeout(() => input.focus(), 350);   // fill, numeric, open — one per rendered question
```

**Trigger:** answer a fill/numeric/open question and advance (or leave) within 350ms — fast keyboard
play (`:937-957`: `Enter` submits, then `NEXT`/auto-advance), or pause-then-quit.

**Wrong behaviour:** the handle is not stored and `cleanup()` (`:1024-1030`) does not clear it. The
timer focuses a detached input — a no-op for focus, but it also fires `scrollIntoView`-adjacent layout
work in some engines.

**Symptom:** on a fast run, focus can land on a stale input rather than the freshly rendered one, so
the first typed character goes nowhere. I could not construct a case where this is more than a
one-keystroke annoyance, hence SUSPECTED.

**Severity:** P2 · **SUSPECTED**.

---

### RACE-21 — A failed chunk load falls through to a blank screen instead of the stale-build recovery
**File:** `src/ui/screens.ts:110-116`, `:137-140`

```ts
async function ensureScreen(name) {
  ...
  } catch (err) { recoverFromStaleBuild(err); }   // 113-115 — never rethrows, returns undefined
}
...
await ensureScreen(route.name);                   // 127 — failure is invisible to go()
const mount = mounts[route.name];                 // 137 — still undefined
if (mount) { cleanup = mount(stage); }            // 138 — skipped
```

**Trigger:** a route chunk 404s **and** `recoverFromStaleBuild` takes its fallback branch — i.e. the
`sessionStorage` reload guard is already set (`:88-92`), for example the first automatic reload also
failed, or storage is unavailable and the `catch` at `:93-95` falls through to the toast (which is
renderable exactly once).

**Wrong behaviour:** `ensureScreen` swallows the error and returns; `go()` proceeds to clear the stage
and then finds no mount function. The `try/catch` at `:136-157` does not fire because nothing threw,
so the title fallback never runs.

**Symptom:** a blank `#app` with only the persistent chrome — the same black-screen class of bug that
commit `58bd8c4` set out to fix, reachable through the second-failure path.

**Severity:** P2 · **CERTAIN**.

---

## What this list implies (for whoever fixes it)

Four mechanisms account for 19 of the 21 findings. Fixing them once removes the class, rather than the
symptom:

1. **No cancellation primitive.** Zero `AbortController` in `src/`. A per-screen
   `AbortController`/`AbortSignal` that `cleanup()` aborts, plus a "is this screen still mounted?"
   predicate every async continuation checks before writing, would cover RACE-01, 02, 06, 07, 09, 12,
   13, 16.
2. **Timers and handles created without ownership.** 29 bare `setTimeout`/`setInterval`, and only
   three call sites ever clear one (`title.ts:202`, `quizscreen.ts:1029`, `quiz.ts:191-196`). A
   screen-scoped timer bag (register on create, drain on cleanup) covers RACE-01/07/09/13/16/17/18/20.
3. **No request deadlines.** Every fetch is unbounded (RACE-04) and the only timeout in the codebase
   deliberately *gives up waiting* rather than cancelling (`main.ts:112`), which is what produces
   RACE-08.
4. **Fire-and-forget writes.** Both the retry path (RACE-11/14) and the floating
   `void cloud.submitResult(...)` (RACE-03) assume success. Because `write()` and `req()` both
   swallow their failures by design, nothing upstream can ever learn that state was lost (RACE-14,
   RACE-15).

Also worth noting for prioritisation: RACE-01/02/06/07/09/12/13 all share one shape — *an awaited
cloud call followed by DOM writes and animations with no re-check of the mount*. That shape appears
in **eight** of the twelve screens, which is why the fix commits in this repo's history keep landing
on the same handful of symptoms.
