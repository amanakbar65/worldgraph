import { describe, expect, it } from "vitest";

import { SECTOR_IDS } from "@/api/contract";

import { INDIA, GUJARAT, REGION_AHMEDABAD, REGION_INDIA, pulse } from "./fixtures";
import {
  buildBreadcrumb,
  busiestSectors,
  childrenTitle,
  describeCounts,
  impactShares,
  kpiScopeRegion,
  levelLabel,
  pulseLevel,
  shapeSectorPulse,
  shortLevelLabel,
  showsSample,
  sortChildren,
  windowWords,
} from "./region-data";

describe("buildBreadcrumb", () => {
  it("runs from the country down to the region itself", () => {
    const crumbs = buildBreadcrumb(REGION_AHMEDABAD.region);
    expect(crumbs.map((c) => c.name)).toEqual(["India", "Gujarat", "Ahmedabad"]);
    expect(crumbs.map((c) => c.current)).toEqual([false, false, true]);
    expect(crumbs[0]).toMatchObject({ id: "region:in", subtype: "country" });
  });

  it("is just the region for a country or bloc", () => {
    expect(buildBreadcrumb(REGION_INDIA.region)).toEqual([
      { id: "region:in", name: "India", subtype: "country", current: true },
    ]);
  });

  it("drops repeats and a stray copy of the region", () => {
    const crumbs = buildBreadcrumb({
      id: "region:in-gj",
      name: "Gujarat",
      subtype: "state",
      breadcrumb: [INDIA, INDIA, GUJARAT],
    });
    expect(crumbs.map((c) => c.id)).toEqual(["region:in", "region:in-gj"]);
    expect(crumbs.filter((c) => c.current)).toHaveLength(1);
  });
});

describe("levels", () => {
  it("names each level in plain words", () => {
    expect(levelLabel("country")).toBe("Country");
    expect(levelLabel("state")).toBe("State or province");
    expect(levelLabel("city")).toBe("City");
    expect(levelLabel("bloc")).toBe("Bloc");
    expect(levelLabel("something-else")).toBe("Region");
    expect(levelLabel(null)).toBe("Region");
    expect(shortLevelLabel("state")).toBe("State");
    expect(shortLevelLabel("country")).toBe("Country");
  });

  it("names the places inside a region", () => {
    expect(childrenTitle("country")).toBe("States and provinces");
    expect(childrenTitle("state")).toBe("Cities");
    expect(childrenTitle("bloc")).toBe("Member countries");
    expect(childrenTitle("region", ["city", "city"])).toBe("Cities");
    expect(childrenTitle("region", ["state", "city"])).toBe("Places within");
  });
});

describe("kpiScopeRegion", () => {
  it("is null when the KPIs are the region's own", () => {
    expect(kpiScopeRegion(REGION_INDIA)).toBeNull();
  });

  it("names the country when a city shows national figures", () => {
    expect(kpiScopeRegion(REGION_AHMEDABAD)).toEqual(INDIA);
  });

  it("still flags an unknown scope, without a name", () => {
    expect(kpiScopeRegion({ ...REGION_AHMEDABAD, kpi_scope: "region:xx" })).toEqual({ id: "region:xx", name: null });
  });

  it("is null when there are no KPIs at all", () => {
    expect(kpiScopeRegion({ ...REGION_AHMEDABAD, kpis: [], kpi_scope: null })).toBeNull();
  });
});

describe("shapeSectorPulse", () => {
  it("always gives nine tiles in the contract's order, filling gaps", () => {
    const tiles = shapeSectorPulse(
      [
        { sector: "tech", impact: "opportunity", direction: "up", count: 2, score: 0.8 },
        { sector: "energy", impact: "risk", direction: "down", count: 4, score: -0.6 },
      ],
      "7d",
    );
    expect(tiles.map((t) => t.sector)).toEqual([...SECTOR_IDS]);
    expect(tiles[0]).toMatchObject({ sector: "energy", impact: "risk", count: 4, direction: "down", strength: 0.6, level: "strong" });
    expect(tiles.find((t) => t.sector === "health")).toMatchObject({ impact: "neutral", count: 0, direction: null, score: 0 });
  });

  it("never colours a sector with no stories", () => {
    const [energy] = shapeSectorPulse(pulse({ energy: { impact: "risk", count: 0, score: -1, direction: "down" } }), "24h");
    expect(energy.impact).toBe("neutral");
    expect(energy.score).toBe(0);
    expect(energy.direction).toBe("down");
    expect(energy.description).toBe("Energy: no stories in the last 24 hours, down from the previous 24 hours.");
  });

  it("weights by how one-sided the sector is", () => {
    expect(pulseLevel(0.53)).toBe("strong");
    expect(pulseLevel(0.2)).toBe("mild");
    expect(pulseLevel(0.01)).toBe("weak");
    const tiles = shapeSectorPulse(REGION_INDIA.sector_pulse, "7d");
    const finance = tiles.find((t) => t.sector === "finance")!;
    expect(finance.level).toBe("weak");
    expect(finance.description).toBe("Finance: 2 stories, leaning risk, fewer than the previous 7 days.");
    const energy = tiles.find((t) => t.sector === "energy")!;
    expect(energy.description).toBe("Energy: 7 stories, mostly opportunity, more than the previous 7 days.");
  });

  it("clamps scores and ignores repeated sectors", () => {
    const tiles = shapeSectorPulse(
      [
        { sector: "energy", impact: "opportunity", direction: null, count: 1, score: 3 },
        { sector: "energy", impact: "risk", direction: null, count: 9, score: -1 },
      ],
      "30d",
    );
    expect(tiles[0]).toMatchObject({ impact: "opportunity", count: 1, score: 1, strength: 1 });
    expect(tiles[0].description).toBe("Energy: 1 story, mostly opportunity.");
  });

  it("lists the busiest sectors first", () => {
    const tiles = shapeSectorPulse(REGION_INDIA.sector_pulse, "7d");
    expect(busiestSectors(tiles, 2).map((t) => t.sector)).toEqual(["energy", "agri-food"]);
  });
});

describe("counts", () => {
  it("describes story counts by impact", () => {
    expect(describeCounts({ risk: 2, opportunity: 3, neutral: 0 })).toBe("3 opportunity, 2 risk");
    expect(describeCounts({ risk: 0, opportunity: 0, neutral: 0 })).toBe("No stories");
  });

  it("splits a bar in a fixed, calm order", () => {
    expect(impactShares({ risk: 1, opportunity: 3, neutral: 0 })).toEqual([
      { impact: "opportunity", count: 3, share: 0.75 },
      { impact: "risk", count: 1, share: 0.25 },
    ]);
    expect(impactShares({ risk: 0, opportunity: 0, neutral: 0 })).toEqual([]);
  });

  it("keeps children busiest first, stable on ties", () => {
    const sorted = sortChildren([
      { ...REGION_INDIA.children[2], id: "a", count: 0 },
      { ...REGION_INDIA.children[0], id: "b", count: 5 },
      { ...REGION_INDIA.children[3], id: "c", count: 0 },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

describe("misc", () => {
  it("words the window", () => {
    expect(windowWords("7d")).toBe("7 days");
    expect(windowWords("24h", true)).toBe("last 24 hours");
  });

  it("spots sample data anywhere in the panel", () => {
    expect(showsSample(REGION_INDIA)).toBe(true);
    expect(
      showsSample({
        kpis: [],
        stories: REGION_INDIA.stories.map((s) => ({ ...s, is_sample: false })),
        decisions: [],
        graph: { nodes: [], links: [] },
      }),
    ).toBe(false);
  });
});
