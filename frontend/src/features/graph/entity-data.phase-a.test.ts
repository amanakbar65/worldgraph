/** Entity pages in Phase A: key-fact chips from typed properties, links grouped by relation. */
import { describe, expect, it } from "vitest";

import type { ConnectionGroup } from "@/api/contract";

import { factsBeyondProperties, propertyChips, shapeConnections } from "./entity-data";
import { PORT, PORT_CONNECTIONS, PORT_PROPERTIES } from "./fixtures-phase-a";

describe("propertyChips (one per kind)", () => {
  const chips = propertyChips(PORT_PROPERTIES);
  const byKey = new Map(chips.map((c) => [c.key, c]));

  it("keeps the type's order", () => {
    expect(chips.map((c) => c.key)).toEqual(["kind", "capacity", "berths", "opened", "website", "operator", "place", "sector"]);
  });

  it("shows plain values in the api's words: choice, number, date, url", () => {
    expect(byKey.get("kind")).toMatchObject({ display: "Port", targets: null, opens: null });
    expect(byKey.get("capacity")).toMatchObject({ display: "19,300,000 TEU", targets: null });
    expect(byKey.get("opened")).toMatchObject({ display: "1979", derived: true, targets: null });
    expect(byKey.get("website")).toMatchObject({ display: "example.org", targets: null });
  });

  it("adds a number's unit when the wording doesn't have it", () => {
    expect(byKey.get("berths")?.display).toBe("67 berths");
    expect(propertyChips([{ ...PORT_PROPERTIES[2], display: "62", unit: "%" }])[0].display).toBe("62%");
  });

  it("makes entity values open their page and places open the map", () => {
    expect(byKey.get("operator")).toMatchObject({
      opens: "page",
      targets: [{ id: "org:dp-world", name: "DP World", type: "organization" }],
    });
    expect(byKey.get("place")).toMatchObject({ opens: "map", targets: [{ id: "region:ae" }] });
    expect(byKey.get("sector")?.targets?.map((t) => t.id)).toEqual(["sector:energy", "sector:logistics-trade"]);
  });

  it("skips empty values and copes with none", () => {
    expect(propertyChips([{ ...PORT_PROPERTIES[0], display: " " }])).toEqual([]);
    expect(propertyChips(undefined)).toEqual([]);
  });
});

describe("factsBeyondProperties", () => {
  it("keeps only the older facts the properties don't say", () => {
    expect(factsBeyondProperties(PORT.entity.facts, PORT.properties).map((f) => f.label)).toEqual(["Depth"]);
    expect(factsBeyondProperties(PORT.entity.facts, [])).toHaveLength(3);
    // The same value under another name ("Located in" next to "Place"), or a plural label, goes too.
    const facts = [
      { label: "Located in", value: "United Arab Emirates" },
      { label: "Kinds", value: "Container port" },
      { label: "Sectors", value: "Logistics and Trade" },
    ];
    expect(factsBeyondProperties(facts, PORT_PROPERTIES.slice(0, 7)).map((f) => f.label)).toEqual(["Sectors"]);
  });
});

describe("shapeConnections (labels both ways)", () => {
  it("reads each group from the entity's side, keeping the api's order and counts", () => {
    const groups = shapeConnections(PORT_CONNECTIONS);
    expect(groups.map((g) => [g.label, g.direction, g.count])).toEqual([
      ["In sector", "out", 2],
      ["Operated by", "in", 1],
      ["Located in", "out", 1],
      ["Needed by", "in", 20],
      ["Covered by", "in", 1],
    ]);
  });

  it("words a group the api left unlabelled from the relation: label going out, inverse coming in", () => {
    const bare = (relation: string, direction: ConnectionGroup["direction"]): ConnectionGroup => ({
      relation,
      label: "",
      direction,
      causal: relation === "drives",
      count: 1,
      items: [{ id: "org:x", name: "X", type: "organization", subtype: null, is_sample: false, confidence: null }],
    });
    const words = shapeConnections([
      bare("owns", "out"),
      bare("owns", "in"),
      bare("competes_with", "in"),
      bare("drives", "in"),
      bare("brand_new", "out"),
    ]).map((g) => g.label);
    expect(words).toEqual(["Owns", "Owned by", "Competes with", "Driven by", "Brand new"]);
  });

  it("leaves out what the page shows elsewhere, and groups with nothing left", () => {
    const groups = shapeConnections(PORT_CONNECTIONS, new Set(["forecast:opec-cut", "sector:energy"]));
    expect(groups.map((g) => g.relation)).toEqual(["in_sector", "operates", "located_in", "depends_on"]);
    expect(groups[0]).toMatchObject({ count: 1, items: [{ id: "sector:logistics-trade" }] });
  });

  it("knows how many links the api didn't send (at most 12 per group)", () => {
    const needed = shapeConnections(PORT_CONNECTIONS).find((g) => g.relation === "depends_on")!;
    expect(needed.items).toHaveLength(12);
    expect(needed.beyond).toBe(8);
  });
});
