/**
 * The schema map's data (Phase A5, kg.schema_map), kept free of React so it
 * can be tested: which kinds of thing there are and how many, which
 * relations join them and how often (api.schema by_pair), and where each
 * bubble and link goes on a small, readable diagram.
 */
import type { EntityType, SchemaResponse } from "@/api/contract";

/** A kind of thing, as a bubble: sized by how many there are. */
export interface SchemaBubble {
  key: EntityType;
  /** "Organisation" */
  label: string;
  /** "Organisations" */
  plural: string;
  /** CSS token for its colour: var(--<tone>). */
  tone: string;
  description: string;
  count: number;
  /** Radius in px. */
  r: number;
  /** The best-connected kind sits in the middle. */
  hub: boolean;
  x: number;
  y: number;
}

/** A relation between two kinds, with how many links it has between them. */
export interface SchemaEdge {
  /** "located_in:organization>region" */
  id: string;
  relation: string;
  /** Read from the source: "Located in". */
  label: string;
  /** Read from the target: "Home to". */
  inverse: string;
  description: string;
  src: EntityType;
  dst: EntityType;
  count: number;
  causal: boolean;
  symmetric: boolean;
  /** From a kind to itself (places part of places). */
  loop: boolean;
  /** Among the edges joining the same two kinds: which one (0…lanes-1), so they curve apart. */
  lane: number;
  lanes: number;
}

export interface SchemaShape {
  bubbles: SchemaBubble[];
  edges: SchemaEdge[];
  /** Every relation that has links, with its total (for the list and filters). */
  relations: { key: string; label: string; count: number }[];
}

/** Kinds never shown on the map (the viewer's own business lives elsewhere). */
const HIDDEN: ReadonlySet<EntityType> = new Set(["user_entity"]);

const MIN_R = 16;
const MAX_R = 40;

/** Radius for a count: on a log scale, so 5,000 places don't dwarf 30 commodities. */
export function bubbleRadius(count: number, max: number): number {
  if (max <= 0) return MIN_R;
  const t = Math.log1p(Math.max(0, count)) / Math.log1p(max);
  return Math.round((MIN_R + (MAX_R - MIN_R) * t) * 10) / 10;
}

/**
 * The map's kinds and relations from api.schema: kinds that have things
 * (or links), each relation once per pair of kinds it joins, biggest first.
 * Edges between the same two kinds get lanes so they curve apart.
 */
export function shapeSchema(schema: SchemaResponse): SchemaShape {
  const edges: SchemaEdge[] = [];
  for (const r of schema.relations) {
    for (const pair of r.by_pair) {
      if (pair.count <= 0 || HIDDEN.has(pair.src_type) || HIDDEN.has(pair.dst_type)) continue;
      edges.push({
        id: `${r.key}:${pair.src_type}>${pair.dst_type}`,
        relation: r.key,
        label: r.label,
        inverse: r.inverse_label,
        description: r.description,
        src: pair.src_type,
        dst: pair.dst_type,
        count: pair.count,
        causal: r.causal,
        symmetric: r.symmetric,
        loop: pair.src_type === pair.dst_type,
        lane: 0,
        lanes: 1,
      });
    }
  }
  edges.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  // Lanes: edges joining the same two kinds (either way), and loops on one kind.
  const groups = new Map<string, SchemaEdge[]>();
  for (const e of edges) {
    const key = [e.src, e.dst].sort().join("|");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  for (const group of groups.values()) group.forEach((e, i) => Object.assign(e, { lane: i, lanes: group.length }));

  const linked = new Set(edges.flatMap((e) => [e.src, e.dst]));
  const types = schema.types.filter((t) => !HIDDEN.has(t.key) && (t.count > 0 || linked.has(t.key)));
  const max = Math.max(0, ...types.map((t) => t.count));

  // The hub: the kind joined to the most other kinds (ties: more links).
  const partners = new Map<EntityType, Set<EntityType>>();
  const weight = new Map<EntityType, number>();
  for (const e of edges) {
    if (e.loop) continue;
    (partners.get(e.src) ?? partners.set(e.src, new Set()).get(e.src)!).add(e.dst);
    (partners.get(e.dst) ?? partners.set(e.dst, new Set()).get(e.dst)!).add(e.src);
    weight.set(e.src, (weight.get(e.src) ?? 0) + e.count);
    weight.set(e.dst, (weight.get(e.dst) ?? 0) + e.count);
  }
  let hub: EntityType | null = null;
  for (const t of types) {
    const n = partners.get(t.key)?.size ?? 0;
    const best = hub ? (partners.get(hub)?.size ?? 0) : -1;
    if (n > best || (n === best && n > 0 && (weight.get(t.key) ?? 0) > (weight.get(hub!) ?? 0))) hub = t.key;
  }
  if (hub && (partners.get(hub)?.size ?? 0) < 2) hub = null;

  const relations = schema.relations
    .map((r) => ({
      key: r.key,
      label: r.label,
      count: edges.filter((e) => e.relation === r.key).reduce((sum, e) => sum + e.count, 0),
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    bubbles: types.map((t) => ({
      key: t.key,
      label: t.label,
      plural: t.plural,
      tone: t.tone,
      description: t.description,
      count: t.count,
      r: bubbleRadius(t.count, max),
      hub: t.key === hub,
      x: 0,
      y: 0,
    })),
    edges,
    relations,
  };
}

/**
 * Where the bubbles go in a box: the hub in the middle, the rest on a
 * circle around it (in the schema's display order, starting at the top),
 * leaving room for each bubble's label under it.
 */
export function layoutSchema(shape: SchemaShape, box: { width: number; height: number }): SchemaShape {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const ring = shape.bubbles.filter((b) => !b.hub);
  const maxR = Math.max(MIN_R, ...shape.bubbles.map((b) => b.r));
  // Room for loops above and beside the ring (a loop reaches ~70 px past its bubble) and the labels below.
  const radius = Math.max(80, Math.min(box.width / 2 - maxR - 80, box.height / 2 - maxR - 72));
  const bubbles = shape.bubbles.map((b) => {
    if (b.hub) return { ...b, x: round(cx), y: round(cy) };
    const i = ring.indexOf(b);
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring.length);
    return { ...b, x: round(cx + radius * Math.cos(angle)), y: round(cy + radius * Math.sin(angle)) };
  });
  return { ...shape, bubbles };
}

const round = (v: number) => Math.round(v * 10) / 10;

/** An edge's path and the point for its label, between two placed bubbles. */
export function edgeGeometry(
  edge: Pick<SchemaEdge, "loop" | "lane" | "lanes">,
  a: Pick<SchemaBubble, "x" | "y" | "r">,
  b: Pick<SchemaBubble, "x" | "y" | "r">,
  center: { x: number; y: number },
): { path: string; label: { x: number; y: number }; end: { x: number; y: number; angle: number } } {
  if (edge.loop) {
    // A loop on the far side of the bubble from the middle; more loops, bigger ones.
    const out = Math.atan2(a.y - center.y, a.x - center.x) || -Math.PI / 2;
    const spread = 0.55;
    const size = a.r + 26 + edge.lane * 22;
    const p1 = { x: a.x + a.r * Math.cos(out - spread), y: a.y + a.r * Math.sin(out - spread) };
    const p2 = { x: a.x + a.r * Math.cos(out + spread), y: a.y + a.r * Math.sin(out + spread) };
    const c1 = { x: a.x + size * 1.6 * Math.cos(out - spread * 1.4), y: a.y + size * 1.6 * Math.sin(out - spread * 1.4) };
    const c2 = { x: a.x + size * 1.6 * Math.cos(out + spread * 1.4), y: a.y + size * 1.6 * Math.sin(out + spread * 1.4) };
    const apex = { x: a.x + (a.r + size * 0.82) * Math.cos(out), y: a.y + (a.r + size * 0.82) * Math.sin(out) };
    return {
      path: `M${f(p1.x)},${f(p1.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`,
      label: { x: round(apex.x), y: round(apex.y) },
      end: { x: round(p2.x), y: round(p2.y), angle: Math.atan2(p2.y - c2.y, p2.x - c2.x) },
    };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Lanes curve apart, the same side whichever way the edge runs.
  const flip = a.x < b.x || (a.x === b.x && a.y < b.y) ? 1 : -1;
  const bend = (edge.lane - (edge.lanes - 1) / 2) * 34 * flip;
  const mx = (a.x + b.x) / 2 - uy * bend;
  const my = (a.y + b.y) / 2 + ux * bend;
  const start = towards(a, { x: mx, y: my }, a.r);
  const end = towards(b, { x: mx, y: my }, b.r + 3);
  // A quadratic curve whose middle passes through (mx, my).
  const cx = 2 * mx - (start.x + end.x) / 2;
  const cy = 2 * my - (start.y + end.y) / 2;
  return {
    path: `M${f(start.x)},${f(start.y)} Q${f(cx)},${f(cy)} ${f(end.x)},${f(end.y)}`,
    label: { x: round(mx), y: round(my) },
    end: { x: round(end.x), y: round(end.y), angle: Math.atan2(end.y - cy, end.x - cx) },
  };
}

function towards(from: { x: number; y: number }, to: { x: number; y: number }, distance: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * distance, y: from.y + (dy / len) * distance };
}

const f = (v: number) => (Math.round(v * 10) / 10).toString();

/** "Organisations located in places: 110 links" (the list, and names for screen readers). */
export function describeEdge(edge: SchemaEdge, bubbles: ReadonlyMap<EntityType, Pick<SchemaBubble, "plural">>): string {
  const from = bubbles.get(edge.src)?.plural ?? edge.src;
  const to = (bubbles.get(edge.dst)?.plural ?? edge.dst).toLowerCase();
  const n = `${edge.count.toLocaleString("en-GB")} ${edge.count === 1 ? "link" : "links"}`;
  return `${from} ${edge.label.toLowerCase()} ${to}: ${n}`;
}
