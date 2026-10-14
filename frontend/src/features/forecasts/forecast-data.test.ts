import { afterEach, describe, expect, it } from "vitest";

import type { ForecastResponse, Profile } from "@/api/contract";
import { snapshotKeyOf, snapshotManifest } from "@/lib/snapshot-plan";
import { formatDate } from "@/lib/time";

import { useForecastFilters } from "./filters-store";
import {
  CATEGORIES,
  DEFAULT_FILTERS,
  MAX_REGIONS,
  branchTitle,
  branchViews,
  changeWords,
  endInfo,
  forecastLabel,
  forecastsArgs,
  hasActiveFilters,
  isBinary,
  moneyKind,
  moneyNote,
  outcomeChances,
  pickMovers,
  questionAddsDetail,
  shapeList,
  sortDescription,
  sortForecasts,
  sparklineDomain,
  usableProfile,
  volumeParts,
  volumeText,
  type ForecastFilters,
} from "./forecast-data";
import { DUBLIN, ECB, FED, FED_BRANCHES, LIST, NOW, OPEC, RICE, daysAhead, detail, forecast } from "./fixtures";

const ids = (list: { id: string }[]) => list.map((f) => f.id);
const filters = (patch: Partial<ForecastFilters> = {}): ForecastFilters => ({ ...DEFAULT_FILTERS, ...patch });

const PROFILE: Profile = {
  name: "Spice exporter",
  sectors: ["agri-food"],
  locations: ["region:in-gj"],
  inputs: [],
  suppliers: [],
  markets: ["region:ae"],
  competitors: [],
  keywords: [],
};

describe("forecastsArgs", () => {
  it("sends exactly the first-frame shape when nothing is chosen", () => {
    expect(forecastsArgs({ filters: DEFAULT_FILTERS, sectors: [], sample: undefined })).toEqual({
      sectors: [],
      regions: [],
      categories: [],
      sort: "relevance",
      include_thin: false,
    });
  });

  it("matches a bundled snapshot entry with sample on or left to the database", () => {
    const manifest = snapshotManifest();
    for (const sample of [undefined, true]) {
      const args = forecastsArgs({ filters: DEFAULT_FILTERS, sectors: [], sample });
      expect(manifest[snapshotKeyOf("forecasts", args)]).toBe("forecasts.json");
    }
  });

  it("passes sample off when the viewer turned it off", () => {
    expect(forecastsArgs({ filters: DEFAULT_FILTERS, sectors: [], sample: false }).sample).toBe(false);
  });

  it("keeps sectors and categories in a fixed order and regions sorted and unique", () => {
    const args = forecastsArgs({
      filters: filters({
        categories: ["trade", "economy"],
        regions: [
          { id: "region:us", name: "United States" },
          { id: "region:in", name: "India" },
          { id: "region:us", name: "United States" },
        ],
        includeThin: true,
        sort: "moved",
      }),
      sectors: ["tech", "energy"],
      sample: true,
    });
    expect(args).toEqual({
      sectors: ["energy", "tech"],
      regions: ["region:in", "region:us"],
      categories: ["economy", "trade"],
      sort: "moved",
      include_thin: true,
      sample: true,
    });
  });

  it("sends the business profile only for the relevance sort", () => {
    expect(forecastsArgs({ filters: DEFAULT_FILTERS, sectors: [], sample: undefined, profile: PROFILE }).profile).toEqual(
      PROFILE,
    );
    for (const sort of ["moved", "ending", "volume"] as const) {
      expect(forecastsArgs({ filters: filters({ sort }), sectors: [], sample: undefined, profile: PROFILE })).not.toHaveProperty(
        "profile",
      );
    }
  });
});

describe("usableProfile", () => {
  it("uses a valid profile that says something", () => {
    expect(usableProfile(PROFILE)).toEqual(PROFILE);
  });

  it("ignores a missing, malformed or empty profile", () => {
    expect(usableProfile(null)).toBeNull();
    expect(usableProfile({ name: "x" })).toBeNull();
    expect(
      usableProfile({ ...PROFILE, sectors: [], locations: [], markets: [], keywords: [] }),
    ).toBeNull();
  });
});

describe("sortDescription", () => {
  it("says how the list is ordered, and when it is personal", () => {
    expect(sortDescription("relevance", false)).toBe("Big moves and busy markets first.");
    expect(sortDescription("relevance", true)).toBe("Most relevant to your business first.");
    expect(sortDescription("moved", true)).toBe("Biggest 24-hour moves first.");
    expect(sortDescription("ending", false)).toBe("Ending soonest first.");
    expect(sortDescription("volume", false)).toBe("Most volume first.");
  });
});

describe("hasActiveFilters", () => {
  it("counts categories, places and the sector lens, but not the sort or thin markets", () => {
    expect(hasActiveFilters(filters({ sort: "volume", includeThin: true }), [])).toBe(false);
    expect(hasActiveFilters(filters({ categories: ["energy"] }), [])).toBe(true);
    expect(hasActiveFilters(filters({ regions: [{ id: "region:in", name: "India" }] }), [])).toBe(true);
    expect(hasActiveFilters(DEFAULT_FILTERS, ["energy"])).toBe(true);
  });
});

describe("sortForecasts", () => {
  const noChange = forecast({ id: "forecast:no-change", short_title: "No change reported?", change_24h: null, volume: null, end_date: null });

  it("keeps the database's order for relevance", () => {
    expect(ids(sortForecasts([RICE, OPEC, FED], "relevance"))).toEqual(ids([RICE, OPEC, FED]));
  });

  it("puts the biggest moves first, either way, with unknown changes last", () => {
    expect(ids(sortForecasts([RICE, noChange, OPEC, DUBLIN, ECB], "moved"))).toEqual([
      DUBLIN.id, // −30
      OPEC.id, // +16
      ECB.id, // −14
      RICE.id, // −4
      noChange.id,
    ]);
  });

  it("puts the soonest end first, with open-ended forecasts last", () => {
    expect(ids(sortForecasts([DUBLIN, noChange, RICE, OPEC], "ending"))).toEqual([OPEC.id, RICE.id, DUBLIN.id, noChange.id]);
  });

  it("puts the most volume first, with unreported volume last", () => {
    expect(ids(sortForecasts([RICE, noChange, ECB, OPEC], "volume"))).toEqual([OPEC.id, ECB.id, RICE.id, noChange.id]);
  });

  it("breaks ties by volume, then id", () => {
    const a = forecast({ id: "forecast:a", short_title: "A?", change_24h: 0.05, volume: 10 });
    const b = forecast({ id: "forecast:b", short_title: "B?", change_24h: -0.05, volume: 20 });
    const c = forecast({ id: "forecast:c", short_title: "C?", change_24h: 0.05, volume: 20 });
    expect(ids(sortForecasts([a, c, b], "moved"))).toEqual(["forecast:b", "forecast:c", "forecast:a"]);
  });

  it("doesn't change the list it is given", () => {
    const list = [RICE, OPEC];
    sortForecasts(list, "volume");
    expect(ids(list)).toEqual([RICE.id, OPEC.id]);
  });
});

describe("shapeList", () => {
  it("hides thin markets unless they are included", () => {
    expect(ids(shapeList(LIST, DEFAULT_FILTERS))).not.toContain(DUBLIN.id);
    expect(ids(shapeList(LIST, filters({ includeThin: true })))).toContain(DUBLIN.id);
  });

  it("keeps only the chosen categories", () => {
    expect(ids(shapeList(LIST, filters({ categories: ["finance"] })))).toEqual([FED.id, ECB.id]);
    expect(ids(shapeList(LIST, filters({ categories: ["energy"], includeThin: true })))).toEqual([OPEC.id, DUBLIN.id]);
  });

  it("sorts what it keeps", () => {
    expect(ids(shapeList(LIST, filters({ sort: "moved" })))).toEqual([OPEC.id, ECB.id, FED.id, RICE.id]);
  });
});

describe("pickMovers", () => {
  it("takes the three biggest 24-hour moves among markets that aren't thin", () => {
    expect(ids(pickMovers(LIST))).toEqual([OPEC.id, ECB.id, FED.id]);
  });

  it("skips small or unknown moves", () => {
    const small = forecast({ id: "forecast:small", short_title: "Small?", change_24h: 0.02 });
    const unknown = forecast({ id: "forecast:unknown", short_title: "Unknown?", change_24h: null });
    expect(pickMovers([small, unknown, RICE])).toEqual([RICE]);
    expect(pickMovers([small, unknown])).toEqual([]);
  });
});

describe("sparklineDomain", () => {
  it("widens a flat series to at least 10 points around its middle", () => {
    const [lo, hi] = sparklineDomain([0.5, 0.51, 0.5]);
    expect(hi - lo).toBeCloseTo(0.1);
    expect((lo + hi) / 2).toBeCloseTo(0.505);
  });

  it("keeps a wide series as it is and stays inside 0..1", () => {
    expect(sparklineDomain([0.2, 0.8])).toEqual([0.2, 0.8]);
    const [lo, hi] = sparklineDomain([0.99, 1]);
    expect(hi).toBe(1);
    expect(lo).toBeCloseTo(0.9);
    expect(sparklineDomain([0, 0.01])[0]).toBe(0);
    expect(sparklineDomain([])).toEqual([0, 1]);
  });
});

describe("how figures read", () => {
  it("shows volume with its unit, or says it isn't reported", () => {
    expect(volumeParts(ECB, "en-US")).toEqual({ value: "48K", unit: "MANA" });
    expect(volumeText(ECB, "en-US")).toBe("48K MANA volume");
    expect(volumeText(OPEC, "en-US")).toBe("412K volume");
    expect(volumeText({ volume: null, volume_unit: "USD" })).toBe("Volume not reported");
  });

  it("puts the 24-hour change in words", () => {
    expect(changeWords(0.08)).toBe("up 8 points in 24 hours");
    expect(changeWords(-0.01)).toBe("down 1 point in 24 hours");
    expect(changeWords(0.001)).toBe("unchanged in 24 hours");
    expect(changeWords(null)).toBe("no 24-hour change reported");
  });

  it("knows play money from sample data and real-money markets", () => {
    expect(moneyKind(ECB)).toBe("play");
    expect(moneyKind(OPEC)).toBe("sample");
    expect(moneyKind({ provider: "polymarket", volume_unit: "USD", is_sample: false })).toBe("real");
    expect(moneyKind({ provider: "metaculus", volume_unit: null, is_sample: false })).toBe("none");
    expect(moneyKind({ provider: "newsite", volume_unit: "mana", is_sample: false })).toBe("play");
    expect(moneyKind({ provider: "newsite", volume_unit: null, is_sample: false })).toBe("unknown");
    expect(moneyNote(ECB)).toBe("Play money: Manifold forecasters use a virtual currency (MANA), not cash.");
    expect(moneyNote(OPEC)).toMatch(/^Sample data/);
  });

  it("never words a source as a place to bet or trade", () => {
    const notes = [ECB, OPEC, { ...ECB, provider: "polymarket" }, { ...ECB, provider: "metaculus" }, { ...ECB, provider: "x" }].map(
      moneyNote,
    );
    for (const note of notes) expect(note).not.toMatch(/\b(bet|betting|trade|trading|wager|buy|sell)\b/i);
  });

  it("labels categories in plain words, with no bare call to action", () => {
    expect(CATEGORIES.trade.label).toBe("Global trade");
    for (const { label } of Object.values(CATEGORIES)) expect(label).not.toMatch(/^(bet|trade|buy|sell)$/i);
  });
});

describe("endInfo", () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  it("counts down in minutes, hours and days", () => {
    expect(endInfo(at(20 * 60_000), NOW)).toMatchObject({ short: "in 20 min", words: "ends in 20 minutes", ended: false });
    expect(endInfo(at(5 * 3_600_000), NOW)).toMatchObject({ short: "in 5 h", words: "ends in 5 hours" });
    expect(endInfo(daysAhead(1), NOW)).toMatchObject({ short: "in 1 d", words: "ends in 1 day" });
    expect(endInfo(daysAhead(23), NOW)).toMatchObject({ short: "in 23 d" });
  });

  it("switches to months and years when the end is far off", () => {
    expect(endInfo(daysAhead(58), NOW)).toMatchObject({ short: "in 2 mo", words: "ends in 2 months" });
    expect(endInfo(daysAhead(365), NOW)).toMatchObject({ short: "in 12 mo" });
    expect(endInfo(daysAhead(800), NOW)).toMatchObject({ short: "in 2 y", words: "ends in 2 years" });
  });

  it("says when it ended, and gives the date itself", () => {
    const ended = endInfo(daysAhead(-2), NOW);
    expect(ended).toMatchObject({ short: "Ended", ended: true });
    expect(ended?.date).toBe(formatDate(daysAhead(-2), NOW));
    expect(endInfo(daysAhead(58), NOW)?.date).toBe(formatDate(daysAhead(58), NOW));
  });

  it("is null without a valid end date", () => {
    expect(endInfo(null, NOW)).toBeNull();
    expect(endInfo("not a date", NOW)).toBeNull();
  });
});

describe("forecastLabel", () => {
  it("says what, how likely, how it moved, volume, when it ends and from whom", () => {
    expect(forecastLabel(ECB, NOW)).toBe(
      "ECB cuts rates in December?. 35% crowd forecast, down 14 points in 24 hours. 48K MANA volume. ends in 2 months. source Manifold, play money",
    );
  });

  it("marks thin markets and sample data", () => {
    const label = forecastLabel(DUBLIN, NOW);
    expect(label).toContain("thin market");
    expect(label).toMatch(/sample data$/);
  });
});

describe("If YES / If NO", () => {
  it("shows both branches of a yes/no question, YES first, with their effects", () => {
    const branches = branchViews(detail(FED, {}, [...FED_BRANCHES].reverse()));
    expect(branches.map((b) => [b.outcome, b.probability, b.effects.length])).toEqual([
      ["YES", 0.63, 1],
      ["NO", 0.37, 1],
    ]);
  });

  it("fills a branch with no effects from the forecast's own number", () => {
    const branches = branchViews(detail(ECB, {}, []));
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({ outcome: "YES", probability: 0.35, effects: [] });
    expect(branches[1].outcome).toBe("NO");
    expect(branches[1].probability).toBeCloseTo(0.65);
  });

  it("reads outcomes in any case", () => {
    const lower: ForecastResponse["branches"] = [{ ...FED_BRANCHES[1], outcome: "no" }];
    const branches = branchViews(detail(FED, { outcomes: ["yes", "no"] }, lower));
    expect(branches[1].effects).toHaveLength(1);
    expect(branches[0].effects).toHaveLength(0);
  });

  it("has no branches for a question with other outcomes", () => {
    expect(isBinary(["Hold", "Cut", "Hike"])).toBe(false);
    expect(branchViews(detail(FED, { outcomes: ["Hold", "Cut", "Hike"] }))).toEqual([]);
    expect(isBinary([])).toBe(true);
  });

  it("titles a branch with its chance", () => {
    expect(branchTitle("YES", 0.312)).toBe("If YES · 31%");
    expect(branchTitle("no", 0.688)).toBe("If NO · 69%");
  });

  it("gives the two chances of a yes/no question", () => {
    expect(outcomeChances({ probability: 0.63, outcomes: ["YES", "NO"] }).map((c) => [c.outcome, c.probability])).toEqual([
      ["YES", 0.63],
      ["NO", 1 - 0.63],
    ]);
    expect(outcomeChances({ probability: 0.5, outcomes: ["A", "B", "C"] })).toEqual([]);
  });
});

describe("questionAddsDetail", () => {
  it("is false when the question only repeats the short title", () => {
    expect(questionAddsDetail("ECB cuts rates in December?", "ECB cuts rates in December")).toBe(false);
    expect(questionAddsDetail(ECB.short_title, ECB.question)).toBe(true);
  });
});

describe("the filter store", () => {
  afterEach(() => useForecastFilters.setState({ ...DEFAULT_FILTERS }));

  it("toggles categories and clears them", () => {
    const s = useForecastFilters.getState();
    s.toggleCategory("energy");
    s.toggleCategory("trade");
    expect(useForecastFilters.getState().categories).toEqual(["energy", "trade"]);
    s.toggleCategory("energy");
    expect(useForecastFilters.getState().categories).toEqual(["trade"]);
    s.clearCategories();
    expect(useForecastFilters.getState().categories).toEqual([]);
  });

  it("adds each place once and keeps the latest few", () => {
    const s = useForecastFilters.getState();
    s.addRegion({ id: "region:in", name: "India" });
    s.addRegion({ id: "region:in", name: "India" });
    expect(useForecastFilters.getState().regions).toHaveLength(1);
    for (const id of ["region:us", "region:cn", "region:br"]) s.addRegion({ id, name: id });
    expect(useForecastFilters.getState().regions.map((r) => r.id)).toEqual(["region:us", "region:cn", "region:br"]);
    expect(useForecastFilters.getState().regions).toHaveLength(MAX_REGIONS);
    s.removeRegion("region:cn");
    expect(useForecastFilters.getState().regions.map((r) => r.id)).toEqual(["region:us", "region:br"]);
  });

  it("clears filters but keeps the sort and the thin-market choice", () => {
    const s = useForecastFilters.getState();
    s.setSort("ending");
    s.setIncludeThin(true);
    s.toggleCategory("energy");
    s.addRegion({ id: "region:in", name: "India" });
    s.clearFilters();
    expect(useForecastFilters.getState()).toMatchObject({ categories: [], regions: [], sort: "ending", includeThin: true });
  });
});
