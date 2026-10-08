import { describe, expect, it } from "vitest";

import type { GlobePalette, Rgba } from "@/lib/globe-color";

import {
  angularDistance,
  arcColor,
  arcPath,
  arcWidth,
  binEvents,
  countryFill,
  countryName,
  declutterLabels,
  distanceMeters,
  eventAsStory,
  eventRadius,
  filterArcs,
  hexFill,
  hexResolutionForZoom,
  homeZoom,
  isBigMover,
  labelPoint,
  labelShowsAt,
  leaningImpact,
  mainBounds,
  nextRow,
  ringStep,
  sortEventsForList,
  unwrapRing,
  visibleCap,
  zoomScale,
  type GlobeArc,
  type GlobeEvent,
  type LabelCandidate,
} from "./model";

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

function event(id: string, overrides: Partial<GlobeEvent> = {}): GlobeEvent {
  return {
    id: `story:${id}`,
    lon: 72.8,
    lat: 19.1,
    impact: "risk",
    importance: 50,
    magnitude: 3,
    sectors: ["energy"],
    first_seen: "2026-10-08T10:00:00Z",
    headline: `Headline ${id}`,
    country_id: "region:in",
    ...overrides,
  };
}

function arc(id: number, overrides: Partial<GlobeArc> = {}): GlobeArc {
  return {
    id,
    src_story: `story:a${id}`,
    dst_story: `story:b${id}`,
    src: [10, 50],
    dst: [72, 19],
    src_country: "region:de",
    dst_country: "region:in",
    link_type: "inferred",
    confidence: 0.6,
    impact: "risk",
    ...overrides,
  };
}

describe("impact leaning", () => {
  it("needs a clear balance to lean either way", () => {
    expect(leaningImpact(5, 1, 0)).toBe("risk");
    expect(leaningImpact(1, 5, 0)).toBe("opportunity");
    expect(leaningImpact(3, 3, 1)).toBe("neutral");
    expect(leaningImpact(0, 0, 0)).toBe("neutral");
  });
});

describe("hex heat", () => {
  it("uses finer hexes as you zoom in", () => {
    const resolutions = [0.5, 1.5, 2, 3.5, 5, 7].map(hexResolutionForZoom);
    expect(resolutions).toEqual([...resolutions].sort((a, b) => a - b));
    expect(resolutions[0]).toBe(1);
    expect(resolutions.at(-1)).toBe(5);
  });

  it("bins nearby events together and counts impacts", () => {
    const bins = binEvents(
      [
        event("a", { impact: "risk", importance: 80 }),
        event("b", { impact: "risk", lon: 72.81, lat: 19.11, importance: 40 }),
        event("c", { impact: "opportunity", lon: -74, lat: 40.7, importance: 30 }),
      ],
      2,
    );
    expect(bins).toHaveLength(2);
    const [mumbai, newYork] = bins; // heaviest first
    expect(mumbai.count).toBe(2);
    expect(mumbai.risk).toBe(2);
    expect(mumbai.impact).toBe("risk");
    expect(mumbai.weight).toBe(120);
    expect(mumbai.ids).toEqual(["story:a", "story:b"]);
    expect(mumbai.polygon.length).toBeGreaterThanOrEqual(6);
    expect(newYork.impact).toBe("opportunity");
  });

  it("skips events H3 can't place", () => {
    expect(binEvents([event("x", { lat: Number.NaN })], 2)).toEqual([]);
  });

  it("keeps hexes on the antimeridian in one piece", () => {
    const ring = unwrapRing([
      [179, 0],
      [-179, 1],
      [-179, -1],
    ]);
    expect(ring.map((p) => p[0])).toEqual([179, 181, 181]);
    const plain: [number, number][] = [
      [10, 0],
      [11, 1],
    ];
    expect(unwrapRing(plain)).toBe(plain);
  });

  it("makes busier hexes more opaque, in their impact colour", () => {
    const [bin] = binEvents([event("a", { importance: 100 })], 2);
    const strong = hexFill(bin, 100, palette);
    const faint = hexFill(bin, 10_000, palette);
    expect(strong.slice(0, 3)).toEqual(palette.risk.slice(0, 3));
    expect(strong[3]).toBeGreaterThan(faint[3]);
  });
});

describe("event marks", () => {
  it("sizes points by importance within 3–11 px", () => {
    expect(eventRadius(0)).toBe(3);
    expect(eventRadius(100)).toBe(11);
    expect(eventRadius(50)).toBeGreaterThan(3);
    expect(eventRadius(50)).toBeLessThan(11);
    expect(eventRadius(500)).toBe(11);
  });

  it("scales marks with zoom, within limits", () => {
    expect(zoomScale(0)).toBe(0.7);
    expect(zoomScale(1.8)).toBeCloseTo(0.85);
    expect(zoomScale(4)).toBeGreaterThan(zoomScale(2));
    expect(zoomScale(20)).toBe(1.5);
  });
});

describe("arcs", () => {
  it("keeps each cause → effect pair once, reported before inferred, most confident first", () => {
    const out = filterArcs([
      arc(1, { confidence: 0.6 }),
      arc(2, { confidence: 0.9 }),
      arc(3, { link_type: "reported", confidence: 0.5 }),
      arc(4, { src_story: "story:a1", dst_story: "story:b1", confidence: 0.55 }),
    ]);
    expect(out.map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it("drops weak and degenerate arcs, but never the one in focus", () => {
    const out = filterArcs(
      [arc(1, { confidence: 0.2 }), arc(2, { confidence: 0.3, dst_story: "story:focus" }), arc(3, { src: [72, 19] })],
      { focusId: "story:focus", minConfidence: 0.5 },
    );
    expect(out.map((a) => [a.id, a.focus])).toEqual([[2, true]]);
  });

  it("caps the count and can show only the arcs in focus", () => {
    const many = Array.from({ length: 30 }, (_, i) => arc(i + 1));
    expect(filterArcs(many, { max: 10 })).toHaveLength(10);
    const focusOnly = filterArcs([...many, arc(99, { src_story: "story:f" })], { focusId: "story:f", onlyFocus: true });
    expect(focusOnly.map((a) => a.id)).toEqual([99]);
  });

  it("draws a raised great-circle path that starts and ends on the ground", () => {
    const path = arcPath([10, 50], [72, 19], 20);
    expect(path).toHaveLength(21);
    expect(path[0]).toEqual([10, 50, 0]);
    expect(path[20][0]).toBeCloseTo(72);
    expect(path[20][1]).toBeCloseTo(19);
    expect(path[20][2]).toBeCloseTo(0);
    expect(path[10][2]).toBeGreaterThan(0);
    expect(path[10][2]).toBeLessThanOrEqual(650_000);
  });

  it("never jumps across the antimeridian", () => {
    const path = arcPath([170, 0], [-170, 0], 10);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(10);
  });

  it("is lighter for inferred links and strongest in focus", () => {
    const reported = arcColor(arc(1, { link_type: "reported" }), palette, false);
    const inferred = arcColor(arc(1), palette, false);
    const focused = arcColor({ ...arc(1), focus: true }, palette, true);
    const dimmed = arcColor(arc(1), palette, true);
    expect(reported[3]).toBeGreaterThan(inferred[3]);
    expect(focused[3]).toBeGreaterThan(reported[3]);
    expect(dimmed[3]).toBeLessThan(inferred[3]);
    expect(arcWidth({ ...arc(1), confidence: 1 })).toBeGreaterThan(arcWidth({ ...arc(1), confidence: 0.3 }));
  });

  it("measures distances on the sphere", () => {
    expect(distanceMeters([0, 0], [0, 1])).toBeCloseTo(111_195, -2);
    expect(angularDistance([0, 0], [90, 0])).toBeCloseTo(90);
  });
});

describe("forecast rings", () => {
  it("glows only for big moves in markets that aren't thin", () => {
    expect(isBigMover({ change_24h: 0.08, thin: false })).toBe(true);
    expect(isBigMover({ change_24h: -0.05, thin: false })).toBe(true);
    expect(isBigMover({ change_24h: 0.03, thin: false })).toBe(false);
    expect(isBigMover({ change_24h: 0.2, thin: true })).toBe(false);
    expect(isBigMover({ change_24h: null, thin: false })).toBe(false);
  });

  it("rounds probabilities to 5 % ring steps", () => {
    expect(ringStep(0)).toBe(0);
    expect(ringStep(0.62)).toBe(60);
    expect(ringStep(0.63)).toBe(65);
    expect(ringStep(1.4)).toBe(100);
  });
});

describe("country fills", () => {
  const country = (risk: number, opportunity: number, neutral = 0) => ({
    id: "region:in",
    count: risk + opportunity + neutral,
    risk,
    opportunity,
    neutral,
    score: (opportunity - risk) / Math.max(1, risk + opportunity + neutral),
  });

  it("leaves quiet countries as plain land", () => {
    expect(countryFill(undefined, 10, palette)).toEqual(palette.land);
  });

  it("tints towards the leaning impact, more where more happens", () => {
    const risky = countryFill(country(9, 1), 10, palette);
    const hopeful = countryFill(country(1, 9), 10, palette);
    expect(risky[0]).toBeGreaterThan(hopeful[0]); // amber has more red than teal
    expect(hopeful[2]).toBeGreaterThan(risky[2]);
    const busy = countryFill(country(10, 0), 10, palette);
    const quiet = countryFill(country(1, 0), 10, palette);
    expect(busy[0]).toBeGreaterThan(quiet[0]);
  });

  it("stays neutral when risk and opportunity balance", () => {
    const fill = countryFill(country(5, 5), 10, palette);
    expect(fill[0]).toBe(fill[1] + (palette.landActive[0] - palette.landActive[1]));
  });
});

describe("the list view", () => {
  it("sorts by importance, then newest, then id", () => {
    const sorted = sortEventsForList([
      event("b", { importance: 50, first_seen: "2026-10-08T09:00:00Z" }),
      event("a", { importance: 50, first_seen: "2026-10-08T09:00:00Z" }),
      event("c", { importance: 50, first_seen: "2026-10-08T11:00:00Z" }),
      event("d", { importance: 90 }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["story:d", "story:c", "story:a", "story:b"]);
  });

  it("moves through rows with the arrow keys and stays in range", () => {
    expect(nextRow("ArrowDown", 0, 5)).toBe(1);
    expect(nextRow("ArrowUp", 0, 5)).toBe(0);
    expect(nextRow("End", 1, 5)).toBe(4);
    expect(nextRow("Home", 3, 5)).toBe(0);
    expect(nextRow("PageDown", 2, 5)).toBe(4);
    expect(nextRow("a", 2, 5)).toBeNull();
    expect(nextRow("ArrowDown", 0, 0)).toBeNull();
  });

  it("names countries from their region ids", () => {
    expect(countryName("region:in")).toBe("India");
    expect(countryName("region:in-gj")).toBeNull();
    expect(countryName(null)).toBeNull();
  });

  it("turns an event into a story card without inventing analysis", () => {
    const story = eventAsStory(event("a"), { isSample: true });
    expect(story.so_what).toBeNull();
    expect(story.is_sample).toBe(true);
    expect(story.region).toEqual({ id: "region:in", name: "India", subtype: "country", country_id: "region:in" });
    expect(eventAsStory(event("b", { country_id: null }), { isSample: false }).region).toBeNull();
  });
});

describe("geometry", () => {
  const square = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  const multi = {
    type: "MultiPolygon",
    coordinates: [
      [[[50, 50], [51, 50], [51, 51], [50, 51], [50, 50]]],
      [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]],
    ],
  };

  it("frames the main polygon of a shape", () => {
    expect(mainBounds(square)).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(mainBounds(multi)).toEqual([
      [0, 0],
      [20, 20],
    ]);
    expect(mainBounds({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });

  it("puts labels at the centre of the main polygon", () => {
    expect(labelPoint(square)).toEqual([5, 5]);
    expect(labelPoint(multi)).toEqual([10, 10]);
  });

  it("knows how much of the globe the camera sees", () => {
    const wide = visibleCap(1, 0, 800);
    const close = visibleCap(4, 0, 800);
    expect(wide).toBeGreaterThan(close);
    expect(wide).toBeLessThan(90);
  });

  it("frames the globe to the free space", () => {
    expect(homeZoom(1000, 700)).toBeGreaterThan(homeZoom(390, 600));
    expect(homeZoom(10_000, 10_000)).toBe(2.4);
    expect(homeZoom(10, 10)).toBeGreaterThanOrEqual(0.2);
  });
});

describe("labels", () => {
  const label = (id: string, overrides: Partial<LabelCandidate> = {}): LabelCandidate => ({
    id,
    name: id,
    lon: 0,
    lat: 0,
    priority: 1000,
    kind: "country",
    ...overrides,
  });

  it("shows big countries first and cities only close in", () => {
    expect(labelShowsAt(label("big", { priority: 2000 }), 1.8)).toBe(true);
    expect(labelShowsAt(label("small", { priority: 5 }), 1.8)).toBe(false);
    expect(labelShowsAt(label("small", { priority: 5 }), 5)).toBe(true);
    expect(labelShowsAt(label("capital", { kind: "city", capital: true }), 3)).toBe(false);
    expect(labelShowsAt(label("capital", { kind: "city", capital: true }), 4)).toBe(true);
  });

  it("places labels without overlaps, highest priority first, on screen only", () => {
    const at: Record<string, { x: number; y: number } | null> = {
      a: { x: 100, y: 100 },
      b: { x: 105, y: 102 }, // collides with a
      c: { x: 300, y: 100 },
      d: null, // behind the globe
      e: { x: -50, y: 100 }, // off screen
    };
    const out = declutterLabels(
      [
        label("b", { priority: 500 }),
        label("a", { priority: 900 }),
        label("c", { priority: 400 }),
        label("d", { priority: 990 }),
        label("e", { priority: 980 }),
      ],
      (lon) => at[["a", "b", "c", "d", "e"][lon]],
      { width: 800, height: 600 },
      3,
    ).map((l) => l.id);
    expect(out).toEqual(["a", "c"]);
  });
});
