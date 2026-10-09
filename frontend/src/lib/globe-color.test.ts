import { afterEach, describe, expect, it } from "vitest";

import {
  mix,
  oklchToRgb,
  paletteKey,
  parseCssColor,
  readGlobePalette,
  toCss,
  withAlpha,
} from "./globe-color";

describe("parseCssColor", () => {
  it("reads hex colours, short and long, with alpha", () => {
    expect(parseCssColor("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseCssColor("#336699")).toEqual([51, 102, 153, 255]);
    expect(parseCssColor("#33669980")).toEqual([51, 102, 153, 128]);
  });

  it("reads rgb() and rgba() in both syntaxes", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual([10, 20, 30, 255]);
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 128]);
    expect(parseCssColor("rgb(10 20 30 / 25%)")).toEqual([10, 20, 30, 64]);
  });

  it("converts oklch() tokens, including alpha", () => {
    expect(parseCssColor("oklch(1 0 0)")).toEqual([255, 255, 255, 255]);
    expect(parseCssColor("oklch(0 0 0)")).toEqual([0, 0, 0, 255]);
    expect(parseCssColor("oklch(1 0 0 / 0.08)")).toEqual([255, 255, 255, 20]);
    expect(parseCssColor("oklch(100% 0 0)")).toEqual([255, 255, 255, 255]);
  });

  it("returns null for what it can't read", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
    expect(parseCssColor("color-mix(in oklch, red, blue)")).toBeNull();
    expect(parseCssColor("#12")).toBeNull();
  });
});

describe("oklchToRgb", () => {
  it("matches known sRGB primaries", () => {
    const red = oklchToRgb(0.6279554, 0.2576833, 29.2338851);
    expect(red[0]).toBeGreaterThan(250);
    expect(red[1]).toBeLessThan(5);
    expect(red[2]).toBeLessThan(5);
    const blue = oklchToRgb(0.4520137, 0.3132144, 264.052021);
    expect(blue[2]).toBeGreaterThan(250);
    expect(blue[0]).toBeLessThan(5);
  });

  it("clips colours outside sRGB instead of overflowing", () => {
    for (const v of oklchToRgb(0.9, 0.4, 150)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("colour helpers", () => {
  it("mixes, sets alpha and writes CSS", () => {
    expect(mix([0, 0, 0, 255], [200, 100, 50, 255], 0.5)).toEqual([100, 50, 25, 255]);
    expect(mix([0, 0, 0, 0], [10, 10, 10, 10], 2)).toEqual([10, 10, 10, 10]);
    expect(withAlpha([1, 2, 3, 255], 0.5)).toEqual([1, 2, 3, 128]);
    expect(toCss([1, 2, 3, 128])).toBe("rgba(1, 2, 3, 0.502)");
  });
});

describe("readGlobePalette", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-wg-theme");
  });

  it("reads the tokens from CSS custom properties and the theme attribute", () => {
    const root = document.documentElement;
    root.style.setProperty("--risk", "oklch(1 0 0)");
    root.style.setProperty("--opportunity", "#336699");
    root.setAttribute("data-wg-theme", "light");
    const palette = readGlobePalette(root);
    expect(palette.risk).toEqual([255, 255, 255, 255]);
    expect(palette.opportunity).toEqual([51, 102, 153, 255]);
    expect(palette.theme).toBe("light");
    // Tokens that are missing fall back to a mid grey rather than failing.
    expect(palette.forecast).toEqual([128, 128, 128, 255]);
    expect(paletteKey(palette)).toContain("light:");
  });
});
