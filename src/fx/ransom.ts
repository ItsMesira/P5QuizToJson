/* ============ P5 QUIZ — RANSOM-NOTE LETTERING (ported from P5 Best) ============ */

/* Deterministic pseudo-random hash — letters look identical every visit */
function hash(str: string): number {
  let h = 9;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 387420489);
  return (h ^ (h >>> 9)) >>> 0;
}

export interface RansomOpts {
  size?: string;      // css font-size, e.g. "clamp(26px,4.2vw,56px)"
  className?: string; // extra classes for the wrapper
}

/* Split into grapheme clusters so combining marks (Thai vowels/tone marks,
   emoji ZWJ sequences…) never break apart into separate ransom letters. */
function segments(text: string): string[] {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...seg.segment(text)].map((s) => s.segment);
  } catch {
    return [...text];
  }
}

/* Convert an element's text into individually styled ransom letters */
export function ransomize(el: HTMLElement, text: string, opts: RansomOpts = {}) {
  el.classList.add("ransom");
  if (opts.size) el.style.fontSize = opts.size;
  if (opts.className) el.className += ` ${opts.className}`;
  el.textContent = "";
  segments(text).forEach((c, i) => {
    const span = document.createElement("span");
    span.className = "ch display";
    span.textContent = c;
    const h = hash(text + i);
    const rot = (h % 17) - 8;                       // -8..8 deg
    const scale = 0.86 + ((h >> 3) % 30) / 100;     // 0.86..1.15
    const dy = ((h >> 5) % 9) - 4;                  // -4..4 px
    const t = `rotate(${rot}deg) scale(${scale}) translateY(${dy}px)`;
    span.style.setProperty("--t", t);
    span.style.transform = t;
    const variant = (h >> 7) % 10;
    if (variant === 0) span.classList.add("box");
    else if (variant === 1) span.classList.add("boxw");
    else if (variant === 2) span.classList.add("red");
    el.appendChild(span);
  });
}

/* Build a fresh ransom element (for headings built via code) */
export function ransomEl(text: string, opts: RansomOpts = {}): HTMLElement {
  const el = document.createElement("span");
  ransomize(el, text, opts);
  return el;
}

/* Apply ransom lettering to every element carrying data-ransom, then to
   a selector list (e.g. ".screen-title") if given. */
export function ransomizeAll(selectors: string[] = []) {
  document.querySelectorAll<HTMLElement>("[data-ransom]").forEach((el) => {
    const t = el.getAttribute("data-ransom");
    if (t) ransomize(el, t);
  });
  selectors.forEach((sel) => {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.querySelector(".ransom") || el.classList.contains("ransom")) return;
      const t = el.textContent?.trim() ?? "";
      el.textContent = "";
      const wrap = ransomEl(t);
      el.appendChild(wrap);
    });
  });
}
