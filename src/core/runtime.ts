/* ============ P5 QUIZ — ROUTE-SCOPED CANCELLATION ============
   The router used to give a screen exactly one teardown hook, and `clear(stage)`
   merely DETACHES the old tree — so an async continuation that resolved after a
   screen was replaced wrote into a detached node and failed silently. That is
   how the stale-fetch / stranded-Loading / resurrected-row bugs survived a green
   test suite.

   A scope owns every AbortController created while a screen is mounted. The
   router aborts the scope on every navigation, so every in-flight request that
   was started for that screen is cancelled at once, and `alive()` lets an
   awaited continuation bail out before it touches the DOM. */

export interface Scope {
  readonly signal: AbortSignal;
  /** False once the scope has been cancelled (i.e. the screen is gone). */
  alive(): boolean;
  /** Register an extra teardown (timers, listeners, animation frames). */
  onCancel(fn: () => void): void;
}

function makeScope(): { scope: Scope; cancel: () => void } {
  const ctrl = new AbortController();
  const teardowns = new Set<() => void>();
  const scope: Scope = {
    signal: ctrl.signal,
    alive: () => !ctrl.signal.aborted,
    onCancel(fn) {
      if (ctrl.signal.aborted) {
        try {
          fn();
        } catch {
          /* a teardown must never break the navigation */
        }
        return;
      }
      teardowns.add(fn);
    },
  };
  const cancel = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    for (const fn of teardowns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    teardowns.clear();
  };
  return { scope, cancel };
}

/* The scope of the screen that is currently mounted. */
let current = makeScope();

/** The live screen's scope. Pass `scope.signal` to `req()` so a navigation
 *  cancels in-flight work automatically. */
export function routeScope(): Scope {
  return current.scope;
}

/** Cancel the current screen's work and start a fresh scope. Called by the
 *  router on every navigation, before the next screen mounts. */
export function resetRouteScope(): void {
  current.cancel();
  current = makeScope();
}

/* ---- owned timers -------------------------------------------------------
   Timers that outlive their screen are the other half of the same bug class
   (29 bare setTimeout/setInterval sites, only 3 ever cleared). These helpers
   bind a timer to a scope so cleanup is automatic and cannot be forgotten. */

export function scopedTimeout(fn: () => void, ms: number, scope: Scope = routeScope()): number {
  const id = window.setTimeout(() => {
    if (!scope.alive()) return;
    fn();
  }, ms);
  scope.onCancel(() => window.clearTimeout(id));
  return id;
}

export function scopedInterval(fn: () => void, ms: number, scope: Scope = routeScope()): number {
  const id = window.setInterval(() => {
    if (!scope.alive()) {
      window.clearInterval(id);
      return;
    }
    fn();
  }, ms);
  scope.onCancel(() => window.clearInterval(id));
  return id;
}

/** Run `fn` on every frame until the scope dies. Returns a stop function. */
export function scopedRaf(fn: (t: number) => void, scope: Scope = routeScope()): () => void {
  let id = 0;
  let stopped = false;
  const tick = (t: number) => {
    if (stopped || !scope.alive()) return;
    fn(t);
    id = window.requestAnimationFrame(tick);
  };
  id = window.requestAnimationFrame(tick);
  const stop = () => {
    stopped = true;
    window.cancelAnimationFrame(id);
  };
  scope.onCancel(stop);
  return stop;
}
