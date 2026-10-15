import { describe, expect, it } from "vitest";

import { SECTOR_IDS, type SectorId } from "@/api/contract";

import {
  DOT_MAX,
  DOT_MIN,
  R_INNER,
  R_OUTER,
  dotSizeFor,
  labelArc,
  labelArcLength,
  labelOnTop,
  layoutRadar,
  overlaps,
  polar,
  radiusFor,
  toPolar,
  wedgeAt,
  wedgePath,
  wedgesFor,
  type RadarInput,
} from "./radar";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/** A deterministic spread of scores, like a busy week. */
function many(n: number, sectors: readonly SectorId[] = SECTOR_IDS): RadarInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `story:s${i}`,
    sector: sectors[(i * 7) % sectors.length],
    relevance: ((i * 37) % 100) / 100,
    momentum: ((i * 53 + 11) % 100) / 100,
  }));
}

describe("polar coordinates", () => {
  it("starts at the top and runs clockwise (SVG y points down)", () => {
    const top = polar(0, 1);
    const right = polar(Math.PI / 2, 1);
    const bottom = polar(Math.PI, 1);
    expect(close(top.x, 0) && close(top.y, -1)).toBe(true);
    expect(close(right.x, 1) && close(right.y, 0)).toBe(true);
    expect(close(bottom.x, 0) && close(bottom.y, 1)).toBe(true);
  });

  it("round-trips through toPolar", () => {
    for (const angle of [0, 0.3, 1.9, 3.5, 6.1]) {
      const back = toPolar(polar(angle, 0.7));
      expect(back.radius).toBeCloseTo(0.7, 9);
      expect(back.angle).toBeCloseTo(angle, 9);
    }
  });
});

describe("scores to distance and size", () => {
  it("puts strong scores near the centre and weak ones on the rim", () => {
    expect(radiusFor(1)).toBe(R_INNER);
    expect(radiusFor(0)).toBe(R_OUTER);
    expect(radiusFor(0.8)).toBeLessThan(radiusFor(0.3));
  });

  it("clamps scores outside 0..1 and ignores NaN", () => {
    expect(radiusFor(1.5)).toBe(R_INNER);
    expect(radiusFor(-2)).toBe(R_OUTER);
    expect(radiusFor(Number.NaN)).toBe(R_OUTER);
    expect(dotSizeFor(0)).toBe(DOT_MIN);
    expect(dotSizeFor(1)).toBe(DOT_MAX);
    expect(dotSizeFor(0.5)).toBeGreaterThan(DOT_MIN);
  });
});

describe("wedges", () => {
  it("splits the circle into equal wedges with no gaps, the first centred on the top", () => {
    const wedges = wedgesFor(SECTOR_IDS);
    expect(wedges).toHaveLength(9);
    expect(wedges[0].mid).toBe(0);
    expect(wedges[0].start).toBeLessThan(0);
    for (let i = 1; i < wedges.length; i++) expect(wedges[i].start).toBeCloseTo(wedges[i - 1].end, 12);
    expect(wedges[8].end - wedges[0].start).toBeCloseTo(Math.PI * 2, 12);
  });

  it("puts two sectors top and bottom, and one sector all round", () => {
    const two = wedgesFor(["energy", "finance"]);
    expect(two.map((w) => w.mid)).toEqual([0, Math.PI]);
    const one = wedgesFor(["tech"]);
    expect(one[0].end - one[0].start).toBeCloseTo(Math.PI * 2, 12);
    expect(wedgesFor([])).toEqual([]);
  });

  it("finds the wedge for any angle, including just left of the top", () => {
    const wedges = wedgesFor(SECTOR_IDS);
    expect(wedgeAt(0, wedges)?.sector).toBe("energy");
    expect(wedgeAt(Math.PI * 2 - 0.05, wedges)?.sector).toBe("energy");
    expect(wedgeAt(wedges[4].mid, wedges)?.sector).toBe(SECTOR_IDS[4]);
  });

  it("draws slices and a full ring as closed paths", () => {
    const [w] = wedgesFor(SECTOR_IDS);
    expect(wedgePath(w, 0.2, 1)).toMatch(/^M .* A .* L .* A .* Z$/);
    const [ring] = wedgesFor(["tech"]);
    expect(wedgePath(ring, 0.2, 1).match(/A /g)).toHaveLength(4);
  });

  it("writes names clockwise over the top and anticlockwise under the bottom", () => {
    const wedges = wedgesFor(SECTOR_IDS);
    expect(labelOnTop(wedges[0].mid)).toBe(true);
    expect(labelOnTop(wedges[4].mid)).toBe(false);
    // Sweep flag 1 = clockwise, 0 = anticlockwise.
    expect(labelArc(wedges[0], 1.05)).toMatch(/ 0 0 1 /);
    expect(labelArc(wedges[4], 1.05)).toMatch(/ 0 0 0 /);
    // The arc is a little shorter than the wedge; a lone wedge's name stays a short arc.
    expect(labelArcLength(wedges[0], 1)).toBeLessThan(wedges[0].end - wedges[0].start);
    expect(labelArcLength(wedgesFor(["tech"])[0], 1)).toBeLessThan(Math.PI);
  });
});

describe("layoutRadar", () => {
  it("keeps the list order and one dot per input", () => {
    const input = many(12);
    const dots = layoutRadar(input, SECTOR_IDS, "relevance");
    expect(dots.map((d) => d.id)).toEqual(input.map((i) => i.id));
    expect(dots.map((d) => d.order)).toEqual(input.map((_, i) => i));
  });

  it("puts each dot inside its own wedge", () => {
    const wedges = wedgesFor(SECTOR_IDS);
    for (const dot of layoutRadar(many(40), SECTOR_IDS, "relevance")) {
      const { angle } = toPolar(dot);
      expect(wedgeAt(angle, wedges)?.sector).toBe(dot.sector);
    }
  });

  it("keeps the distance close to what the score asks for", () => {
    for (const dot of layoutRadar(many(40), SECTOR_IDS, "relevance")) {
      const { radius } = toPolar(dot);
      expect(Math.abs(radius - radiusFor(dot.distanceScore))).toBeLessThanOrEqual(0.07 + 1e-6);
    }
  });

  it("nudges dots apart so none overlap, even in a busy week", () => {
    const dots = layoutRadar(many(40), SECTOR_IDS, "relevance");
    expect(overlaps(dots, 0.002)).toEqual([]);
  });

  it("separates dots with identical scores in the same wedge", () => {
    const same = Array.from({ length: 6 }, (_, i) => ({
      id: `story:same-${i}`,
      sector: "energy" as const,
      relevance: 0.6,
      momentum: 0.6,
    }));
    expect(overlaps(layoutRadar(same, SECTOR_IDS, "relevance"), 0.002)).toEqual([]);
  });

  it("swaps the scores when distance shows momentum", () => {
    const [item] = many(1);
    const [byFit] = layoutRadar([item], SECTOR_IDS, "relevance");
    const [byPace] = layoutRadar([item], SECTOR_IDS, "momentum");
    expect(byFit.distanceScore).toBe(item.relevance);
    expect(byFit.sizeScore).toBe(item.momentum);
    expect(byPace.distanceScore).toBe(item.momentum);
    expect(byPace.r).toBeCloseTo(dotSizeFor(item.relevance), 12);
  });

  it("grows dots on small charts", () => {
    const [item] = many(1);
    const [plain] = layoutRadar([item], SECTOR_IDS, "relevance");
    const [big] = layoutRadar([item], SECTOR_IDS, "relevance", 1.4);
    expect(big.r).toBeCloseTo(plain.r * 1.4, 12);
  });

  it("skips stories whose sector isn't on the radar", () => {
    const dots = layoutRadar(many(9), ["energy"], "relevance");
    expect(dots.every((d) => d.sector === "energy")).toBe(true);
    expect(dots.length).toBe(many(9).filter((i) => i.sector === "energy").length);
  });

  it("gives the same picture every time", () => {
    const input = many(30);
    expect(layoutRadar(input, SECTOR_IDS, "momentum")).toEqual(layoutRadar(input, SECTOR_IDS, "momentum"));
  });

  it("uses the whole circle when the lens shows one sector", () => {
    const one = many(10, ["tech"]);
    const dots = layoutRadar(one, ["tech"], "relevance");
    expect(dots).toHaveLength(10);
    expect(overlaps(dots, 0.002)).toEqual([]);
  });
});
