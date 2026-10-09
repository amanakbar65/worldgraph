import { describe, expect, it } from "vitest";

import type { GraphData, GraphNode } from "@/api/contract";

import { REGION_INDIA } from "./fixtures";
import { causalNotes, describeCausalNote, layoutMiniGraph, neighbours, pickNodes } from "./region-graph";

function node(id: string, type: GraphNode["type"], degree = 1, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, type, subtype: null, name: id.split(":")[1], degree, impact: null, created_at: null, is_sample: false, ...extra };
}

describe("pickNodes", () => {
  it("takes one of each kind in turn, best-connected first", () => {
    const nodes = [
      node("region:in", "region", 20),
      ...[9, 8, 7, 6, 5].map((d, i) => node(`story:s${i}`, "story", d)),
      node("org:a", "organization", 2),
      node("org:b", "organization", 3),
      node("commodity:rice", "commodity", 1),
    ];
    const picked = pickNodes(nodes, "region:in", 5);
    // Round 1: org b (3), rice, story s0; round 2: org a, story s1.
    expect(picked.map((n) => n.id)).toEqual(["org:b", "org:a", "commodity:rice", "story:s0", "story:s1"]);
  });

  it("puts the surest cause-and-effect pair in first, then fills by kind", () => {
    const nodes = [
      node("region:eg", "region", 20),
      node("story:busy", "story", 9),
      node("story:reserves", "story", 2),
      node("story:pound", "story", 1),
      node("org:cbe", "organization", 3),
      node("commodity:wheat", "commodity", 2),
    ];
    const links = [
      { source: "story:reserves", target: "story:pound", type: "inferred", causal: true, confidence: 0.6, created_at: null },
      { source: "story:busy", target: "story:pound", type: "inferred", causal: true, confidence: 0.4, created_at: null },
      { source: "story:busy", target: "region:eg", type: "reported", causal: true, confidence: 0.9, created_at: null },
    ];
    const picked = pickNodes(nodes, "region:eg", 4, links);
    // The pair (0.6) beats the busier story; stories then wait a round for the other kinds.
    expect(picked.map((n) => n.id)).toEqual(["org:cbe", "commodity:wheat", "story:reserves", "story:pound"]);
    const more = pickNodes(nodes, "region:eg", 5, links);
    expect(more.map((n) => n.id)).toContain("story:busy");
  });

  it("never picks the region itself, and stops when nodes run out", () => {
    const picked = pickNodes([node("region:in", "region"), node("org:a", "organization")], "region:in", 10);
    expect(picked.map((n) => n.id)).toEqual(["org:a"]);
  });
});

describe("layoutMiniGraph", () => {
  const mini = layoutMiniGraph(REGION_INDIA.graph, "region:in");

  it("puts the region in the middle and the rest on a ring inside the box", () => {
    expect(mini.center).toMatchObject({ id: "region:in", x: 0.5, y: 0.47, center: true });
    expect(mini.nodes).toHaveLength(6);
    for (const n of mini.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0.05);
      expect(n.x).toBeLessThanOrEqual(0.95);
      expect(n.y).toBeGreaterThanOrEqual(0.05);
      expect(n.y).toBeLessThanOrEqual(0.95);
    }
    // The first node sits at the top of the ring.
    expect(mini.nodes[0]).toMatchObject({ x: 0.5, y: 0.11 });
  });

  it("groups kinds round the ring: things first, then forecasts, stories and places", () => {
    expect(mini.types).toEqual(["organization", "commodity", "forecast", "story", "region"]);
  });

  it("keeps causal links typed and plain edges as structure", () => {
    const causal = mini.links.find((l) => l.kind === "inferred");
    expect(causal).toMatchObject({ confidence: 0.55 });
    expect([causal!.source.id, causal!.target.id].sort()).toEqual(["story:rice-curbs", "story:trade-deal"]);
    expect(mini.links.filter((l) => l.kind === "structure").length).toBeGreaterThan(0);
  });

  it("draws a link to a smaller place that didn't fit to the region instead", () => {
    const graph: GraphData = {
      nodes: [
        node("region:in", "region", 5),
        node("region:in-gj", "region", 1),
        node("org:a", "organization", 1),
      ],
      links: [{ source: "org:a", target: "region:in-gj", type: "located_in", causal: false, confidence: null, created_at: null }],
    };
    const small = layoutMiniGraph(graph, "region:in", { max: 1 });
    expect(small.nodes.map((n) => n.id)).toEqual(["org:a"]);
    expect(small.hidden).toBe(1);
    expect(small.links).toHaveLength(1);
    expect([small.links[0].source.id, small.links[0].target.id].sort()).toEqual(["org:a", "region:in"]);
  });

  it("draws each pair once, preferring the causal link", () => {
    const graph: GraphData = {
      nodes: [node("region:in", "region"), node("story:a", "story"), node("story:b", "story")],
      links: [
        { source: "story:a", target: "story:b", type: "mentions", causal: false, confidence: null, created_at: null },
        { source: "story:b", target: "story:a", type: "reported", causal: true, confidence: 0.9, created_at: null },
      ],
    };
    const result = layoutMiniGraph(graph, "region:in");
    expect(result.links).toHaveLength(1);
    expect(result.links[0].kind).toBe("reported");
  });

  it("is empty without the region in the graph", () => {
    const result = layoutMiniGraph({ nodes: [], links: [] }, "region:in");
    expect(result.center).toBeNull();
    expect(result.nodes).toEqual([]);
  });

  it("describes each cause-and-effect link with its type and confidence", () => {
    const cause = causalNotes(mini, "story:trade-deal");
    expect(cause).toHaveLength(1);
    expect(describeCausalNote(cause[0])).toBe("inferred link: leads to India signals rice export curbs (55% confidence)");
    const effect = causalNotes(mini, "story:rice-curbs");
    expect(describeCausalNote(effect[0])).toBe("inferred link: follows from US–India trade deal is close (55% confidence)");
    expect(causalNotes(mini, "commodity:rice")).toEqual([]);
  });

  it("finds a node's neighbours for highlighting", () => {
    const near = neighbours(mini, "commodity:rice");
    expect([...near].sort()).toEqual(["commodity:rice", "region:in", "story:rice-curbs"]);
  });
});
