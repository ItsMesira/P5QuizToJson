/* ============ P5 QUIZ — DOM BUILD HELPER ============ */

type Attrs = Record<string, string | number | boolean | undefined | null>;

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

export function toast(text: string, kind: "info" | "error" = "info") {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = h("div", { class: `toast ${kind}` }, [
    h("span", { class: "toast-icon" }, [kind === "error" ? "✕" : "★"]),
    document.createTextNode(text),
  ]);
  box.appendChild(el);
  import("gsap").then(({ gsap }) => {
    gsap.fromTo(el, { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "back.out(1.6)" });
    gsap.to(el, { x: 120, opacity: 0, duration: 0.3, delay: 3.2, ease: "power2.in", onComplete: () => el.remove() });
  });
}
