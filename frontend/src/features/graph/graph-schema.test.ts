/** Phase A in the graph: relation and property filters, named relations, link fields. */
import { describe, expect, it } from "vitest";

import type { PropertyDef, SchemaResponse } from "@/api/contract";

import { GRAPH, link, node } from "./fixtures";
import {
  activeFilterCount,
  buildGraphArgs,
  buildLocalArgs,
  DEFAULT_FILTERS,
  describeLink,
  filterableProperties,
  isEmptyCondition,
  linkRelationName,
  linkTarget,
  relationIndex,
  relationLabel,
  shapeGraph,
  topConnections,
  whereArgs,
  type GraphFilters,
} from "./graph-data";

const NAV = { window: "7d" as const, sectors: [], minConfidence: 0.5 };
const ON = { relations: true, properties: true };

const def = (partial: Partial<PropertyDef> & Pick<PropertyDef, "key" | "label" | "kind">): PropertyDef => ({
  required: false,
  derived: false,
  multiple: false,
  choices: null,
  unit: null,
  unit_key: null,
  entity_types: null,
  pattern: null,
  min: null,
  max: null,
  description: null,
  ...partial,
});

const ORG: GraphFilters = {
  ...DEFAULT_FILTERS,
  types: ["organization"],
  props: {
    type: "organization",
    byKey: {
      size: { kind: "choice", values: ["small", "large"] },
      founded: { kind: "date", min: 1990, max: 2005 },
      ticker: { kind: "text", text: "  DPW " },
    },
  },
};

describe("whereArgs (property conditions → api where)", () => {
  it("turns each kind of control into its condition, sorted by property", () => {
    expect(whereArgs(ORG)).toEqual([
      { prop: "founded", op: "gte", value: "1990" },
      { prop: "founded", op: "lte", value: "2005-12-31" },
      { prop: "size", op: "in", value: ["large", "small"] },
      { prop: "ticker", op: "contains", value: "DPW" },
    ]);
  });

  it("sends numbers as numbers, and only the ends that are set", () => {
    const filters: GraphFilters = {
      ...DEFAULT_FILTERS,
      types: ["story"],
      props: { type: "story", byKey: { confidence: { kind: "number", min: 70, max: null } } },
    };
    expect(whereArgs(filters)).toEqual([{ prop: "confidence", op: "gte", value: 70 }]);
  });

  it("applies only while exactly that one type is selected", () => {
    expect(whereArgs({ ...ORG, types: ["organization", "region"] })).toEqual([]);
    expect(whereArgs({ ...ORG, types: ["region"] })).toEqual([]);
    expect(whereArgs({ ...ORG, props: null })).toEqual([]);
  });

  it("drops empty conditions", () => {
    const filters: GraphFilters = {
      ...ORG,
      props: {
        type: "organization",
        byKey: { size: { kind: "choice", values: [] }, ticker: { kind: "text", text: "  " } },
      },
    };
    expect(whereArgs(filters)).toEqual([]);
    expect(isEmptyCondition({ kind: "number", min: null, max: null })).toBe(true);
    expect(isEmptyCondition({ kind: "number", min: 0, max: null })).toBe(false);
  });
});

describe("filter → request args", () => {
  const filters: GraphFilters = { ...ORG, relations: ["owns", "operates", "owns"], direction: "in" };

  it("sends relations and where on api.graph when the flags are on", () => {
    const args = buildGraphArgs(filters, NAV, undefined, ON);
    expect(args.relations).toEqual(["operates", "owns"]);
    expect(args.where).toHaveLength(4);
    expect(args.types).toEqual(["organization"]);
    // The direction needs a focus: never on the whole graph.
    expect(args.direction).toBeUndefined();
  });

  it("sends neither while the flags are off (the graph as before)", () => {
    const args = buildGraphArgs(filters, NAV, undefined);
    expect(args.relations).toBeUndefined();
    expect(args.where).toBeUndefined();
    expect(buildGraphArgs(filters, NAV, undefined, { relations: true, properties: false }).where).toBeUndefined();
  });

  it("asks the neighbourhood for relations, direction and where (with its one type)", () => {
    expect(buildLocalArgs({ id: "infra:jebel-ali-port", depth: 1 }, filters, ON)).toEqual({
      id: "infra:jebel-ali-port",
      depth: 1,
      limit: 300,
      relations: ["operates", "owns"],
      direction: "in",
      types: ["organization"],
      where: whereArgs(filters),
    });
    expect(buildLocalArgs({ id: "x:y", depth: 2 }, filters)).toEqual({ id: "x:y", depth: 2, limit: 300 });
    expect(buildLocalArgs({ id: "x:y", depth: 2 }, { ...DEFAULT_FILTERS, direction: "out" }, ON)).toEqual({
      id: "x:y",
      depth: 2,
      limit: 300,
      direction: "out",
    });
  });

  it("counts relation, property and (around a node) direction filters", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, relations: ["owns"] })).toBe(1);
    expect(activeFilterCount(ORG)).toBe(2); // one kind, its properties
    expect(activeFilterCount({ ...DEFAULT_FILTERS, direction: "out" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, direction: "out" }, false, { local: true })).toBe(1);
    expect(activeFilterCount(DEFAULT_FILTERS, false, { minConfidence: 0.5 })).toBe(0);
    expect(activeFilterCount(DEFAULT_FILTERS, false, { minConfidence: 0 })).toBe(1);
  });
});

describe("filterableProperties", () => {
  it("offers choices, numbers, dates and text, not places, entities, links or unit holders", () => {
    const defs = [
      def({ key: "sector", label: "Sector", kind: "entity", multiple: true }),
      def({ key: "headquarters", label: "Headquarters", kind: "place" }),
      def({ key: "size", label: "Size", kind: "choice", choices: [{ key: "small", label: "Small" }] }),
      def({ key: "founded", label: "Founded", kind: "date" }),
      def({ key: "website", label: "Website", kind: "url" }),
      def({ key: "capacity", label: "Capacity", kind: "number", unit_key: "capacity_unit" }),
      def({ key: "capacity_unit", label: "Capacity unit", kind: "text" }),
      def({ key: "ticker", label: "Ticker", kind: "text" }),
      def({ key: "empty", label: "Empty", kind: "choice", choices: [] }),
    ];
    expect(filterableProperties(defs).map((d) => [d.key, d.control])).toEqual([
      ["size", "choice"],
      ["founded", "date"],
      ["capacity", "number"],
      ["ticker", "text"],
    ]);
  });
});

const RELATIONS: SchemaResponse["relations"] = [
  {
    key: "operates",
    label: "Operates",
    inverse_label: "Operated by",
    icon: "cog",
    causal: false,
    symmetric: false,
    src_types: ["organization"],
    dst_types: ["infrastructure"],
    description: "Runs a port.",
    count: 5,
    by_pair: [],
  },
  {
    key: "competes_with",
    label: "Competes with",
    inverse_label: "Competes with",
    icon: "swords",
    causal: false,
    symmetric: true,
    src_types: ["organization"],
    dst_types: ["organization"],
    description: "Rivals.",
    count: 6,
    by_pair: [],
  },
];

describe("named relations", () => {
  const index = relationIndex(RELATIONS);

  it("reads a relation from either end: the label from the source, the inverse from the target", () => {
    const l = { type: "operates", relation: "operates", sourceId: "org:dp-world" };
    expect(relationLabel(l, "org:dp-world", index)).toBe("Operates");
    expect(relationLabel(l, "infra:jebel-ali-port", index)).toBe("Operated by");
  });

  it("reads a symmetric relation the same both ways", () => {
    const l = { type: "competes_with", relation: "competes_with", sourceId: "org:a" };
    expect(relationLabel(l, "org:a", index)).toBe("Competes with");
    expect(relationLabel(l, "org:b", index)).toBe("Competes with");
  });

  it("knows every relation before the schema answers, and keeps the old words without an index", () => {
    const offline = relationIndex();
    expect(offline.get("owns")).toMatchObject({ label: "Owns", inverse: "Owned by" });
    expect(offline.get("drives")).toMatchObject({ label: "Drives", inverse: "Driven by", causal: true });
    const causal = { type: "inferred", relation: "drives", sourceId: "a:b" };
    expect(relationLabel(causal, "a:b", offline)).toBe("Drives");
    expect(relationLabel(causal, "c:d", offline)).toBe("Driven by");
    expect(relationLabel(causal, "a:b")).toBe("Leads to");
  });

  it("labels the list by relation when given the index", () => {
    const g = shapeGraph(GRAPH);
    const port = topConnections(g, 10, 6, relationIndex()).find((e) => e.node.id === "infra:mundra-port")!;
    expect(port.connections.map((c) => c.relation).sort()).toEqual(["In the news", "Located in"]);
    const india = topConnections(g, 10, 6, relationIndex()).find((e) => e.node.id === "region:in")!;
    expect(india.connections.map((c) => c.relation)).toContain("Home to");
  });
});

describe("links carry relation, polarity, strength, delay and id", () => {
  const data = {
    nodes: [
      node({ id: "story:a", type: "story", name: "Port strike" }),
      node({ id: "story:b", type: "story", name: "Freight rates climb" }),
      node({ id: "org:x", type: "organization", name: "Port operator" }),
      node({ id: "infra:p", type: "infrastructure", name: "The port" }),
    ],
    links: [
      link("story:a", "story:b", "reported", {
        id: 41,
        relation: "drives",
        polarity: 1,
        strength: 0.9,
        delayed: true,
        confidence: 0.5,
      }),
      link("org:x", "infra:p", "operates", { id: 7, relation: "operates" }),
      link("story:a", "infra:p", "mentions"),
    ],
  };
  const g = shapeGraph(data);
  const causal = g.links.find((l) => l.linkType === "reported")!;
  const operates = g.links.find((l) => l.type === "operates")!;

  it("keeps the api's fields on the drawing model", () => {
    expect(causal).toMatchObject({ relation: "drives", polarity: 1, strength: 0.9, delayed: true, apiId: 41 });
    expect(operates).toMatchObject({ relation: "operates", polarity: null, strength: null, apiId: 7 });
    // An older api without `relation`: the edge type is the relation.
    expect(g.links.find((l) => l.type === "mentions")).toMatchObject({ relation: "mentions", apiId: null });
  });

  it("names what a link is for provenance (Phase A3)", () => {
    expect(linkTarget(causal)).toEqual({ target: "link", id: 41 });
    expect(linkTarget(operates)).toEqual({ target: "edge", id: 7 });
    expect(linkTarget(g.links.find((l) => l.type === "mentions")!)).toBeNull();
  });

  it("describes a link with its relation, polarity word and delay", () => {
    const index = relationIndex(RELATIONS);
    expect(linkRelationName(operates, index)).toBe("Operates");
    expect(describeLink(operates, index, g.byId)).toBe("Operates: Port operator to The port.");
    expect(describeLink(causal, index, g.byId)).toBe(
      "Drives, raises, delayed: Port strike to Freight rates climb. Reported, confidence 50%.",
    );
    expect(describeLink({ ...causal, polarity: -1, delayed: false, confidence: 0.4 }, index, g.byId)).toBe(
      "Drives, lowers: Port strike to Freight rates climb. Reported, confidence 40%. Weak link: under 50% sure, or no source.",
    );
  });
});
