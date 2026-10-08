/**
 * Lays the cascade out as a flow with dagre: one column per step (causes on
 * the left, the story in the middle, effects on the right), or one row per
 * step for the vertical phone layout. Each step's column is fixed by its
 * depth; dagre orders the cards within a column, routes long links around
 * cards and keeps a slot between columns for each link's label.
 *
 * Lanes (a forecast's If YES / If NO effects, or the AI projections) enter
 * dagre as one tall box per column; the cards inside are stacked afterwards.
 */
import dagre from "@dagrejs/dagre";

import type { CascadeGroup, CascadeModel } from "./cascade-data";

export type FlowDirection = "LR" | "TB";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number; // top-left
  y: number;
  width: number;
  height: number;
}

export interface LaidOutNode extends Box {
  id: string;
  depth: number;
}

export interface LaidOutSection extends Box {
  key: string;
}

export interface LaidOutGroup extends Box {
  id: string;
  sections: LaidOutSection[];
}

export interface LaidOutEdge {
  id: string;
  /** Bend points between the two cards (empty for a direct link). */
  points: Point[];
  /** Centre of the link's label slot, when dagre placed one. */
  label: Point | null;
}

export interface CascadeLayout {
  direction: FlowDirection;
  nodes: Map<string, LaidOutNode>;
  groups: LaidOutGroup[];
  edges: Map<string, LaidOutEdge>;
  width: number;
  height: number;
}

/** Card and lane sizes in px (the flow's own units). */
export const SIZES = {
  node: { width: 240, height: 88 },
  focus: { width: 280, height: 112 },
  /** Space for a link label between columns. */
  label: { width: 156, height: 34 },
  /** Gap between cards in a column, and between columns. */
  nodesep: 28,
  ranksep: 56,
  group: {
    padding: 12,
    /** The forecast's title (and source, volume, update) at the top of a branch box. */
    title: 66,
    /** "If YES · 62%" with its ring. */
    header: 56,
    gap: 10,
    sectionGap: 10,
  },
} as const;

export function nodeSize(isFocus: boolean) {
  return isFocus ? SIZES.focus : SIZES.node;
}

/** The size of a lane box, and where each section and card goes inside it. */
export function groupGeometry(group: CascadeGroup) {
  const g = SIZES.group;
  const card = SIZES.node;
  const width = card.width + 2 * g.padding;
  let y = g.title;
  const sections = group.sections.map((section) => {
    const top = y;
    const height = g.header + section.ids.length * card.height + Math.max(0, section.ids.length - 1) * g.gap + g.padding;
    const members = section.ids.map((id, i) => ({
      id,
      x: g.padding,
      y: top + g.header + i * (card.height + g.gap),
    }));
    y += height + g.sectionGap;
    return { key: section.key, x: g.padding / 2, y: top, width: width - g.padding, height, members };
  });
  const height = y - g.sectionGap + g.padding / 2;
  return { width, height, sections };
}

/**
 * Positions for every card, lane and link. Pure: the same model always gives
 * the same layout.
 */
export function layoutCascade(model: CascadeModel, direction: FlowDirection = "LR"): CascadeLayout {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: direction,
    // Columns come from the cascade's depth, not from dagre's ranking.
    ranker: "none",
    nodesep: SIZES.nodesep,
    ranksep: SIZES.ranksep,
    edgesep: 12,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  // dagre doubles ranks to make room for labels, so columns are 2 apart.
  const rankOf = (depth: number) => (depth - model.minDepth) * 2;

  // Each card, or the lane box it sits in, is one dagre node.
  const layoutId = new Map<string, string>();
  const groupShapes = new Map<string, ReturnType<typeof groupGeometry>>();
  for (const group of model.groups) {
    const shape = groupGeometry(group);
    groupShapes.set(group.id, shape);
    graph.setNode(group.id, { width: shape.width, height: shape.height, rank: rankOf(group.depth) });
  }
  for (const node of model.nodes) {
    if (node.groupId && groupShapes.has(node.groupId)) {
      layoutId.set(node.id, node.groupId);
      continue;
    }
    layoutId.set(node.id, node.id);
    const size = nodeSize(node.role === "focus");
    graph.setNode(node.id, { ...size, rank: rankOf(node.depth) });
  }

  // Only forward links shape the layout; links within a column or pointing
  // back are still drawn, as plain curves.
  const depthOf = new Map(model.nodes.map((n) => [n.id, n.depth]));
  const routed = new Set<string>();
  for (const edge of model.edges) {
    const v = layoutId.get(edge.link.src);
    const w = layoutId.get(edge.link.dst);
    if (!v || !w || v === w) continue;
    const span = (depthOf.get(edge.link.dst) ?? 0) - (depthOf.get(edge.link.src) ?? 0);
    if (span <= 0) continue;
    const label = SIZES.label;
    graph.setEdge(
      v,
      w,
      {
        minlen: span,
        weight: edge.link.link_type === "reported" ? 3 : 1,
        width: label.width,
        height: edge.branch ? label.height + 18 : label.height,
        labelpos: "c",
      },
      edge.id,
    );
    routed.add(edge.id);
  }

  dagre.layout(graph);

  const nodes = new Map<string, LaidOutNode>();
  const groups: LaidOutGroup[] = [];
  for (const group of model.groups) {
    const shape = groupShapes.get(group.id)!;
    const center = graph.node(group.id) as { x: number; y: number };
    const x = center.x - shape.width / 2;
    const y = center.y - shape.height / 2;
    groups.push({
      id: group.id,
      x,
      y,
      width: shape.width,
      height: shape.height,
      sections: shape.sections.map((s) => ({ key: s.key, x: x + s.x, y: y + s.y, width: s.width, height: s.height })),
    });
    for (const section of shape.sections) {
      for (const member of section.members) {
        nodes.set(member.id, {
          id: member.id,
          depth: group.depth,
          x: x + member.x,
          y: y + member.y,
          ...SIZES.node,
        });
      }
    }
  }
  for (const node of model.nodes) {
    if (nodes.has(node.id)) continue;
    const laid = graph.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!laid) continue;
    nodes.set(node.id, {
      id: node.id,
      depth: node.depth,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    });
  }

  const edges = new Map<string, LaidOutEdge>();
  for (const edge of model.edges) {
    if (!routed.has(edge.id)) {
      edges.set(edge.id, { id: edge.id, points: [], label: null });
      continue;
    }
    const v = layoutId.get(edge.link.src)!;
    const w = layoutId.get(edge.link.dst)!;
    const label = graph.edge({ v, w, name: edge.id }) as { points?: Point[]; x?: number; y?: number } | undefined;
    const points = (label?.points ?? []).slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
    edges.set(edge.id, {
      id: edge.id,
      points,
      label: label && typeof label.x === "number" && typeof label.y === "number" ? { x: label.x, y: label.y } : null,
    });
  }

  untangleLaneLinks(model, layoutId, routed, nodes, edges, direction);

  const info = graph.graph() as { width?: number; height?: number };
  return { direction, nodes, groups, edges, width: info.width ?? 0, height: info.height ?? 0 };
}

/**
 * dagre sees a lane box as one card, so links from one story into the same
 * box (If YES and If NO) can cross on the way in. Hand out their routes in
 * the order of the cards they reach: the top route goes to the top card.
 */
function untangleLaneLinks(
  model: CascadeModel,
  layoutId: ReadonlyMap<string, string>,
  routed: ReadonlySet<string>,
  nodes: ReadonlyMap<string, LaidOutNode>,
  edges: Map<string, LaidOutEdge>,
  direction: FlowDirection,
) {
  const across = (p: Point) => (direction === "LR" ? p.y : p.x);
  const bundles = new Map<string, string[]>();
  for (const edge of model.edges) {
    if (!routed.has(edge.id)) continue;
    const w = layoutId.get(edge.link.dst);
    if (!w || w === edge.link.dst) continue; // only links into lane boxes
    const key = `${layoutId.get(edge.link.src)}→${w}`;
    bundles.set(key, [...(bundles.get(key) ?? []), edge.id]);
  }
  for (const ids of bundles.values()) {
    if (ids.length < 2) continue;
    const routes = ids.map((id) => edges.get(id)!);
    if (new Set(routes.map((r) => r.points.length)).size !== 1) continue;
    const routeKey = (r: LaidOutEdge) => (r.label ? across(r.label) : r.points.length ? across(r.points[0]) : 0);
    const sortedRoutes = [...routes].sort((a, b) => routeKey(a) - routeKey(b));
    const target = (id: string) => {
      const dst = model.edges.find((e) => e.id === id)!.link.dst;
      const box = nodes.get(dst);
      return box ? across({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) : 0;
    };
    const sortedIds = [...ids].sort((a, b) => target(a) - target(b));
    sortedIds.forEach((id, i) => {
      edges.set(id, { id, points: sortedRoutes[i].points, label: sortedRoutes[i].label });
    });
  }
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/** Below this zoom the cards' text gets too small to read comfortably. */
export const READABLE_ZOOM = 0.7;

/**
 * What to frame when a layout appears: everything if it fits at a readable
 * size; otherwise the story and its direct causes and effects; right after
 * AI projections arrive, the story and the projections.
 * `ids: null` means all of it.
 */
export function fitPlan(
  model: CascadeModel,
  layout: CascadeLayout,
  box: { width: number; height: number },
  newProjections: boolean,
): { ids: string[] | null; minZoom?: number } {
  if (newProjections) {
    const ai = model.groups.find((g) => g.kind === "ai");
    if (ai) return { ids: [model.focus, ai.id], minZoom: 0.5 };
  }
  if (box.width <= 0 || box.height <= 0 || layout.width <= 0 || layout.height <= 0) return { ids: null };
  const zoom = Math.min(box.width / (layout.width * 1.12), box.height / (layout.height * 1.12));
  if (zoom >= READABLE_ZOOM) return { ids: null };
  const ids = new Set<string>([model.focus]);
  for (const node of model.nodes) if (Math.abs(node.depth) <= 1) ids.add(node.groupId ?? node.id);
  return { ids: [...ids], minZoom: READABLE_ZOOM };
}

// ---------------------------------------------------------------------------
// Drawing links
// ---------------------------------------------------------------------------

/**
 * A smooth path from one card to another through dagre's bend points. It
 * leaves and arrives along the flow direction and passes through the bends
 * as one spline (Catmull-Rom), so links fan out gently instead of kinking.
 * Links that point back (or stay in a column) swing out and back in.
 */
export function flowPath(source: Point, target: Point, bends: readonly Point[], direction: FlowDirection): string {
  const lr = direction === "LR";
  const along = (p: Point) => (lr ? p.x : p.y);
  const pts = [source, ...bends, target];
  const start = `M${fmt(source.x)},${fmt(source.y)}`;

  // Backwards or sideways: one wide loop from the exit side to the entry side.
  if (along(target) - along(source) <= 8 && bends.length === 0) {
    const cross = lr ? Math.abs(target.y - source.y) : Math.abs(target.x - source.x);
    const reach = Math.max(48, cross / 2);
    return lr
      ? `${start} C${fmt(source.x + reach)},${fmt(source.y)} ${fmt(target.x - reach)},${fmt(target.y)} ${fmt(target.x)},${fmt(target.y)}`
      : `${start} C${fmt(source.x)},${fmt(source.y + reach)} ${fmt(target.x)},${fmt(target.y - reach)} ${fmt(target.x)},${fmt(target.y)}`;
  }

  // Tangents: along the flow at both ends, Catmull-Rom at the bends.
  const n = pts.length;
  const tangents = pts.map((p, i) => {
    if (i === 0 || i === n - 1) {
      const other = i === 0 ? pts[1] : pts[n - 2];
      const span = Math.abs(along(i === 0 ? other : p) - along(i === 0 ? p : other)) * 1.5;
      return lr ? { x: span, y: 0 } : { x: 0, y: span };
    }
    return { x: (pts[i + 1].x - pts[i - 1].x) / 2, y: (pts[i + 1].y - pts[i - 1].y) / 2 };
  });
  let d = start;
  for (let i = 1; i < n; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const c1 = { x: p.x + tangents[i - 1].x / 3, y: p.y + tangents[i - 1].y / 3 };
    const c2 = { x: q.x - tangents[i].x / 3, y: q.y - tangents[i].y / 3 };
    d += ` C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(q.x)},${fmt(q.y)}`;
  }
  return d;
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** Where to put a label on a link dagre didn't route: halfway along it. */
export function midpoint(source: Point, target: Point, bends: readonly Point[]): Point {
  const pts = [source, ...bends, target];
  if (pts.length % 2 === 1) return pts[(pts.length - 1) / 2];
  const a = pts[pts.length / 2 - 1];
  const b = pts[pts.length / 2];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---------------------------------------------------------------------------
// Keyboard: arrow keys between cards
// ---------------------------------------------------------------------------

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * The card an arrow key moves to. Along the flow (right/left in columns,
 * down/up in rows) it goes to the nearest step that has cards, picking the
 * card closest in line; across the flow it goes to the next card in the same
 * step. Returns null at the edges.
 */
export function neighbour(layout: CascadeLayout, fromId: string, key: ArrowKey): string | null {
  const from = layout.nodes.get(fromId);
  if (!from) return null;
  const lr = layout.direction === "LR";
  const along = lr ? (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0) : key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  const across = lr ? (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0) : key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const centre = (n: LaidOutNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const c = centre(from);
  const all = [...layout.nodes.values()].filter((n) => n.id !== fromId);

  if (along !== 0) {
    const ahead = all.filter((n) => (n.depth - from.depth) * along > 0);
    if (!ahead.length) return null;
    const nextDepth = ahead.reduce(
      (best, n) => (Math.abs(n.depth - from.depth) < Math.abs(best - from.depth) ? n.depth : best),
      ahead[0].depth,
    );
    const step = ahead.filter((n) => n.depth === nextDepth);
    return closest(step, (n) => (lr ? Math.abs(centre(n).y - c.y) : Math.abs(centre(n).x - c.x)))?.id ?? null;
  }
  const same = all.filter((n) => n.depth === from.depth);
  const beyond = same.filter((n) => {
    const d = lr ? centre(n).y - c.y : centre(n).x - c.x;
    return d * across > 0;
  });
  return closest(beyond, (n) => (lr ? Math.abs(centre(n).y - c.y) : Math.abs(centre(n).x - c.x)))?.id ?? null;
}

function closest<T>(items: readonly T[], distance: (item: T) => number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = distance(item);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}
