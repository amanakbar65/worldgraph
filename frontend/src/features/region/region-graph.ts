/**
 * The region's "connections" mini graph: which nodes to show (a few of each
 * kind, the best-connected first) and where to put them (the region in the
 * middle, the rest on a ring grouped by kind). Positions are fractions of
 * the drawing box (0..1), so the drawing scales to any panel width.
 */
import type { EntityType, GraphData, GraphLink, GraphNode, LinkType } from "@/api/contract";

/** The order kinds are picked in and go round the ring (things before news). */
export const TYPE_PRIORITY: readonly EntityType[] = [
  "organization",
  "commodity",
  "infrastructure",
  "policy",
  "person",
  "indicator",
  "forecast",
  "story",
  "sector",
  "user_entity",
  "region",
];

const typeRank = (t: EntityType) => {
  const i = TYPE_PRIORITY.indexOf(t);
  return i === -1 ? TYPE_PRIORITY.length : i;
};

export interface PlacedNode extends GraphNode {
  /** 0..1 across the box. */
  x: number;
  /** 0..1 down the box. */
  y: number;
  center: boolean;
}

export interface PlacedLink {
  id: string;
  source: PlacedNode;
  target: PlacedNode;
  /** Causal links keep their type (reported, inferred…); other edges are "structure". */
  kind: LinkType | "structure";
  confidence: number | null;
  /** The edge's own type, e.g. "located_in", "inferred". */
  type: string;
}

export interface MiniGraph {
  center: PlacedNode | null;
  nodes: PlacedNode[]; // the ring, in drawing order
  links: PlacedLink[];
  /** Nodes in the response that didn't fit. */
  hidden: number;
  /** Kinds on show, in ring order (for the legend). */
  types: EntityType[];
}

const CAUSAL_TYPES: ReadonlySet<string> = new Set(["reported", "inferred", "projected", "conditional"]);

const byDegreeThenName = (a: GraphNode, b: GraphNode) =>
  b.degree - a.degree || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Pick up to `max` neighbours: one of each kind in turn (best-connected
 * first), so a few busy stories can't crowd out the companies and goods.
 */
export function pickNodes(nodes: readonly GraphNode[], focusId: string, max: number): GraphNode[] {
  const groups = new Map<EntityType, GraphNode[]>();
  for (const n of nodes) {
    if (n.id === focusId) continue;
    const list = groups.get(n.type) ?? [];
    list.push(n);
    groups.set(n.type, list);
  }
  const ordered = [...groups.entries()]
    .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
    .map(([, list]) => [...list].sort(byDegreeThenName));
  const picked: GraphNode[] = [];
  for (let round = 0; picked.length < max; round++) {
    let added = false;
    for (const list of ordered) {
      if (picked.length >= max) break;
      const next = list[round];
      if (next) {
        picked.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked.sort((a, b) => typeRank(a.type) - typeRank(b.type) || byDegreeThenName(a, b));
}

export interface LayoutOptions {
  /** Most ring nodes to show. */
  max?: number;
  /** Ring radii as fractions of the box. */
  rx?: number;
  ry?: number;
  /** Centre, as fractions of the box (a little high, leaving room for labels below). */
  cx?: number;
  cy?: number;
}

/**
 * Lay out the region's local graph. Links to a place that didn't make the
 * cut (a smaller place inside this region) are drawn to the region itself,
 * so nothing floats unattached; repeats between the same two nodes are
 * drawn once (a causal link wins over a plain edge).
 */
export function layoutMiniGraph(graph: GraphData, focusId: string, options: LayoutOptions = {}): MiniGraph {
  const { max = 10, rx = 0.38, ry = 0.36, cx = 0.5, cy = 0.47 } = options;
  const focus = graph.nodes.find((n) => n.id === focusId) ?? null;
  const picked = pickNodes(graph.nodes, focusId, max);
  const center: PlacedNode | null = focus ? { ...focus, x: cx, y: cy, center: true } : null;
  const n = picked.length;
  const ring: PlacedNode[] = picked.map((node, i) => {
    // Clockwise from the top.
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return {
      ...node,
      x: round(cx + rx * Math.cos(angle)),
      y: round(cy + ry * Math.sin(angle)),
      center: false,
    };
  });

  const placed = new Map<string, PlacedNode>(ring.map((p) => [p.id, p]));
  if (center) placed.set(center.id, center);
  const regionIds = new Set(graph.nodes.filter((g) => g.type === "region").map((g) => g.id));
  const resolve = (id: string): PlacedNode | null =>
    placed.get(id) ?? (center && regionIds.has(id) ? center : null);

  const best = new Map<string, PlacedLink>();
  for (const link of graph.links) {
    const source = resolve(link.source);
    const target = resolve(link.target);
    if (!source || !target || source.id === target.id) continue;
    const pair = [source.id, target.id].sort().join("|");
    const candidate = toPlacedLink(link, source, target, pair);
    const existing = best.get(pair);
    if (!existing || (existing.kind === "structure" && candidate.kind !== "structure")) best.set(pair, candidate);
  }

  const types: EntityType[] = [];
  for (const node of ring) if (!types.includes(node.type)) types.push(node.type);

  return {
    center,
    nodes: ring,
    links: [...best.values()],
    hidden: Math.max(0, graph.nodes.filter((g) => g.id !== focusId).length - ring.length),
    types,
  };
}

function toPlacedLink(link: GraphLink, source: PlacedNode, target: PlacedNode, id: string): PlacedLink {
  const causal = link.causal && CAUSAL_TYPES.has(link.type);
  return {
    id,
    source,
    target,
    kind: causal ? (link.type as LinkType) : "structure",
    confidence: link.confidence,
    type: link.type,
  };
}

function round(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

export interface CausalNote {
  other: PlacedNode;
  kind: LinkType;
  confidence: number | null;
  /** "leads to" when this node is the cause, "follows from" when it is the effect. */
  role: "cause" | "effect";
}

/** The cause-and-effect links a node takes part in, for captions and labels. */
export function causalNotes(graph: MiniGraph, id: string): CausalNote[] {
  const notes: CausalNote[] = [];
  for (const link of graph.links) {
    if (link.kind === "structure") continue;
    if (link.source.id === id) notes.push({ other: link.target, kind: link.kind, confidence: link.confidence, role: "cause" });
    else if (link.target.id === id) notes.push({ other: link.source, kind: link.kind, confidence: link.confidence, role: "effect" });
  }
  return notes;
}

/** "inferred link: leads to Rice curbs (55% confidence)". */
export function describeCausalNote(note: CausalNote): string {
  const how = note.role === "cause" ? "leads to" : "follows from";
  const sure = note.confidence === null ? "" : ` (${Math.round(note.confidence * 100)}% confidence)`;
  return `${note.kind} link: ${how} ${note.other.name}${sure}`;
}

/** The ids linked to a node in the drawing (for hover and focus highlighting). */
export function neighbours(graph: MiniGraph, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const link of graph.links) {
    if (link.source.id === id) out.add(link.target.id);
    if (link.target.id === id) out.add(link.source.id);
  }
  return out;
}
