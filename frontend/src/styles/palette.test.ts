/**
 * Palette checks for src/styles/tokens.css, in both themes.
 *
 * The colours are computed, not eyeballed:
 * - OKLCH → OKLab → linear sRGB → sRGB (CSS Color 4 matrices).
 * - Translucent tokens (glass) are composited in gamma-encoded sRGB, the way
 *   browsers blend, over every backdrop a panel can float on.
 * - Text contrast is the WCAG 2 ratio.
 * - Colour-vision deficiency uses the Machado, Oliveira & Fernandes (2009)
 *   matrices at full severity (protanopia, deuteranopia, tritanopia) applied
 *   in linear RGB; separation is the Euclidean distance in OKLab × 100 (ΔE).
 *
 * Thresholds and why:
 * - Text (fg, fg-muted, fg-subtle): WCAG AA, 4.5:1 on every surface.
 * - Meaning colours (risk, opportunity, neutral, forecast) carry text in
 *   badges, so they meet 4.5:1 on every surface and on their own 12 % tint;
 *   on the globe they are marks, so 3:1 on land and ocean.
 * - Meaning colours are told apart by everyone: ΔE ≥ 15 for normal vision,
 *   ≥ 10 under protanopia and deuteranopia, ≥ 8 under tritanopia.
 * - Entity types always travel with their lucide icon, so colour is the
 *   second cue: ΔE ≥ 9 between types and ≥ 10 against meaning colours, and
 *   no pair collapses under any deficiency (ΔE ≥ 2.5 / 3).
 * - The pairs that sit side by side in the graph and were close before get a
 *   stricter bar: commodity vs risk and infrastructure vs forecast
 *   (normal ≥ 15, protan/deutan ≥ 7.5, tritan ≥ 6).
 */
import { describe, expect, it } from "vitest";

import tokensCss from "./tokens.css?raw";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Oklch {
  l: number;
  c: number;
  h: number;
  alpha: number;
}
type Theme = Record<string, Oklch>;

function parseBlock(selector: string): Theme {
  const start = tokensCss.indexOf(selector);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const open = tokensCss.indexOf("{", start);
  const close = tokensCss.indexOf("}", open);
  const body = tokensCss.slice(open + 1, close);
  const theme: Theme = {};
  for (const match of body.matchAll(/--([\w-]+):\s*oklch\(([^)]*)\)\s*;/g)) {
    const [main, alpha] = match[2].split("/").map((s) => s.trim());
    const [l, c, h] = main.split(/\s+/).map(Number);
    theme[match[1]] = { l, c, h, alpha: alpha === undefined ? 1 : Number(alpha) };
  }
  return theme;
}

const THEMES: Record<"dark" | "light", Theme> = {
  dark: parseBlock(':root[data-wg-theme="dark"]'),
  light: parseBlock(':root[data-wg-theme="light"]'),
};

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

/** OKLCH → linear sRGB (may fall outside 0..1 when out of gamut). */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const encode = (x: number) => {
  const v = clamp01(x);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** Gamma-encoded sRGB, 0..1. */
const toSrgb = (color: Oklch): Rgb => oklchToLinear(color).map(encode) as Rgb;

/** Source-over blend in gamma-encoded sRGB (what browsers do by default). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]) as Rgb;

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Vision = "normal" | "protan" | "deutan" | "tritan";

/** Machado, Oliveira & Fernandes (2009), severity 1.0, linear RGB. */
const MACHADO: Record<Exclude<Vision, "normal">, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function linearToOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(rgb: Rgb, vision: Vision): Rgb {
  const linear = rgb.map(decode) as Rgb;
  if (vision === "normal") return linear;
  return MACHADO[vision].map((row) => clamp01(row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])) as Rgb;
}

/** OKLab distance × 100 between two colours as seen with the given vision. */
function deltaE(a: Rgb, b: Rgb, vision: Vision): number {
  const p = linearToOklab(simulate(a, vision));
  const q = linearToOklab(simulate(b, vision));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const TEXT = ["fg", "fg-muted", "fg-subtle"] as const;
const MEANING = ["risk", "opportunity", "neutral", "forecast"] as const;
const TYPES = [
  "type-region",
  "type-organization",
  "type-person",
  "type-commodity",
  "type-sector",
  "type-infrastructure",
  "type-policy",
  "type-indicator",
  "type-user",
] as const;
/** What a glass panel can float over (backdrop-blur averages fine detail away). */
const GLASS_BACKDROPS = ["bg", "globe-space", "globe-ocean", "globe-land", "globe-land-active"] as const;
const GLOBE_GROUND = ["globe-space", "globe-ocean", "globe-land", "globe-land-active"] as const;
const VISIONS: Vision[] = ["normal", "protan", "deutan", "tritan"];

function pairs<T>(xs: readonly T[]): [T, T][] {
  return xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as [T, T]));
}

for (const [name, theme] of Object.entries(THEMES)) {
  const rgb = (token: string): Rgb => {
    const color = theme[token];
    if (!color) throw new Error(`${name}: --${token} is missing`);
    return toSrgb(color);
  };
  const surfaces: [string, Rgb][] = [
    ["bg", rgb("bg")],
    ["surface", rgb("surface")],
    ["surface-2", rgb("surface-2")],
    ...GLASS_BACKDROPS.map((b): [string, Rgb] => [`glass over ${b}`, over(rgb("glass"), theme.glass.alpha, rgb(b))]),
  ];
  const minContrast = (token: string, against: [string, Rgb][] = surfaces) =>
    Math.min(...against.map(([, s]) => contrast(rgb(token), s)));
  const separation = (a: string, b: string) =>
    Object.fromEntries(VISIONS.map((v) => [v, deltaE(rgb(a), rgb(b), v)])) as Record<Vision, number>;

  describe(`palette: ${name} theme`, () => {
    it("defines the same tokens as the other theme", () => {
      const other = name === "dark" ? THEMES.light : THEMES.dark;
      expect(Object.keys(theme).sort()).toEqual(Object.keys(other).sort());
      for (const token of [...TEXT, ...MEANING, ...TYPES, "bg", "surface", "surface-2", "glass", "ring"]) {
        expect(theme[token], `--${token}`).toBeDefined();
      }
    });

    it("keeps every colour inside sRGB, so it renders exactly as written", () => {
      for (const [token, color] of Object.entries(theme)) {
        for (const channel of oklchToLinear(color)) {
          expect(channel, `--${token}`).toBeGreaterThan(-0.002);
          expect(channel, `--${token}`).toBeLessThan(1.002);
        }
      }
    });

    it("meets WCAG AA (4.5:1) for text on every surface, including glass", () => {
      for (const token of TEXT) {
        for (const [surface, s] of surfaces) {
          expect(contrast(rgb(token), s), `--${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it("keeps the focus ring visible (3:1) on every surface", () => {
      expect(minContrast("ring")).toBeGreaterThanOrEqual(3);
    });

    it("lets meaning colours carry text: 4.5:1 on surfaces and on their own tint", () => {
      for (const token of MEANING) {
        expect(minContrast(token), `--${token}`).toBeGreaterThanOrEqual(4.5);
        for (const [surface, s] of surfaces) {
          const tint = over(rgb(token), 0.12, s);
          expect(contrast(rgb(token), tint), `--${token} on its tint over ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it("shows meaning colours as marks (3:1) on globe land and ocean", () => {
      const ground = GLOBE_GROUND.map((g): [string, Rgb] => [g, rgb(g)]);
      for (const token of MEANING) {
        expect(minContrast(token, ground), `--${token}`).toBeGreaterThanOrEqual(3);
      }
    });

    it("gives entity-type colours text contrast (4.5:1) on every surface", () => {
      for (const token of TYPES) {
        expect(minContrast(token), `--${token}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps the four meaning colours apart for every kind of colour vision", () => {
      for (const [a, b] of pairs(MEANING)) {
        const d = separation(a, b);
        expect(d.normal, `${a} vs ${b}, normal vision`).toBeGreaterThanOrEqual(15);
        expect(d.protan, `${a} vs ${b}, protanopia`).toBeGreaterThanOrEqual(10);
        expect(d.deutan, `${a} vs ${b}, deuteranopia`).toBeGreaterThanOrEqual(10);
        expect(d.tritan, `${a} vs ${b}, tritanopia`).toBeGreaterThanOrEqual(8);
      }
    });

    it("keeps entity types distinct from the meaning colours", () => {
      for (const type of TYPES) {
        for (const meaning of MEANING) {
          const d = separation(type, meaning);
          expect(d.normal, `${type} vs ${meaning}, normal vision`).toBeGreaterThanOrEqual(10);
          expect(Math.min(d.protan, d.deutan), `${type} vs ${meaning}, red-green`).toBeGreaterThanOrEqual(3.5);
          expect(d.tritan, `${type} vs ${meaning}, tritanopia`).toBeGreaterThanOrEqual(2.5);
        }
      }
    });

    it("separates commodity from risk and infrastructure from forecast", () => {
      for (const [a, b] of [
        ["type-commodity", "risk"],
        ["type-infrastructure", "forecast"],
      ] as const) {
        const d = separation(a, b);
        expect(d.normal, `${a} vs ${b}, normal vision`).toBeGreaterThanOrEqual(15);
        expect(d.protan, `${a} vs ${b}, protanopia`).toBeGreaterThanOrEqual(7.5);
        expect(d.deutan, `${a} vs ${b}, deuteranopia`).toBeGreaterThanOrEqual(7.5);
        expect(d.tritan, `${a} vs ${b}, tritanopia`).toBeGreaterThanOrEqual(6);
      }
    });

    it("keeps entity types distinct from each other", () => {
      for (const [a, b] of pairs(TYPES)) {
        const d = separation(a, b);
        expect(d.normal, `${a} vs ${b}, normal vision`).toBeGreaterThanOrEqual(9);
        for (const v of ["protan", "deutan", "tritan"] as const) {
          expect(d[v], `${a} vs ${b}, ${v}`).toBeGreaterThanOrEqual(2.5);
        }
      }
    });
  });
}

describe("palette: parsing", () => {
  it("reads both theme blocks", () => {
    expect(Object.keys(THEMES.dark).length).toBeGreaterThan(20);
    expect(Object.keys(THEMES.light).length).toBeGreaterThan(20);
    expect(THEMES.dark.glass.alpha).toBeLessThan(1);
  });
});
