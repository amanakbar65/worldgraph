import { afterEach, describe, expect, it, vi } from "vitest";

import { ENTITY_TYPES } from "@/api/contract";
import { ENTITY_TYPE_TONES, IMPACT_TONES } from "@/lib/meaning";

import { nodeColorVar, paletteColor, PALETTE_VARS, parseColor, readPalette, rgba, UI_VARS } from "./graph-colors";

afterEach(() => vi.restoreAllMocks());

describe("nodeColorVar", () => {
  it("colours stories by impact (neutral when unknown)", () => {
    expect(nodeColorVar({ type: "story", impact: "risk" })).toBe("--risk");
    expect(nodeColorVar({ type: "story", impact: "opportunity" })).toBe("--opportunity");
    expect(nodeColorVar({ type: "story", impact: null })).toBe("--neutral");
  });

  it("draws forecasts in the forecast violet, whatever their impact", () => {
    expect(nodeColorVar({ type: "forecast", impact: "risk" })).toBe("--forecast");
  });

  it("gives every other kind its fixed type colour, the same as the chips", () => {
    for (const type of ENTITY_TYPES.filter((t) => t !== "story" && t !== "forecast")) {
      expect(nodeColorVar({ type })).toBe(ENTITY_TYPE_TONES[type].cssVar);
    }
  });
});

describe("the palette", () => {
  it("reads every meaning colour and the interface tokens", () => {
    for (const v of [...UI_VARS, ...Object.values(IMPACT_TONES).map((t) => t.cssVar), "--forecast", "--type-region"]) {
      expect(PALETTE_VARS).toContain(v);
    }
    expect(new Set(PALETTE_VARS).size).toBe(PALETTE_VARS.length);
  });

  it("reads tokens from the computed style of <html>, re-read on each call", () => {
    const values: Record<string, string> = { "--risk": "rgb(230 140 20)", "--bg": "#000", "--fg": "" };
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ getPropertyValue: (name: string) => values[name] ?? "" }) as unknown as CSSStyleDeclaration,
    );
    const resolve = (v: string) => parseColor(v);
    const dark = readPalette(document.documentElement, resolve);
    expect(dark["--risk"]).toEqual({ r: 230, g: 140, b: 20, a: 1 });
    expect(dark["--bg"]).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(dark["--fg"]).toBeUndefined();
    // The theme changes: the next read sees the new values.
    values["--risk"] = "rgb(180 90 0)";
    expect(readPalette(document.documentElement, resolve)["--risk"]).toEqual({ r: 180, g: 90, b: 0, a: 1 });
    expect(readPalette(null)).toEqual({});
  });

  it("falls back to grey so drawing never fails", () => {
    expect(paletteColor({}, "--missing")).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    expect(rgba(undefined)).toBe("rgba(128, 128, 128, 1)");
  });
});

describe("parseColor and rgba", () => {
  it("understands hex and rgb() forms", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#0a141e")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("#0a141e80")).toEqual({ r: 10, g: 20, b: 30, a: 0.502 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("rejects what it can't read", () => {
    expect(parseColor("oklch(0.7 0.1 200)")).toBeNull();
    expect(parseColor("rgb(1 2)")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  it("multiplies alpha", () => {
    expect(rgba({ r: 1, g: 2, b: 3, a: 0.5 }, 0.5)).toBe("rgba(1, 2, 3, 0.25)");
  });
});
