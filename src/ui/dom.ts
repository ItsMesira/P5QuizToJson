/* ============ P5 QUIZ — DOM BUILD HELPER ============ */

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "dataset") Object.assign(el.dataset, value as unknown as Record<string, string>);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/* Toasts are the app's only user-visible error channel, so their removal must
   never depend on an animation library succeeding: `import("gsap")` can reject
   (offline, CSP, stalled chunk), and before this guard that left the toast in
   the DOM forever with no way to dismiss it. Lifetime is now owned by a plain
   timer; gsap is decoration only. */
const MAX_TOASTS = 4;
const TOAST_MS = 3500;

function removeToast(el: HTMLElement) {
  if (!el.isConnected) return;
  el.classList.add("toast-out");
  const kill = () => el.remove();
  // one frame of exit animation, but never a dependency on it
  window.setTimeout(kill, 200);
  // belt and braces: if something re-parents or pauses timers, drop it directly
  window.setTimeout(() => el.isConnected && el.remove(), 1200);
}

export function toast(text: string, kind: "info" | "error" = "info") {
  const box = document.getElementById("toasts");
  if (!box) return;

  const el = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, [
    h("span", { class: "toast-icon" }, [kind === "error" ? "✕" : "★"]),
    h("span", { class: "toast-text" }, [text]),
    h("button", {
      class: "toast-close",
      type: "button",
      "aria-label": "Dismiss",
      onclick: () => removeToast(el),
    }, ["✕"]),
  ]);
  box.appendChild(el);

  // cap the stack so a burst cannot cover the screen
  while (box.children.length > MAX_TOASTS) {
    const oldest = box.firstElementChild as HTMLElement | null;
    if (!oldest) break;
    oldest.remove();
  }

  // the authoritative lifetime — independent of gsap, reduced-motion, or CSP
  window.setTimeout(() => removeToast(el), TOAST_MS);

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    void import("gsap")
      .then(({ gsap }) => {
        if (!el.isConnected) return;
        gsap.fromTo(el, { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "back.out(1.6)" });
      })
      .catch(() => {
        /* animation is optional; the timer above already guarantees removal */
      });
  }
}
