/* ============ P5 QUIZ — THEMES ============ */
import type { Settings, CustomTheme } from "./types";

export interface ThemeDef {
  id: string;
  name: string;
  tag: string;
  swatches: string[]; // [accent, ink, paper] — empty for custom
}

export const THEMES: ThemeDef[] = [
  { id: "calling-card", name: "CALLING CARD", tag: "The classic crimson heist", swatches: ["#e60012", "#0c0c0e", "#f6f4f0"] },
  { id: "noir", name: "NOIR", tag: "Black, paper and gold leaf", swatches: ["#c9a227", "#0a0a0b", "#efece4"] },
  { id: "azure", name: "AZURE", tag: "Midnight blue with cyan", swatches: ["#2563eb", "#070b16", "#eef3fc"] },
  { id: "chalkboard", name: "CHALKBOARD", tag: "After-school green", swatches: ["#21a366", "#0a1510", "#f1efe2"] },
  { id: "vapor", name: "VAPOR", tag: "Magenta dusk", swatches: ["#c026d3", "#150a1e", "#f6eeff"] },
  { id: "custom", name: "CUSTOM", tag: "Your colors, your heist", swatches: [] },
];

export function themeDef(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isValidTheme(id: string): boolean {
  return THEMES.some((t) => t.id === id);
}

/* ---------- tiny color utils ---------- */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** amt > 0 lightens toward white, amt < 0 darkens toward black (0..1) */
export function shift(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

function rgbaOf(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative-luminance contrast ratio (1..21) */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const CUSTOM_VARS = [
  "--red",
  "--red-deep",
  "--red-hot",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--paper",
  "--paper-dim",
  "--halftone",
];

function customVars(c: CustomTheme): Record<string, string> {
  const accent = safeColor(c?.accent, "#e60012");
  const ink = safeColor(c?.ink, "#0c0c0e");
  const paper = safeColor(c?.paper, "#f6f4f0");
  return {
    "--red": accent,
    "--red-deep": shift(accent, -0.35),
    "--red-hot": shift(accent, 0.18),
    "--ink": ink,
    "--ink-2": shift(ink, 0.05),
    "--ink-3": shift(ink, 0.1),
    "--paper": paper,
    "--paper-dim": shift(paper, -0.22),
    "--halftone": `radial-gradient(circle at 1px 1px, ${rgbaOf(paper, 0.16)} 1px, transparent 0)`,
  };
}

/* Only a plain hex color may reach a CSS value — blocks CSS-injection via a
   tampered localStorage custom theme. */
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}
function safeColor(v: unknown, fallback: string): string {
  return isHexColor(v) ? v.trim() : fallback;
}

/* ---------- apply ---------- */
export function applyTheme(s: Settings) {
  const root = document.documentElement;
  const id = isValidTheme(s.theme) ? s.theme : "calling-card";
  root.dataset.theme = id;
  if (id === "custom") {
    for (const [k, v] of Object.entries(customVars(s.customTheme))) {
      root.style.setProperty(k, v);
    }
  } else {
    for (const k of CUSTOM_VARS) root.style.removeProperty(k);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const ink = getComputedStyle(root).getPropertyValue("--ink").trim();
    if (ink) meta.setAttribute("content", ink);
  }
}
