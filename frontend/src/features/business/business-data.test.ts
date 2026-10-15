import { describe, expect, it } from "vitest";

import { emptyProfile } from "@/state/profile";

import {
  NO_FILTER,
  buildHopChain,
  exposure,
  feedCounts,
  filterFeed,
  hopCount,
  isDirect,
  keywordHits,
  matchedNodes,
  quietCount,
  stepFilled,
  typeOfId,
  volumeText,
  watchActivity,
  watchKind,
  whySentence,
} from "./business-data";
import { AFFECTS, CASCADE, DRAFT, FREIGHT, NOW, PROFILE, RED_SEA, RUPEE, hoursAgo, story } from "./fixtures";

const [redSea, freight] = AFFECTS.items;

describe("the feed's filters", () => {
  it("tells direct matches from knock-on effects", () => {
    expect(isDirect(redSea)).toBe(true);
    expect(isDirect(freight)).toBe(false);
    expect(hopCount(redSea)).toBe(0);
    expect(hopCount(freight)).toBe(1);
  });

  it("counts each filter; drafts have no impact yet", () => {
    expect(feedCounts(AFFECTS.items)).toEqual({ all: 4, risk: 2, opportunity: 1, direct: 3, downstream: 1 });
  });

  it("filters by impact, route and profile node", () => {
    const ids = (f: typeof NO_FILTER) => filterFeed(AFFECTS.items, f).map((i) => i.story.id);
    expect(ids(NO_FILTER)).toHaveLength(4);
    expect(ids({ ...NO_FILTER, impact: "risk" })).toEqual([RED_SEA.id, FREIGHT.id]);
    expect(ids({ ...NO_FILTER, impact: "opportunity" })).toEqual([RUPEE.id]);
    expect(ids({ ...NO_FILTER, path: "downstream" })).toEqual([FREIGHT.id]);
    expect(ids({ ...NO_FILTER, path: "direct", node: "infra:bab-el-mandeb" })).toEqual([RED_SEA.id]);
    expect(ids({ ...NO_FILTER, node: "region:in-gj" })).toEqual([DRAFT.id]);
  });
});

describe("why it matched", () => {
  it("lists the profile nodes, most specific first, with their roles", () => {
    expect(matchedNodes(redSea.matched, PROFILE).map((m) => [m.entity.id, m.roles])).toEqual([
      ["infra:bab-el-mandeb", ["inputs"]],
      ["sector:logistics-trade", ["sectors"]],
    ]);
    // A node no longer in the profile still shows, last.
    expect(matchedNodes(redSea.matched, emptyProfile).map((m) => m.roles)).toEqual([[], []]);
  });

  it("finds the profile's keywords in the headline or so-what", () => {
    expect(keywordHits(RED_SEA, PROFILE)).toEqual(["freight"]);
    expect(keywordHits(RUPEE, PROFILE)).toEqual([]);
  });

  it("says why in one sentence, including the route", () => {
    expect(whySentence(redSea, PROFILE)).toBe(
      "Touches Bab-el-Mandeb Strait (your input), Logistics and trade (your sector) and the keyword “freight”.",
    );
    expect(whySentence(freight, PROFILE)).toBe(
      "One step downstream of news that touches Bab-el-Mandeb Strait (your input) and the keyword “freight”.",
    );
    expect(whySentence({ ...freight, matched: [], path: ["a:x", "b:y", "c:z"] }, emptyProfile)).toBe(
      "2 steps downstream of news that touches your profile.",
    );
  });
});

describe("where it reaches you", () => {
  it("counts stories per profile node by impact, busiest first", () => {
    const rows = exposure(AFFECTS.items, PROFILE);
    expect(rows.map((r) => [r.entity.id, r.risk, r.opportunity, r.other, r.total])).toEqual([
      ["infra:bab-el-mandeb", 2, 0, 0, 2],
      ["region:in-gj", 0, 0, 1, 1],
      ["sector:logistics-trade", 1, 0, 0, 1],
      ["sector:manufacturing", 0, 1, 0, 1],
    ]);
  });

  it("counts the parts of the profile the news doesn't reach", () => {
    const rows = exposure(AFFECTS.items, PROFILE);
    // China, the US and crude oil: nothing in the feed reaches them yet.
    expect(quietCount(rows, PROFILE)).toBe(3);
    expect(quietCount([], emptyProfile)).toBe(0);
  });
});

describe("the hop chain", () => {
  it("joins each step to the causal link that led to it", () => {
    const steps = buildHopChain(freight.path, CASCADE);
    expect(steps.map((s) => [s.id, s.story?.headline ?? null, s.link?.mechanism ?? null])).toEqual([
      [RED_SEA.id, RED_SEA.headline, null],
      [FREIGHT.id, FREIGHT.headline, "longer shipping routes"],
    ]);
    expect(steps[1].link?.link_type).toBe("inferred");
  });

  it("still lists the steps before the cascade arrives", () => {
    expect(buildHopChain(freight.path, undefined).map((s) => [s.id, s.story, s.link])).toEqual([
      [RED_SEA.id, null, null],
      [FREIGHT.id, null, null],
    ]);
  });
});

describe("the watchlist", () => {
  it("knows what kind of thing an id is", () => {
    expect(watchKind("forecast:fed")).toBe("forecast");
    expect(watchKind("region:in")).toBe("region");
    expect(watchKind("commodity:cotton")).toBe("entity");
    expect(typeOfId("infra:suez")).toBe("infrastructure");
    expect(typeOfId("org:maersk")).toBe("organization");
    expect(typeOfId("mystery:x")).toBeNull();
  });

  it("counts recent stories and those since the last visit", () => {
    const timeline = [DRAFT, RUPEE, story({ id: "story:old", headline: "Old", first_seen: hoursAgo(24 * 9) })];
    expect(watchActivity(timeline, "7d", hoursAgo(10), NOW)).toEqual({
      inWindow: 2,
      capped: false,
      fresh: 1,
      latest: DRAFT,
    });
    expect(watchActivity(timeline, "24h", null, NOW).fresh).toBe(0);
    const full = Array.from({ length: 20 }, (_, i) => story({ id: `story:n${i}`, headline: "n", first_seen: hoursAgo(i) }));
    expect(watchActivity(full, "7d", null, NOW).capped).toBe(true);
  });
});

describe("small helpers", () => {
  it("writes volume with its unit", () => {
    expect(volumeText({ volume: 52_000, volume_unit: "MANA" })).toBe("52K MANA volume");
    expect(volumeText({ volume: 1200, volume_unit: null })).toBe("1.2K volume");
    expect(volumeText({ volume: null, volume_unit: "USD" })).toBe("Volume not reported");
  });

  it("knows which setup steps have choices", () => {
    expect([0, 1, 2].map((s) => stepFilled(PROFILE, s))).toEqual([true, true, true]);
    expect([0, 1, 2].map((s) => stepFilled(emptyProfile, s))).toEqual([false, false, false]);
    expect(stepFilled({ ...emptyProfile, keywords: ["freight"] }, 2)).toBe(true);
  });
});
