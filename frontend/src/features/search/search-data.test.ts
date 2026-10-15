import { describe, expect, it } from "vitest";

import {
  MAX_RECENT,
  addRecent,
  contextLabel,
  groupResults,
  matchActions,
  panelFor,
  parseRecent,
  resultContext,
  type SearchResult,
} from "./search-data";

const r = (partial: Partial<SearchResult> & Pick<SearchResult, "id" | "type" | "name">): SearchResult => ({
  subtype: null,
  context: null,
  score: 0.5,
  ...partial,
});

const INDIA = r({ id: "region:in", type: "region", name: "India", context: "Country · Southern Asia", score: 1.15 });
const INDIANA = r({ id: "region:us-in", type: "region", name: "Indiana", context: "State · United States", score: 0.85 });
const INFLATION = r({
  id: "story:india-retail-inflation",
  type: "story",
  name: "India's retail inflation rises",
  context: "Story · India · risk",
  score: 0.9,
});
const POWER = r({
  id: "forecast:india-peak-power",
  type: "forecast",
  name: "India's peak power demand above 270 GW?",
  context: "Forecast · 46%",
  score: 0.85,
});
const RUPEE = r({ id: "indicator:inr-usd", type: "indicator", name: "Indian rupee per USD", score: 0.8 });
const BRENT = r({ id: "indicator:brent", type: "indicator", name: "Brent crude", context: "Indicator · Global", score: 1 });

describe("groupResults", () => {
  it("groups by type, best-matching group first, keeping the database's order inside", () => {
    const groups = groupResults([INFLATION, INDIA, POWER, RUPEE, INDIANA]);
    expect(groups.map((g) => g.label)).toEqual(["Places", "Stories", "Crowd forecasts", "Indicators"]);
    expect(groups[0].items.map((i) => i.id)).toEqual([INDIA.id, INDIANA.id]);
  });

  it("leads with indicators when an indicator is the best match", () => {
    expect(groupResults([INFLATION, BRENT])[0].type).toBe("indicator");
  });

  it("breaks ties by a fixed type order", () => {
    const groups = groupResults([
      r({ id: "story:a", type: "story", name: "A", score: 0.5 }),
      r({ id: "region:b", type: "region", name: "B", score: 0.5 }),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["region", "story"]);
  });

  it("gives nothing for no results", () => {
    expect(groupResults([])).toEqual([]);
  });
});

describe("result context", () => {
  it("drops the type a group already shows and pulls out a story's impact", () => {
    expect(resultContext(INFLATION)).toEqual({ text: "India", impact: "risk" });
    expect(contextLabel(INFLATION)).toBe("India · Risk");
  });

  it("keeps 'Projected' on projected stories", () => {
    expect(resultContext({ type: "story", context: "Projected · India · opportunity" })).toEqual({
      text: "Projected · India",
      impact: "opportunity",
    });
  });

  it("calls forecasts crowd forecasts", () => {
    expect(contextLabel(POWER)).toBe("46% crowd forecast");
    expect(contextLabel({ type: "forecast", context: null })).toBe("Crowd forecast");
  });

  it("shows other context as the database wrote it", () => {
    expect(contextLabel(INDIA)).toBe("Country · Southern Asia");
    expect(contextLabel(RUPEE)).toBeNull();
  });
});

describe("panelFor", () => {
  it("opens regions, stories and forecasts in their own panels and the rest as entities", () => {
    expect(panelFor(INDIA)).toEqual({ kind: "region", id: "region:in" });
    expect(panelFor(INFLATION)).toEqual({ kind: "story", id: INFLATION.id });
    expect(panelFor(POWER)).toEqual({ kind: "forecast", id: POWER.id });
    expect(panelFor(RUPEE)).toEqual({ kind: "entity", id: RUPEE.id });
  });
});

describe("recent searches", () => {
  it("puts the newest first, moves repeats up and keeps six", () => {
    let list = parseRecent([]);
    for (let i = 0; i < 8; i++) list = addRecent(list, r({ id: `region:r${i}`, type: "region", name: `R${i}` }));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].id).toBe("region:r7");
    list = addRecent(list, r({ id: "region:r4", type: "region", name: "R4" }));
    expect(list.map((x) => x.id).slice(0, 2)).toEqual(["region:r4", "region:r7"]);
    expect(list).toHaveLength(MAX_RECENT);
  });

  it("stores only the id, type, name and context", () => {
    expect(addRecent([], INDIA)).toEqual([
      { id: INDIA.id, type: "region", name: "India", context: "Country · Southern Asia" },
    ]);
  });

  it("drops anything malformed from storage", () => {
    expect(
      parseRecent([
        INDIA,
        { id: "javascript:alert(1)", type: "region", name: "Bad" },
        { id: "region:x", type: "spaceship", name: "Bad type" },
        { id: "region:y", type: "region", name: "   " },
        { id: "region:in", type: "region", name: "Duplicate" },
        "nonsense",
        null,
      ]),
    ).toEqual([{ id: INDIA.id, type: "region", name: "India", context: "Country · Southern Asia" }]);
    expect(parseRecent({ not: "a list" })).toEqual([]);
  });
});

describe("matchActions", () => {
  const actions = [
    { id: "ask", label: "Ask a question", keywords: ["why", "how"], pinned: true },
    { id: "forecasts", label: "Go to Forecasts", keywords: ["crowd"], pinned: true },
    { id: "graph", label: "Go to Graph", keywords: ["network"] },
    { id: "theme", label: "Switch to light theme", keywords: ["toggle", "dark", "mode"], pinned: true },
  ];

  it("shows pinned actions before anything is typed", () => {
    expect(matchActions(actions, "  ").map((a) => a.id)).toEqual(["ask", "forecasts", "theme"]);
  });

  it("matches every typed word in the label or keywords, in any order", () => {
    expect(matchActions(actions, "go").map((a) => a.id)).toEqual(["forecasts", "graph"]);
    expect(matchActions(actions, "dark toggle").map((a) => a.id)).toEqual(["theme"]);
    expect(matchActions(actions, "NETWORK").map((a) => a.id)).toEqual(["graph"]);
    expect(matchActions(actions, "zebra")).toEqual([]);
  });
});
