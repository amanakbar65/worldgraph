/**
 * Colours for the graph canvas. The canvas can't use Tailwind classes, so
 * it reads the same design tokens (CSS custom properties) at runtime and
 * resolves them to plain rgb values, once per theme. Meaning stays the same
 * as everywhere else: entity types keep their fixed hue, stories wear their
 * impact (amber risk, teal opportunity, slate neutral) and forecasts are
 * violet rings.
 */
import type { EntityType, Impact } from "@/api/contract";
import { ENTITY_TYPE_TONES, FORECAST_TONE, IMPACT_TONES } from "@/lib/meaning";

/** An sRGB colour with alpha (0..1). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The interface tokens the canvas needs besides the meaning colours. */
export const UI_VARS = [
  "--bg",
  "--bg-sunken",
  "--surface",
  "--fg",
  "--fg-muted",
  "--fg-subtle",
  "--line",
  "--line-strong",
  "--ring",
] as const;

/** Every custom property the canvas reads: UI tokens, impacts, forecast, entity types. */
export const PALETTE_VARS: readonly string[] = [
  ...UI_VARS,
  ...Object.values(IMPACT_TONES).map((t) => t.cssVar),
  FORECAST_TONE.cssVar,
  ...Object.values(ENTITY_TYPE_TONES).map((t) => t.cssVar),
].filter((v, i, all) => all.indexOf(v) === i);

/** Resolved colours by custom property name ("--risk" → rgb). */
export type Palette = Readonly<Record<string, Rgb>>;

const FALLBACK: Rgb = { r: 128, g: 128, b: 128, a: 1 };

/**
 * The custom property a node is drawn in: stories by impact, forecasts in
 * violet, everything else by entity type.
 */
export function nodeColorVar(node: { type: EntityType; impact?: Impact | null }): string {
  if (node.type === "story") return IMPACT_TONES[node.impact ?? "neutral"]?.cssVar ?? IMPACT_TONES.neutral.cssVar;
  if (node.type === "forecast") return FORECAST_TONE.cssVar;
  return ENTITY_TYPE_TONES[node.type]?.cssVar ?? IMPACT_TONES.neutral.cssVar;
}

/** Parse "rgb(1 2 3 / 0.5)", "rgba(1,2,3,0.5)", "#abc" or "#aabbcc". Other forms give null. */
export function parseColor(value: string): Rgb | null {
  const s = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255) : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map(channel);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if ([r, g, b, alpha].some((v) => !Number.isFinite(v))) return null;
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Math.min(1, Math.max(0, alpha)) };
  }
  return null;
}

/** "rgba(r, g, b, a)" with the colour's own alpha multiplied by `alpha`. */
export function rgba(color: Rgb | undefined, alpha = 1): string {
  const c = color ?? FALLBACK;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a * alpha)})`;
}

/** Look a colour up, falling back to a mid grey so drawing never fails. */
export function paletteColor(palette: Palette, cssVar: string): Rgb {
  return palette[cssVar] ?? FALLBACK;
}

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Turn any CSS colour the browser understands (our tokens are oklch) into
 * sRGB by painting one pixel. Falls back to parsing rgb()/hex text where
 * there is no canvas (tests).
 */
export function resolveCssColor(value: string): Rgb | null {
  const text = value.trim();
  if (!text) return null;
  if (probe === undefined) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext("2d", { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return parseColor(text);
  try {
    probe.clearRect(0, 0, 1, 1);
    // An unparseable value leaves the previous fill style; a sentinel catches that.
    probe.fillStyle = "#010203";
    probe.fillStyle = text;
    if (probe.fillStyle === "#010203" && !/^#010203$/i.test(text)) return parseColor(text);
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r, g, b, a: round(a / 255) };
  } catch {
    return parseColor(text);
  }
}

/**
 * Read every token the canvas uses from an element's computed style (the
 * <html> element, where the theme attribute lives).
 */
export function readPalette(
  element: Element | null = typeof document === "undefined" ? null : document.documentElement,
  resolve: (value: string) => Rgb | null = resolveCssColor,
): Palette {
  const out: Record<string, Rgb> = {};
  if (!element) return out;
  let style: CSSStyleDeclaration | null = null;
  try {
    style = getComputedStyle(element);
  } catch {
    return out;
  }
  for (const name of PALETTE_VARS) {
    const value = style.getPropertyValue(name);
    const color = value ? resolve(value) : null;
    if (color) out[name] = color;
  }
  return out;
}

function clamp255(v: number): number {
  return Math.round(Math.min(255, Math.max(0, v)));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
