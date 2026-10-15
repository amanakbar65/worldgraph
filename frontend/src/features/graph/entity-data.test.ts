import { describe, expect, it } from "vitest";

import type { Profile } from "@/api/contract";

import {
  countImpacts,
  groupBacklinks,
  indicatorSubject,
  kindLine,
  profileRoles,
  readable,
  readProfile,
  redirectFor,
  shapeFacts,
} from "./entity-data";
import { CRUDE, story, UAE_CPI } from "./fixtures";

describe("redirectFor", () => {
  it("hands stories, forecasts and places to their own panels", () => {
    expect(redirectFor("story:red-sea-attacks", null)).toEqual({ kind: "story", id: "story:red-sea-attacks" });
    expect(redirectFor("forecast:opec-cut", null)).toEqual({ kind: "forecast", id: "forecast:opec-cut" });
    expect(redirectFor("region:in", { kind: "story", id: "story:x" })).toEqual({ kind: "region", id: "region:in" });
    expect(redirectFor("commodity:crude-oil", null)).toBeNull();
    expect(redirectFor("org:adani-ports", null)).toBeNull();
  });

  it("shows a place's full page when its own panel asked for it", () => {
    expect(redirectFor("region:in", { kind: "region", id: "region:in" })).toBeNull();
    expect(redirectFor("region:in", { kind: "region", id: "region:us" })).toEqual({ kind: "region", id: "region:in" });
  });

  it("trusts the api's type over the id's prefix", () => {
    expect(redirectFor("odd:thing", null, "region")).toEqual({ kind: "region", id: "odd:thing" });
    expect(redirectFor("odd:thing", null, "commodity")).toBeNull();
  });
});

describe("shapeFacts", () => {
  it("drops the kind (the header says it) and links names to their nodes", () => {
    const facts = shapeFacts(CRUDE.entity.facts, CRUDE.graph, CRUDE.entity.id);
    expect(facts.map((f) => f.label)).toEqual(["HS code", "Produced in", "Sectors"]);
    expect(facts[0].links).toBeNull();
    expect(facts[1].links?.map((l) => l.id)).toEqual(["region:in", "region:sa"]);
    expect(facts[2].links).toEqual([{ id: "sector:energy", type: "sector", name: "Energy" }]);
  });

  it("keeps plain text when any name doesn't match a neighbour", () => {
    const facts = shapeFacts([{ label: "Produced in", value: "India, Brazil" }], CRUDE.graph, CRUDE.entity.id);
    expect(facts[0].links).toBeNull();
    expect(facts[0].value).toBe("India, Brazil");
  });
});

describe("kindLine and readable", () => {
  it("names the kind, with the subtype when there is one", () => {
    expect(kindLine("commodity", null)).toBe("Commodity");
    expect(kindLine("policy", "export-control")).toBe("Policy · Export control");
    expect(kindLine("organization", "company")).toBe("Organisation · Company");
    expect(kindLine("region", "country")).toBe("Place · Country");
    expect(readable("price_move")).toBe("Price move");
  });
});

describe("indicatorSubject", () => {
  it("finds what an indicator measures", () => {
    expect(indicatorSubject(UAE_CPI.entity, UAE_CPI.graph)).toEqual({
      id: "region:ae",
      type: "region",
      name: "United Arab Emirates",
    });
    expect(indicatorSubject(CRUDE.entity, CRUDE.graph)).toBeNull();
  });
});

describe("groupBacklinks", () => {
  it("groups by kind in the fixed order, leaving out what the page shows elsewhere", () => {
    const groups = groupBacklinks(CRUDE.backlinks, new Set(["forecast:opec-cut", "indicator:brent-crude"]));
    expect(groups.map((g) => g.type)).toEqual(["region", "organization"]);
    expect(groups[0]).toMatchObject({ title: "Places", relation: "produce it" });
    expect(groups[0].items.map((i) => i.id)).toEqual(["region:in", "region:sa"]);
  });

  it("names how each kind links here", () => {
    const groups = groupBacklinks(CRUDE.backlinks);
    expect(groups.find((g) => g.type === "forecast")?.relation).toBe("forecast about it");
    expect(groups.find((g) => g.type === "indicator")?.relation).toBe("measure it");
  });

  it("lists an item once even when it links in two ways", () => {
    const twice = [
      { id: "region:gj", type: "region" as const, name: "Gujarat", edge_type: "part_of" },
      { id: "region:gj", type: "region" as const, name: "Gujarat", edge_type: "member_of" },
    ];
    expect(groupBacklinks(twice)[0].items).toHaveLength(1);
  });
});

describe("countImpacts", () => {
  it("splits the latest stories by impact, drafts apart", () => {
    expect(countImpacts(CRUDE.timeline)).toEqual({ risk: 1, opportunity: 0, neutral: 0, drafts: 1 });
    expect(
      countImpacts([story({ id: "story:a", headline: "A", impact: "opportunity" }), story({ id: "story:b", headline: "B" })]),
    ).toMatchObject({ risk: 1, opportunity: 1 });
  });
});

describe("impact on you", () => {
  const profile: Profile = {
    name: "Acme Textiles",
    sectors: ["energy", "manufacturing"],
    locations: ["region:in-gj"],
    inputs: ["commodity:crude-oil", "commodity:cotton"],
    suppliers: ["region:cn"],
    markets: ["region:in-gj"],
    competitors: ["org:rival"],
    keywords: [],
  };

  it("reads a stored profile, or nothing when it doesn't parse", () => {
    expect(readProfile(profile)).toEqual(profile);
    expect(readProfile(null)).toBeNull();
    expect(readProfile({ name: 3 })).toBeNull();
  });

  it("says how an entity appears in the profile", () => {
    expect(profileRoles(profile, "commodity:crude-oil")).toEqual(["An input you buy"]);
    expect(profileRoles(profile, "region:in-gj")).toEqual(["Where you operate", "Where you sell"]);
    expect(profileRoles(profile, "org:rival")).toEqual(["A competitor you follow"]);
    expect(profileRoles(profile, "sector:energy")).toEqual(["Your sector"]);
    expect(profileRoles(profile, "commodity:rice")).toEqual([]);
    expect(profileRoles(null, "commodity:crude-oil")).toEqual([]);
  });
});
