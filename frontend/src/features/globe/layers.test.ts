import { describe, expect, it } from "vitest";

import type { GlobePalette, Rgba } from "@/lib/globe-color";

import { GLOBE } from "./fixtures";
import { GlowExtension } from "./glow-extension";
import { buildLayers, DEFAULT_TOGGLES, PICK_PASSES, type LayerInput } from "./layers";
import { arcPath, glowAlpha, type ArcDatum, type GlobeEvent } from "./model";

const c = (r: number, g: number, b: number): Rgba => [r, g, b, 255];
const palette: GlobePalette = {
  theme: "dark",
  space: c(0, 0, 10),
  ocean: c(10, 20, 40),
  land: c(40, 40, 50),
  landActive: c(60, 60, 70),
  border: c(90, 90, 100),
  label: c(200, 200, 210),
  atmosphere: c(80, 120, 200),
  risk: c(250, 180, 60),
  opportunity: c(60, 220, 200),
  neutral: c(150, 155, 165),
  forecast: c(190, 140, 250),
  fg: c(240, 240, 245),
  bg: c(20, 22, 30),
  ring: c(150, 180, 230),
};

const arcs: ArcDatum[] = (["reported", "inferred", "projected"] as const).map((linkType, i) => ({
  ...GLOBE.arcs[0],
  id: i + 1,
  link_type: linkType,
  focus: false,
  dim: false,
  path: arcPath(GLOBE.arcs[0].src, GLOBE.arcs[0].dst, 8),
}));

function input(overrides: Partial<LayerInput> = {}): LayerInput {
  return {
    palette,
    paletteKey: "test",
    glow: c(210, 220, 240),
    toggles: DEFAULT_TOGGLES,
    zoom: 1.8,
    events: GLOBE.events,
    crowd: GLOBE.events.length,
    fresh: [],
    arcs,
    forecasts: GLOBE.forecasts,
    focusId: null,
    labels: [],
    fontFamily: "sans-serif",
    ringAtlas: null,
    pulse: 0.5,
    calm: true,
    ...overrides,
  };
}

type Props = Record<string, unknown>;
const byId = (layers: ReturnType<typeof buildLayers>, id: string) =>
  layers.find((l) => l.id === id)?.props as Props | undefined;

describe("the globe's deck.gl layers", () => {
  it("draws the activity glow, links, forecast rings and events, each only when switched on", () => {
    const still = GLOBE.forecasts.map((f) => ({ ...f, change_24h: 0 }));
    expect(buildLayers(input({ forecasts: still })).map((l) => l.id)).toEqual([
      "glow",
      "arcs",
      "forecasts",
      "events",
    ]);
    const some = buildLayers(
      input({ forecasts: still, toggles: { ...DEFAULT_TOGGLES, activity: false, arcs: false } }),
    );
    expect(some.map((l) => l.id)).toEqual(["forecasts", "events"]);
  });

  it("draws no hexagons any more, and never picks the glow", () => {
    for (const zoom of [0.5, 1.8, 3.5, 5, 8]) {
      const ids = buildLayers(input({ zoom })).map((l) => l.id);
      expect(ids.some((id) => /hex/.test(id))).toBe(false);
    }
    expect(PICK_PASSES.flatMap(([ids]) => ids)).toEqual(["events", "forecasts", "arcs"]);
    expect(byId(buildLayers(input()), "glow")!.pickable).toBeFalsy();
  });

  it("builds the glow at every zoom and leaves the fading to its shader", () => {
    // The layer stays put while the camera moves (no per-frame React state);
    // GlowExtension fades it in and out with the zoom on the GPU.
    for (const zoom of [1, 3.4, 5, 7.5]) {
      const glow = byId(buildLayers(input({ zoom })), "glow")!;
      const extensions = glow.extensions as unknown[];
      expect(extensions.some((e) => e instanceof GlowExtension)).toBe(true);
      expect(glow.radiusUnits).toBe("pixels");
    }
    expect(byId(buildLayers(input({ events: [] })), "glow")).toBeUndefined();
  });

  it("weights the glow by importance, in the glow token's colour", () => {
    const glow = byId(buildLayers(input()), "glow")!;
    const fill = glow.getFillColor as (d: GlobeEvent) => Rgba;
    const radius = glow.getRadius as (d: GlobeEvent) => number;
    const big = { ...GLOBE.events[0], importance: 95 };
    const small = { ...GLOBE.events[0], importance: 10 };
    expect(fill(big).slice(0, 3)).toEqual([210, 220, 240]);
    expect(fill(big)[3]).toBeGreaterThan(fill(small)[3]);
    expect(fill(big)[3]).toBe(Math.round(glowAlpha(95, "dark") * 255));
    expect(radius(big)).toBeGreaterThan(radius(small));
  });

  it("draws links with trust at a glance: width from strength, opacity from confidence", () => {
    const layer = byId(buildLayers(input()), "arcs")!;
    const width = layer.getWidth as (d: ArcDatum) => number;
    const color = layer.getColor as (d: ArcDatum) => Rgba;
    const sure = { ...arcs[0], confidence: 0.9 };
    const unsure = { ...arcs[0], confidence: 0.3 };
    expect(width(sure)).toBeGreaterThan(width(unsure));
    expect(color(sure)[3]).toBeGreaterThan(color(unsure)[3]);
    // A strength, when the API sends one, sets the width; confidence still sets the opacity.
    const strong = { ...unsure, strength: 1 };
    expect(width(strong)).toBeGreaterThan(width(sure));
    expect(color(strong)[3]).toBe(color(unsure)[3]);
  });

  it("dashes links by type: solid reported, dashed inferred, dotted projected", () => {
    const layer = byId(buildLayers(input()), "arcs")!;
    const dash = layer.getDashArray as (d: ArcDatum) => [number, number];
    const [reported, inferred, projected] = arcs.map(dash);
    expect(reported).toEqual([0, 0]);
    expect(inferred[0]).toBeGreaterThan(projected[0]);
  });

  it("fades dimmed links", () => {
    const layer = byId(buildLayers(input()), "arcs")!;
    const color = layer.getColor as (d: ArcDatum) => Rgba;
    expect(color({ ...arcs[0], dim: true })[3]).toBeLessThan(color(arcs[0])[3]);
  });

  it("draws smaller points when the window is busy", () => {
    const quiet = byId(buildLayers(input({ crowd: 50 })), "events")!;
    const busy = byId(buildLayers(input({ crowd: 1500 })), "events")!;
    expect(busy.radiusScale as number).toBeLessThan(quiet.radiusScale as number);
    expect(busy.radiusMinPixels).toBe(2.5);
  });

  it("pulses fresh events and rings the one in focus", () => {
    const layers = buildLayers(input({ fresh: [GLOBE.events[1]], focusId: GLOBE.events[0].id }));
    expect(layers.map((l) => l.id)).toEqual(expect.arrayContaining(["fresh", "focus"]));
  });

  it("glows behind forecasts that moved sharply", () => {
    const mover = { ...GLOBE.forecasts[0], change_24h: 0.12, thin: false };
    const layers = buildLayers(input({ forecasts: [mover] }));
    expect(layers.map((l) => l.id)).toContain("forecast-glow");
    const still = buildLayers(input({ forecasts: [{ ...mover, change_24h: 0.01 }] }));
    expect(still.map((l) => l.id)).not.toContain("forecast-glow");
  });
});
