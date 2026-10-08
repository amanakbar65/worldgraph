/**
 * Colours for the globe's WebGL layers (MapLibre and deck.gl), read from the
 * CSS design tokens at runtime so the map follows the theme.
 *
 * WebGL layers can't use `var(--risk)`: deck.gl wants `[r, g, b, a]` arrays
 * and MapLibre wants plain `rgba()` strings. The tokens are written in
 * oklch(), so this file converts them (CSS Color 4 maths). Components never
 * name colours themselves; they take them from `readGlobePalette()`.
 */

/** A colour as deck.gl wants it: red, green, blue and alpha, each 0–255. */
export type Rgba = [number, number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** sRGB gamma for one linear channel (0–1). */
function gamma(x: number): number {
  const v = clamp(x, 0, 1);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** OKLCH (L 0–1, C, H in degrees) to sRGB bytes; out-of-gamut values are clipped. */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  return [Math.round(gamma(r) * 255), Math.round(gamma(g) * 255), Math.round(gamma(bl) * 255)];
}

/** Alpha as 0–1 from "0.4", "40%" or nothing (1). */
function alpha(token: string | undefined): number {
  if (token === undefined) return 1;
  const t = token.trim();
  const v = t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
}

/** Split "a b c / d" or "a, b, c, d" into the three channels and alpha. */
function channels(body: string): { parts: string[]; a: string | undefined } | null {
  const [main, slash] = body.split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (slash !== undefined) return parts.length === 3 ? { parts, a: slash.trim() } : null;
  if (parts.length === 4) return { parts: parts.slice(0, 3), a: parts[3] };
  return parts.length === 3 ? { parts, a: undefined } : null;
}

/**
 * Parse a computed CSS colour: oklch(), rgb()/rgba() or #hex. Returns null
 * for anything else (the caller then asks the browser to convert it).
 */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  }

  const fn = /^(oklch|rgba?)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const parsed = channels(fn[2]);
  if (!parsed) return null;
  const a = Math.round(alpha(parsed.a) * 255);
  const [x, y, z] = parsed.parts;

  if (fn[1] === "oklch") {
    const l = x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x);
    const c = y.endsWith("%") ? (parseFloat(y) / 100) * 0.4 : parseFloat(y);
    const h = z === "none" ? 0 : parseFloat(z);
    if (![l, c, h].every(Number.isFinite)) return null;
    return [...oklchToRgb(l, c, h), a];
  }

  const rgb = [x, y, z].map((t) => (t.endsWith("%") ? (parseFloat(t) / 100) * 255 : parseFloat(t)));
  if (!rgb.every(Number.isFinite)) return null;
  return [Math.round(clamp(rgb[0], 0, 255)), Math.round(clamp(rgb[1], 0, 255)), Math.round(clamp(rgb[2], 0, 255)), a];
}

/** Ask the browser to convert any CSS colour (a fallback for formats we don't parse). */
function browserColor(value: string): Rgba | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a];
  } catch {
    return null;
  }
}

/** `rgba(r, g, b, a)` for MapLibre paint properties. */
export function toCss(c: Rgba): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+(c[3] / 255).toFixed(3)})`;
}

/** Mix two colours; t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = clamp(t, 0, 1);
  return [0, 1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as Rgba;
}

/** The same colour with a new alpha (0–1). */
export function withAlpha(c: Rgba, a: number): Rgba {
  return [c[0], c[1], c[2], Math.round(clamp(a, 0, 1) * 255)];
}

// ---------------------------------------------------------------------------
// The globe palette
// ---------------------------------------------------------------------------

/** Which token each palette colour comes from (tokens.css). */
export const GLOBE_TOKENS = {
  space: "--globe-space",
  ocean: "--globe-ocean",
  land: "--globe-land",
  landActive: "--globe-land-active",
  border: "--globe-border",
  label: "--globe-label",
  atmosphere: "--globe-atmosphere",
  risk: "--risk",
  opportunity: "--opportunity",
  neutral: "--neutral",
  forecast: "--forecast",
  fg: "--fg",
  bg: "--bg",
  ring: "--ring",
} as const;

export type GlobePalette = Record<keyof typeof GLOBE_TOKENS, Rgba> & { theme: "dark" | "light" };

/** Read the palette from the CSS custom properties on `root` (default: <html>). */
export function readGlobePalette(root: HTMLElement = document.documentElement): GlobePalette {
  const style = getComputedStyle(root);
  const out = {} as Record<keyof typeof GLOBE_TOKENS, Rgba>;
  for (const [key, token] of Object.entries(GLOBE_TOKENS) as [keyof typeof GLOBE_TOKENS, string][]) {
    const raw = style.getPropertyValue(token).trim();
    // Unknown formats go through the browser; a missing token falls back to mid grey.
    out[key] = parseCssColor(raw) ?? (raw ? browserColor(raw) : null) ?? [128, 128, 128, 255];
  }
  const theme = root.getAttribute("data-wg-theme") === "light" ? "light" : "dark";
  return { ...out, theme };
}

/** A stable string for a palette, for memo keys and layer update triggers. */
export function paletteKey(p: GlobePalette): string {
  return `${p.theme}:${Object.keys(GLOBE_TOKENS)
    .map((k) => p[k as keyof typeof GLOBE_TOKENS].join(","))
    .join("|")}`;
}
