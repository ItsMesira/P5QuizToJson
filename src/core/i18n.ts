/* ============ P5 QUIZ — I18N ENGINE ============ */
/* English natural-language keys: t("NEXT") looks up the active dictionary and
   falls back to the English key itself when a translation is missing. */

export interface LocaleDef {
  id: string;
  name: string; // native name for the picker
}

export const LOCALES: LocaleDef[] = [
  { id: "en", name: "English" },
  { id: "th", name: "ไทย" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
  { id: "de", name: "Deutsch" },
  { id: "ja", name: "日本語" },
];

/* Dictionaries are code-split. Statically importing all five put 143kB of source
   — roughly 40% of the eager bundle — on the critical path to serve exactly one
   locale. `t()` stays synchronous and is never allowed to run against a locale
   whose dictionary is missing: setLocale() loads first, then applies. */
const LOADERS: Record<string, () => Promise<Record<string, string>>> = {
  th: () => import("../i18n/th").then((m) => m.default),
  es: () => import("../i18n/es").then((m) => m.default),
  fr: () => import("../i18n/fr").then((m) => m.default),
  de: () => import("../i18n/de").then((m) => m.default),
  ja: () => import("../i18n/ja").then((m) => m.default),
};

const DICTS: Record<string, Record<string, string>> = {};
const pending = new Map<string, Promise<void>>();

/** Load `id`'s dictionary into the cache. `en` needs none — the keys ARE the
 *  English strings. Safe to call repeatedly; concurrent calls share one import. */
export function ensureLocale(id: string): Promise<void> {
  if (id === "en" || DICTS[id]) return Promise.resolve();
  const load = LOADERS[id];
  if (!load) return Promise.resolve();
  let p = pending.get(id);
  if (!p) {
    p = load()
      .then((dict) => {
        DICTS[id] = dict;
      })
      .catch(() => undefined) // fall back to English keys rather than throwing
      .then(() => {
        pending.delete(id);
      });
    pending.set(id, p);
  }
  return p;
}

let current = "en";
const missing = new Set<string>();

export function detectLocale(tag?: string): string {
  const raw = (tag ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en").toLowerCase();
  if (LOCALES.some((l) => l.id === raw)) return raw;
  const prefix = raw.split("-")[0];
  return LOCALES.some((l) => l.id === prefix) ? prefix : "en";
}

export function setLocale(id: string) {
  const next = id || detectLocale();
  if (next === current) return;
  if (next !== "en" && !DICTS[next]) {
    /* Not in memory yet: load it, then apply. Callers that cannot tolerate the
       frame of English should `await ensureLocale(next)` before calling. */
    void ensureLocale(next).then(() => setLocale(next));
    return;
  }
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  window.dispatchEvent(new CustomEvent("p5q-locale", { detail: next }));
}

export function applyLocale(s: { lang: string }) {
  setLocale(s.lang || detectLocale());
}

export function locale(): string {
  return current;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let s = dict?.[key];
  if (s === undefined) {
    if (current !== "en") missing.add(key);
    s = key;
  }
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  }
  return s;
}

/** keys requested in a non-English locale that had no translation */
export function missingKeys(): string[] {
  return [...missing];
}

/* local-dev hook so the language test can audit coverage after walking screens */
if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  (window as unknown as Record<string, unknown>).__p5qMissingKeys = missingKeys;
}

/* quiz question-type ids → translated labels (keys already exist in the dicts) */
const TYPE_KEYS: Record<string, string> = {
  multiple: "CHOICE",
  boolean: "TRUE/FALSE",
  multi: "MULTI-PICK",
  fill: "FILL-IN",
  order: "ORDER",
  match: "MATCH",
  numeric: "NUMERIC",
  open: "OPEN",
  hotspot: "HOTSPOT",
};

export function typeLabel(type: string): string {
  return t(TYPE_KEYS[type] ?? type.toUpperCase());
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat(current).format(n);
}

export function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat(current, { dateStyle: "medium" }).format(new Date(ts));
}
