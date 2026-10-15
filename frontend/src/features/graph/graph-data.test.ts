import { describe, expect, it } from "vitest";

import { GRAPH, link, node } from "./fixtures";
import {
  activeFilterCount,
  buildGraphArgs,
  DEFAULT_FILTERS,
  DEFAULT_TYPES,
  describeGraph,
  filterGraph,
  focusSet,
  GRAPH_TYPES,
  labelBudget,
  nodeRadius,
  nodeShape,
  orderTypes,
  placeCard,
  relationLabel,
  revealOrder,
  revealTimes,
  searchNodes,
  shapeGraph,
  shortLabel,
  stepPositions,
  timelapseRange,
  topConnections,
  typeCount,
  visibleAt,
  CARD_W,
  type GraphFilters,
} from "./graph-data";

const NAV = { window: "7d" as const, sectors: [] };

describe("buildGraphArgs", () => {
  it("sends only what differs from the defaults", () => {
    expect(buildGraphArgs(DEFAULT_FILTERS, NAV, undefined)).toEqual({ window: "7d", limit: 250 });
  });

  it("uses the shared window, or all time", () => {
    expect(buildGraphArgs(DEFAULT_FILTERS, { ...NAV, window: "30d" }, undefined).window).toBe("30d");
    expect(buildGraphArgs({ ...DEFAULT_FILTERS, allTime: true }, NAV, undefined).window).toBe("all");
  });

  it("sorts sectors, places and kinds so the tap order doesn't matter", () => {
    const filters: GraphFilters = {
      ...DEFAULT_FILTERS,
      types: ["region", "story", "region"],
      regions: [
        { id: "region:us", name: "United States" },
        { id: "region:in", name: "India" },
      ],
    };
    const args = buildGraphArgs(filters, { window: "24h", sectors: ["tech", "energy"] }, false);
    expect(args).toEqual({
      window: "24h",
      limit: 250,
      types: ["story", "region"],
      sectors: ["energy", "tech"],
      regions: ["region:in", "region:us"],
      sample: false,
    });
  });

  it("rounds the confidence floor and leaves it out at zero", () => {
    expect(buildGraphArgs({ ...DEFAULT_FILTERS, minConfidence: 0.333333 }, NAV, undefined).min_confidence).toBe(0.33);
    expect(buildGraphArgs({ ...DEFAULT_FILTERS, minConfidence: 0 }, NAV, undefined).min_confidence).toBeUndefined();
  });

  it("passes the node limit", () => {
    expect(buildGraphArgs({ ...DEFAULT_FILTERS, limit: 1000 }, NAV, true)).toMatchObject({ limit: 1000, sample: true });
  });

  it("treats the default kinds in any order as the default", () => {
    const shuffled = [...DEFAULT_TYPES].reverse();
    expect(buildGraphArgs({ ...DEFAULT_FILTERS, types: shuffled }, NAV, undefined).types).toBeUndefined();
  });
});

describe("activeFilterCount", () => {
  it("counts each changed filter once", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        types: ["story"],
        regions: [{ id: "region:in", name: "India" }],
        minConfidence: 0.5,
        limit: 500,
      }),
    ).toBe(4);
  });
});

describe("orderTypes", () => {
  it("keeps the fixed order without repeats", () => {
    expect(orderTypes(["region", "story", "forecast", "region"])).toEqual(["story", "forecast", "region"]);
    expect(GRAPH_TYPES).not.toContain("user_entity");
  });
});

describe("filterGraph (local graph filters)", () => {
  it("drops switched-off kinds but always keeps the focus", () => {
    const out = filterGraph(GRAPH, { types: ["story"], minConfidence: 0, keep: "commodity:crude-oil" });
    expect(out.nodes.map((n) => n.id).sort()).toEqual([
      "commodity:crude-oil",
      "story:freight-rates-rise",
      "story:red-sea-attacks",
    ]);
    // Links to nodes that are gone go too.
    expect(out.links.every((l) => out.nodes.some((n) => n.id === l.source) && out.nodes.some((n) => n.id === l.target))).toBe(true);
  });

  it("hides cause-and-effect links below the confidence floor, never other links", () => {
    const all = filterGraph(GRAPH, { types: [...GRAPH_TYPES], minConfidence: 0.7 });
    expect(all.links.some((l) => l.causal)).toBe(false);
    expect(all.links.filter((l) => !l.causal)).toHaveLength(GRAPH.links.filter((l) => !l.causal).length);
    const low = filterGraph(GRAPH, { types: [...GRAPH_TYPES], minConfidence: 0.62 });
    expect(low.links.some((l) => l.causal)).toBe(true);
  });
});

describe("shapeGraph", () => {
  it("draws each node and link once and drops links to missing nodes and loops", () => {
    const data = {
      nodes: [...GRAPH.nodes, GRAPH.nodes[0]],
      links: [
        ...GRAPH.links,
        GRAPH.links[0],
        link("region:in", "region:nowhere"),
        link("region:in", "region:in", "part_of"),
      ],
    };
    const g = shapeGraph(data);
    expect(g.nodes).toHaveLength(GRAPH.nodes.length);
    expect(g.links).toHaveLength(GRAPH.links.length);
    expect(g.byId.get("region:in")?.name).toBe("India");
  });

  it("marks cause-and-effect links with their type; other edges have none", () => {
    const g = shapeGraph(GRAPH);
    const causal = g.links.find((l) => l.type === "inferred");
    expect(causal?.linkType).toBe("inferred");
    expect(causal?.confidence).toBe(0.62);
    expect(g.links.find((l) => l.type === "located_in")?.linkType).toBeNull();
    expect(g.linkTypes).toEqual(["inferred"]);
  });

  it("knows each node's neighbours, both ways", () => {
    const g = shapeGraph(GRAPH);
    expect([...g.neighbours.get("infra:mundra-port")!].sort()).toEqual(["region:in", "story:freight-rates-rise"]);
    expect(focusSet(g, "infra:mundra-port")).toEqual(new Set(["infra:mundra-port", "region:in", "story:freight-rates-rise"]));
    expect(focusSet(g, null)).toBeNull();
    expect(focusSet(g, "region:missing")).toBeNull();
  });

  it("colours stories by impact, forecasts violet, entities by type", () => {
    const g = shapeGraph(GRAPH);
    expect(g.byId.get("story:red-sea-attacks")?.colorVar).toBe("--risk");
    expect(g.byId.get("story:freight-rates-rise")?.colorVar).toBe("--opportunity");
    expect(g.byId.get("forecast:opec-cut")?.colorVar).toBe("--forecast");
    expect(g.byId.get("region:in")?.colorVar).toBe("--type-region");
    expect(g.byId.get("story:red-sea-attacks")?.shape).toBe("dot");
    expect(g.byId.get("forecast:opec-cut")?.shape).toBe("ring");
    expect(g.byId.get("region:in")?.shape).toBe("badge");
  });

  it("gives labels to the best-connected first, and the focus before all", () => {
    const g = shapeGraph(GRAPH);
    const ranked = [...g.nodes].sort((a, b) => a.rank - b.rank).map((n) => n.id);
    expect(ranked[0]).toBe("region:in");
    const focused = shapeGraph(GRAPH, { focusId: "infra:mundra-port" });
    expect([...focused.nodes].sort((a, b) => a.rank - b.rank)[0].id).toBe("infra:mundra-port");
    expect(focused.byId.get("infra:mundra-port")?.focus).toBe(true);
  });

  it("lists the kinds present in the fixed order and notices sample data", () => {
    const g = shapeGraph(GRAPH);
    expect(g.types).toEqual(["story", "forecast", "region", "commodity", "infrastructure"]);
    expect(g.hasSample).toBe(true);
    expect(shapeGraph({ nodes: [node({ id: "region:in", type: "region", name: "India", is_sample: false })], links: [] }).hasSample).toBe(false);
  });
});

describe("sizes and labels", () => {
  it("grows nodes with their connections; stories stay small", () => {
    expect(nodeRadius("region", 9)).toBeGreaterThan(nodeRadius("region", 1));
    expect(nodeRadius("story", 9)).toBeLessThan(nodeRadius("region", 9));
    expect(nodeRadius("story", 400)).toBeLessThanOrEqual(5.2);
    expect(nodeRadius("commodity", 0, true)).toBeGreaterThanOrEqual(10);
    expect(nodeShape("policy")).toBe("badge");
  });

  it("cuts long names at a word", () => {
    expect(shortLabel("India")).toBe("India");
    const cut = shortLabel("Red Sea attacks push shipping onto longer routes around Africa");
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut).not.toMatch(/\s…$/);
  });

  it("allows more labels as you zoom in, fewer on small screens", () => {
    expect(labelBudget(2, 1400, false)).toBeGreaterThan(labelBudget(1, 1400, false));
    expect(labelBudget(1, 390, true)).toBeLessThan(labelBudget(1, 1400, false));
    expect(labelBudget(0.1, 390, true)).toBeGreaterThanOrEqual(3);
  });
});

describe("time-lapse", () => {
  const times = revealTimes(GRAPH.nodes, GRAPH.links);

  it("shows stories when first seen and other nodes with the first story that links to them", () => {
    const red = Date.parse(GRAPH.nodes.find((n) => n.id === "story:red-sea-attacks")!.created_at!);
    const freight = Date.parse(GRAPH.nodes.find((n) => n.id === "story:freight-rates-rise")!.created_at!);
    expect(times.get("story:red-sea-attacks")).toBe(red);
    expect(times.get("story:freight-rates-rise")).toBe(freight);
    // India and oil were loaded long ago, but appear with the earliest story about them.
    expect(times.get("region:in")).toBe(red);
    expect(times.get("commodity:crude-oil")).toBe(red);
    expect(times.get("infra:mundra-port")).toBe(freight);
  });

  it("falls back to a neighbour's time, then to the start", () => {
    // The forecast links to oil and India (not to a story): it appears with them.
    expect(times.get("forecast:opec-cut")).toBe(times.get("commodity:crude-oil"));
    const lonely = revealTimes([node({ id: "region:xx", type: "region", name: "Nowhere" })], []);
    expect(lonely.get("region:xx")).toBe(0);
  });

  it("orders the replay by time, ties by id, and reveals step by step", () => {
    const order = revealOrder(times);
    expect(order.slice(0, 4)).toEqual(["commodity:crude-oil", "forecast:opec-cut", "region:in", "story:red-sea-attacks"]);
    expect(order.at(-1)).toBe("story:freight-rates-rise");
    const range = timelapseRange(times)!;
    expect(visibleAt(times, range.start).has("story:freight-rates-rise")).toBe(false);
    expect(visibleAt(times, range.end).size).toBe(GRAPH.nodes.length);
    expect(timelapseRange(new Map())).toBeNull();
  });

  it("spaces the reduced-motion steps evenly up to the end", () => {
    expect(stepPositions({ start: 0, end: 100 }, 4)).toEqual([25, 50, 75, 100]);
    expect(stepPositions({ start: 5, end: 5 }, 4)).toEqual([5]);
  });
});

describe("searchNodes", () => {
  it("ranks exact, then prefix, then word, then anywhere; busier first within each", () => {
    const g = shapeGraph(GRAPH);
    expect(searchNodes(g.nodes, "india").map((n) => n.id)).toEqual(["region:in"]);
    expect(searchNodes(g.nodes, "fre")[0].id).toBe("story:freight-rates-rise");
    expect(searchNodes(g.nodes, "oil").map((n) => n.id)).toEqual(["commodity:crude-oil"]);
    expect(searchNodes(g.nodes, "  ")).toEqual([]);
    expect(searchNodes(g.nodes, "o", 2)).toHaveLength(2);
  });
});

describe("the list view", () => {
  it("names relations from either side", () => {
    expect(relationLabel({ type: "located_in", sourceId: "infra:mundra-port" }, "infra:mundra-port")).toBe("Located in");
    expect(relationLabel({ type: "located_in", sourceId: "infra:mundra-port" }, "region:in")).toBe("Home to");
    expect(relationLabel({ type: "inferred", sourceId: "a:b" }, "a:b")).toBe("Leads to");
    expect(relationLabel({ type: "some_new_edge", sourceId: "a:b" }, "a:b")).toBe("Some new edge");
  });

  it("lists the best-connected nodes, cause and effect first among their links", () => {
    const g = shapeGraph(GRAPH);
    const entries = topConnections(g, 3, 2);
    expect(entries).toHaveLength(3);
    expect(entries[0].node.id).toBe("region:in");
    const red = topConnections(g, 10, 6).find((e) => e.node.id === "story:red-sea-attacks")!;
    expect(red.connections[0].link.linkType).toBe("inferred");
    expect(red.connections[0].relation).toBe("Leads to");
    const india = topConnections(g, 10, 2).find((e) => e.node.id === "region:in")!;
    expect(india.connections).toHaveLength(2);
    expect(india.more).toBe(2);
  });

  it("describes the graph in one line", () => {
    const g = shapeGraph(GRAPH);
    expect(describeGraph(g, typeCount)).toBe(
      "6 nodes and 8 links: 2 stories, 1 crowd forecast, 1 place, 1 commodity, 1 infrastructure",
    );
  });
});

describe("placeCard", () => {
  it("sits beside the point and flips to stay inside", () => {
    expect(placeCard({ x: 100, y: 100 }, { width: 1000, height: 800 })).toEqual({ left: 114, top: 114 });
    const flipped = placeCard({ x: 990, y: 790 }, { width: 1000, height: 800 }, 110);
    expect(flipped.left).toBe(990 - 14 - CARD_W);
    expect(flipped.top).toBe(790 - 14 - 110);
  });
});
