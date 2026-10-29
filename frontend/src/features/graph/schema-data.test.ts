import { describe, expect, it } from "vitest";

import type { SchemaResponse } from "@/api/contract";

import { bubbleRadius, describeEdge, edgeGeometry, layoutSchema, shapeSchema } from "./schema-data";

type TypeRow = SchemaResponse["types"][number];
type RelationRow = SchemaResponse["relations"][number];

const type = (key: TypeRow["key"], count: number, plural: string): TypeRow => ({
  key,
  label: plural.replace(/s$/, ""),
  plural,
  icon: "circle",
  tone: `type-${key}`,
  description: "",
  count,
  properties: [],
});

const relation = (key: string, label: string, inverse: string, pairs: RelationRow["by_pair"], extra: Partial<RelationRow> = {}): RelationRow => ({
  key,
  label,
  inverse_label: inverse,
  icon: "link",
  causal: false,
  symmetric: false,
  src_types: [],
  dst_types: [],
  description: "",
  count: pairs.reduce((n, p) => n + p.count, 0),
  by_pair: pairs,
  ...extra,
});

/** Like the sample data: stories mention everything, places hold everything. */
const SCHEMA: SchemaResponse = {
  types: [
    type("region", 5317, "Places"),
    type("organization", 110, "Organisations"),
    type("person", 0, "People"),
    type("commodity", 29, "Commodities"),
    type("story", 230, "Stories"),
    type("user_entity", 0, "Your business"),
  ],
  relations: [
    relation("located_in", "Located in", "Home to", [{ src_type: "organization", dst_type: "region", count: 110 }]),
    relation("part_of", "Part of", "Includes", [{ src_type: "region", dst_type: "region", count: 5079 }]),
    relation("member_of", "Member of", "Has member", [
      { src_type: "region", dst_type: "region", count: 27 },
      { src_type: "region", dst_type: "organization", count: 12 },
    ]),
    relation("mentions", "Mentions", "In the news", [
      { src_type: "story", dst_type: "region", count: 707 },
      { src_type: "story", dst_type: "commodity", count: 188 },
      { src_type: "story", dst_type: "organization", count: 60 },
    ]),
    relation("drives", "Drives", "Driven by", [{ src_type: "story", dst_type: "story", count: 236 }], { causal: true }),
    relation("regulates", "Regulates", "Regulated by", []),
  ],
};

describe("shapeSchema", () => {
  const shape = shapeSchema(SCHEMA);

  it("keeps kinds that have things or links, never the viewer's own business", () => {
    expect(shape.bubbles.map((b) => b.key)).toEqual(["region", "organization", "commodity", "story"]);
  });

  it("sizes bubbles by count on a log scale", () => {
    const r = new Map(shape.bubbles.map((b) => [b.key, b.r]));
    expect(r.get("region")!).toBeGreaterThan(r.get("story")!);
    expect(r.get("story")!).toBeGreaterThan(r.get("commodity")!);
    expect(bubbleRadius(5317, 5317)).toBe(40);
    expect(bubbleRadius(0, 5317)).toBe(16);
    // 30 commodities stay readable next to 5,000 places.
    expect(bubbleRadius(29, 5317)).toBeGreaterThan(25);
  });

  it("makes one edge per relation and pair of kinds, biggest first, with loops marked", () => {
    expect(shape.edges.map((e) => [e.relation, e.src, e.dst, e.count, e.loop])).toEqual([
      ["part_of", "region", "region", 5079, true],
      ["mentions", "story", "region", 707, false],
      ["drives", "story", "story", 236, true],
      ["mentions", "story", "commodity", 188, false],
      ["located_in", "organization", "region", 110, false],
      ["mentions", "story", "organization", 60, false],
      ["member_of", "region", "region", 27, true],
      ["member_of", "region", "organization", 12, false],
    ]);
  });

  it("gives edges between the same two kinds their own lanes, so they curve apart", () => {
    const lanes = (id: string) => shape.edges.find((e) => e.id === id)!;
    expect(lanes("located_in:organization>region")).toMatchObject({ lane: 0, lanes: 2 });
    expect(lanes("member_of:region>organization")).toMatchObject({ lane: 1, lanes: 2 });
    expect(lanes("part_of:region>region")).toMatchObject({ lane: 0, lanes: 2 });
    expect(lanes("member_of:region>region")).toMatchObject({ lane: 1, lanes: 2 });
  });

  it("puts the best-connected kind in the middle", () => {
    expect(shape.bubbles.find((b) => b.hub)?.key).toBe("story");
  });

  it("totals each relation with links, biggest first", () => {
    expect(shape.relations).toEqual([
      { key: "part_of", label: "Part of", count: 5079 },
      { key: "mentions", label: "Mentions", count: 955 },
      { key: "drives", label: "Drives", count: 236 },
      { key: "located_in", label: "Located in", count: 110 },
      { key: "member_of", label: "Member of", count: 39 },
    ]);
  });

  it("names an edge in words", () => {
    const byKey = new Map(shape.bubbles.map((b) => [b.key, b]));
    const located = shape.edges.find((e) => e.relation === "located_in")!;
    expect(describeEdge(located, byKey)).toBe("Organisations located in places: 110 links");
    const part = shape.edges.find((e) => e.relation === "part_of")!;
    expect(describeEdge(part, byKey)).toBe("Places part of places: 5,079 links");
  });
});

describe("layoutSchema", () => {
  const laid = layoutSchema(shapeSchema(SCHEMA), { width: 1000, height: 700 });

  it("puts the hub in the middle and the rest on a circle around it, inside the box", () => {
    const story = laid.bubbles.find((b) => b.key === "story")!;
    expect([story.x, story.y]).toEqual([500, 350]);
    const ring = laid.bubbles.filter((b) => !b.hub);
    const d = ring.map((b) => Math.round(Math.hypot(b.x - 500, b.y - 350)));
    expect(new Set(d).size).toBe(1);
    for (const b of laid.bubbles) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r).toBeLessThanOrEqual(1000);
      expect(b.y - b.r).toBeGreaterThanOrEqual(0);
      expect(b.y + b.r).toBeLessThanOrEqual(700);
    }
    // The first kind on the circle sits at the top.
    expect(ring[0].y).toBeLessThan(350);
  });

  it("draws edges from rim to rim, lanes on either side, loops away from the middle", () => {
    const a = { x: 0, y: 0, r: 10 };
    const b = { x: 100, y: 0, r: 10 };
    const straight = edgeGeometry({ loop: false, lane: 0, lanes: 1 }, a, b, { x: 50, y: 50 });
    expect(straight.path.startsWith("M10,0 Q")).toBe(true);
    expect(straight.label).toEqual({ x: 50, y: 0 });
    const up = edgeGeometry({ loop: false, lane: 0, lanes: 2 }, a, b, { x: 50, y: 50 });
    const down = edgeGeometry({ loop: false, lane: 1, lanes: 2 }, a, b, { x: 50, y: 50 });
    expect(Math.sign(up.label.y)).toBe(-Math.sign(down.label.y));
    const loop = edgeGeometry({ loop: true, lane: 0, lanes: 1 }, { x: 0, y: -100, r: 20 }, b, { x: 0, y: 0 });
    expect(loop.label.y).toBeLessThan(-120); // above the bubble, away from the middle
  });
});
