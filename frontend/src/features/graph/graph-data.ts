/**
 * The knowledge graph's data shaping, kept free of React and canvas so it
 * can be tested: the api arguments a set of filters sends, the drawing
 * model (sizes, colours, label priority), neighbours for hover focus, the
 * time-lapse order, search inside the graph and the accessible list.
 */
import type {
  EntityType,
  GraphData,
  GraphLink,
  GraphNode,
  Impact,
  LinkType,
  Polarity,
  PropertyDef,
  PropertyFilter,
  RelationDirection,
  RpcArgs,
  SchemaResponse,
  SectorId,
  TimeWindow,
} from "@/api/contract";
import { isWeak, polarityInfo, WEAK_LINK_LABEL } from "@/lib/meaning";
import { MIN_CONFIDENCE } from "@/state/nav";

import { nodeColorVar } from "./graph-colors";

// ---------------------------------------------------------------------------
// Filters → api.graph arguments
// ---------------------------------------------------------------------------

/** Kinds the graph can show, in the order the filter chips and the legend list them. */
export const GRAPH_TYPES: readonly EntityType[] = [
  "story",
  "forecast",
  "region",
  "organization",
  "commodity",
  "infrastructure",
  "policy",
  "person",
  "indicator",
  "sector",
];

/** On by default: everything but sectors (they link to almost everything). */
export const DEFAULT_TYPES: readonly EntityType[] = GRAPH_TYPES.filter((t) => t !== "sector");

/** How many nodes the graph may show. */
export const LIMIT_OPTIONS = [100, 250, 500, 1000] as const;
export type NodeLimit = (typeof LIMIT_OPTIONS)[number];
export const DEFAULT_LIMIT: NodeLimit = 250;
/** Phones: fewer, so the graph opens readable on a small screen rather than as a hairball. */
export const PHONE_LIMIT: NodeLimit = 100;

/** The starting limit for this screen size. */
export function defaultLimit(phone: boolean): NodeLimit {
  return phone ? PHONE_LIMIT : DEFAULT_LIMIT;
}

/** The starting filters for this screen size. */
export function defaultFilters(phone: boolean): GraphFilters {
  return { ...DEFAULT_FILTERS, limit: defaultLimit(phone) };
}

export type GraphWindow = TimeWindow | "all";

export interface RegionPick {
  id: string;
  name: string;
}

/**
 * One property condition as the filter controls hold it: chips for a
 * choice, a min–max range for a number or a date (in whole years), a
 * "contains" box for text.
 */
export type PropCondition =
  | { kind: "choice"; values: string[] }
  | { kind: "number" | "date"; min: number | null; max: number | null }
  | { kind: "text"; text: string };

/** Property conditions; they apply only while exactly this one type is selected. */
export interface PropertyConditions {
  type: EntityType;
  byKey: Record<string, PropCondition>;
}

export interface GraphFilters {
  /** Kinds to show; empty shows nothing. */
  types: EntityType[];
  /** Only stories about these places (and what they mention). */
  regions: RegionPick[];
  /** Ignore the shared window and show all time. */
  allTime: boolean;
  limit: NodeLimit;
  /** Only links of these relations (relation keys; empty = every relation). kg.relations. */
  relations: string[];
  /** Around one node: links leaving it, arriving at it, or both. kg.relations. */
  direction: RelationDirection;
  /** Property conditions for the one selected type. kg.properties. */
  props: PropertyConditions | null;
}

export const DEFAULT_FILTERS: GraphFilters = {
  types: [...DEFAULT_TYPES],
  regions: [],
  allTime: false,
  limit: DEFAULT_LIMIT,
  relations: [],
  direction: "both",
  props: null,
};

/** Which flagged filters are switched on (lib/flags.ts); off sends what the graph sent before. */
export interface GraphFeatures {
  /** kg.relations: the relation filter and the direction toggle. */
  relations: boolean;
  /** kg.properties: property conditions. */
  properties: boolean;
}

export const NO_FEATURES: GraphFeatures = { relations: false, properties: false };

/** At most this many property conditions (api.graph's limit). */
const MAX_WHERE = 10;

/**
 * The `where` conditions for the filters: only while exactly one type is
 * selected and the conditions belong to it. Sorted by property, so equal
 * filters share one cache entry. Date ranges are whole years: from the
 * start of the first to the end of the last.
 */
export function whereArgs(filters: Pick<GraphFilters, "types" | "props">): PropertyFilter[] {
  const props = filters.props;
  if (!props || filters.types.length !== 1 || filters.types[0] !== props.type) return [];
  const out: PropertyFilter[] = [];
  const finite = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
  for (const prop of Object.keys(props.byKey).sort()) {
    const c = props.byKey[prop];
    if (c.kind === "choice") {
      const values = [...new Set(c.values)].sort();
      if (values.length) out.push({ prop, op: "in", value: values });
    } else if (c.kind === "text") {
      const text = c.text.trim();
      if (text) out.push({ prop, op: "contains", value: text });
    } else {
      const date = c.kind === "date";
      if (finite(c.min)) out.push({ prop, op: "gte", value: date ? String(Math.round(c.min)) : c.min });
      if (finite(c.max)) out.push({ prop, op: "lte", value: date ? `${Math.round(c.max)}-12-31` : c.max });
    }
  }
  return out.slice(0, MAX_WHERE);
}

/** A condition that asks for nothing (empty chips, open range, blank text). */
export function isEmptyCondition(c: PropCondition | undefined): boolean {
  if (!c) return true;
  if (c.kind === "choice") return c.values.length === 0;
  if (c.kind === "text") return c.text.trim() === "";
  return c.min === null && c.max === null;
}

/** The kind of control a property gets in the filters; null when it gets none. */
export type PropertyControl = "choice" | "number" | "date" | "text";

/**
 * The properties of a type the filters offer, in the type's order: choices
 * as chips, numbers and dates as ranges, text as "contains". Places,
 * entities and links are left out (the graph's links already show them), as
 * are properties that only hold another's unit.
 */
export function filterableProperties(defs: readonly PropertyDef[]): (PropertyDef & { control: PropertyControl })[] {
  const units = new Set(defs.map((d) => d.unit_key).filter((k): k is string => !!k));
  const out: (PropertyDef & { control: PropertyControl })[] = [];
  for (const def of defs) {
    if (units.has(def.key)) continue;
    if (def.kind === "choice" && def.choices?.length) out.push({ ...def, control: "choice" });
    else if (def.kind === "number" || def.kind === "date" || def.kind === "text") out.push({ ...def, control: def.kind });
  }
  return out;
}

const typeOrder = (t: EntityType) => {
  const i = GRAPH_TYPES.indexOf(t);
  return i === -1 ? GRAPH_TYPES.length : i;
};

/** The kinds in their fixed order, without repeats. */
export function orderTypes(types: readonly EntityType[]): EntityType[] {
  return [...new Set(types)].sort((a, b) => typeOrder(a) - typeOrder(b));
}

function sameTypes(a: readonly EntityType[], b: readonly EntityType[]): boolean {
  const x = orderTypes(a);
  const y = orderTypes(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/**
 * The api.graph arguments for a set of filters. Defaults are left out so
 * equal views share one cache entry, and lists are sorted so the order
 * chips were tapped in doesn't matter.
 */
export function buildGraphArgs(
  filters: GraphFilters,
  nav: { window: TimeWindow; sectors: readonly SectorId[]; minConfidence?: number },
  sample: boolean | undefined,
  features: GraphFeatures = NO_FEATURES,
): RpcArgs["graph"] {
  const args: RpcArgs["graph"] = {
    window: filters.allTime ? "all" : nav.window,
    limit: filters.limit,
  };
  if (!sameTypes(filters.types, DEFAULT_TYPES)) args.types = orderTypes(filters.types);
  if (nav.sectors.length) args.sectors = [...new Set(nav.sectors)].sort();
  if (filters.regions.length) args.regions = [...new Set(filters.regions.map((r) => r.id))].sort();
  const floor = confidenceFloor(nav.minConfidence);
  if (floor > 0) args.min_confidence = floor;
  if (features.relations && filters.relations.length) args.relations = [...new Set(filters.relations)].sort();
  if (features.properties) {
    const where = whereArgs(filters);
    if (where.length) args.where = where;
  }
  if (sample !== undefined) args.sample = sample;
  return args;
}

/** The shared minimum confidence (useNav), rounded to whole percent; missing means the default. */
export function confidenceFloor(minConfidence: number | undefined): number {
  const v = typeof minConfidence === "number" && Number.isFinite(minConfidence) ? minConfidence : MIN_CONFIDENCE.default;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

/**
 * The api.local_graph arguments around one node. Kinds and confidence are
 * filtered here in the browser (one cached answer serves every choice);
 * relations, direction and property conditions are asked of the api.
 */
export function buildLocalArgs(
  scope: { id: string; depth: 1 | 2 | 3 },
  filters: GraphFilters,
  features: GraphFeatures = NO_FEATURES,
): RpcArgs["local_graph"] {
  const args: RpcArgs["local_graph"] = { id: scope.id, depth: scope.depth, limit: 300 };
  if (features.relations) {
    if (filters.relations.length) args.relations = [...new Set(filters.relations)].sort();
    if (filters.direction !== "both") args.direction = filters.direction;
  }
  if (features.properties) {
    const where = whereArgs(filters);
    if (where.length) {
      args.types = [filters.types[0]];
      args.where = where;
    }
  }
  return args;
}

/**
 * How many filters differ from the defaults (for the Filters button badge).
 * Sectors count via the lens; the shared minimum confidence counts when it
 * isn't the app's default; the direction only around one node.
 */
export function activeFilterCount(
  filters: GraphFilters,
  phone = false,
  options: { minConfidence?: number; local?: boolean } = {},
): number {
  let n = 0;
  if (!sameTypes(filters.types, DEFAULT_TYPES)) n += 1;
  if (filters.regions.length) n += 1;
  if (confidenceFloor(options.minConfidence) !== MIN_CONFIDENCE.default) n += 1;
  if (filters.limit !== defaultLimit(phone)) n += 1;
  if (filters.relations.length) n += 1;
  if (whereArgs(filters).length) n += 1;
  if (options.local && filters.direction !== "both") n += 1;
  return n;
}

/**
 * Client-side filtering for the local graph (api.local_graph has no
 * filters): drop kinds that are switched off (never the focus) and
 * cause-and-effect links below the confidence floor.
 */
export function filterGraph(
  data: GraphData,
  options: { types: readonly EntityType[]; minConfidence: number; keep?: string | null },
): GraphData {
  const types = new Set(options.types);
  const nodes = data.nodes.filter((n) => n.id === options.keep || types.has(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  const links = data.links.filter(
    (l) =>
      ids.has(l.source) &&
      ids.has(l.target) &&
      (!l.causal || (l.confidence ?? 0) >= options.minConfidence - 1e-9),
  );
  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Drawing model
// ---------------------------------------------------------------------------

const CAUSAL: ReadonlySet<string> = new Set(["reported", "inferred", "projected", "conditional"]);

export type NodeShape = "dot" | "badge" | "ring";

/** A node as the canvas draws it. force-graph adds x, y, vx, vy (and fx, fy when pinned). */
export interface VizNode {
  id: string;
  type: EntityType;
  subtype: string | null;
  name: string;
  /** The name cut to fit a canvas label. */
  label: string;
  degree: number;
  impact: Impact | null;
  isSample: boolean;
  /** created_at in ms, or null. */
  createdAt: number | null;
  /** Radius in graph units. */
  r: number;
  /** Custom property the node is drawn in. */
  colorVar: string;
  /** Stories are small dots, forecasts rings, other entities icon badges. */
  shape: NodeShape;
  /** Label priority: 0 is the most important. */
  rank: number;
  focus: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

/** A link as the canvas draws it. force-graph swaps `source`/`target` for the node objects. */
export interface VizLink {
  id: string;
  source: string | VizNode;
  target: string | VizNode;
  sourceId: string;
  targetId: string;
  /** The edge type (located_in, mentions…) or the causal link type. */
  type: string;
  /** Reported / inferred / projected / conditional for cause and effect; null for other edges. */
  linkType: LinkType | null;
  confidence: number | null;
  createdAt: number | null;
  /** Relation key (schema.relations[].key): the edge type, or "drives" for cause and effect. */
  relation: string;
  /** Cause and effect: ▲ the effect moves the same way (+1), ▼ the other way (−1); null when unknown. */
  polarity: Polarity | null;
  /** Cause and effect: how strongly (0–1); null means "use confidence". */
  strength: number | null;
  /** Cause and effect: the effect shows after a delay. */
  delayed: boolean | null;
  /** The api's id: the edge id, or the causal_link id for cause and effect (for "Why is this here?"). */
  apiId: number | null;
}

/**
 * What a link is in the api's terms, for provenance (api.provenance
 * {target, id}, Phase A3): an edge, or a causal link. Null when the api sent
 * no id (an older database).
 */
export function linkTarget(link: Pick<VizLink, "linkType" | "apiId">): { target: "edge" | "link"; id: number } | null {
  if (link.apiId === null) return null;
  return { target: link.linkType !== null ? "link" : "edge", id: link.apiId };
}

export interface VizGraph {
  nodes: VizNode[];
  links: VizLink[];
  byId: Map<string, VizNode>;
  /** Ids linked to each node, both directions. */
  neighbours: Map<string, Set<string>>;
  /** Kinds present, in the fixed order (for the legend). */
  types: EntityType[];
  /** Causal link types present (for the legend). */
  linkTypes: LinkType[];
  /** True when anything in the graph is sample data. */
  hasSample: boolean;
}

const LABEL_MAX = 30;

/** "A long story headline that keeps…" */
export function shortLabel(name: string, max = LABEL_MAX): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** Radius in graph units: things grow with their connections; stories stay small dots. */
export function nodeRadius(type: EntityType, degree: number, focus = false): number {
  const d = Math.sqrt(Math.max(0, degree));
  let r: number;
  if (type === "story") r = 2.6 + Math.min(2.6, d * 0.55);
  else if (type === "forecast") r = 4 + Math.min(5, d * 1.1);
  else r = 4 + Math.min(11, d * 1.5);
  return Math.round((focus ? Math.max(r, 10) : r) * 100) / 100;
}

export function nodeShape(type: EntityType): NodeShape {
  return type === "story" ? "dot" : type === "forecast" ? "ring" : "badge";
}

const parseTime = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const linkKey = (l: Pick<GraphLink, "source" | "target" | "type">) => `${l.source}|${l.target}|${l.type}`;

/**
 * Turn api graph data into the drawing model. Links to nodes that aren't in
 * the data are dropped (the layout would fail on them), repeats are drawn
 * once, and label priority puts the best-connected things first, then
 * forecasts, then stories.
 */
export function shapeGraph(data: GraphData, options: { focusId?: string | null } = {}): VizGraph {
  const focusId = options.focusId ?? null;
  const seen = new Set<string>();
  const nodes: VizNode[] = [];
  for (const n of data.nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const focus = n.id === focusId;
    nodes.push({
      id: n.id,
      type: n.type,
      subtype: n.subtype,
      name: n.name,
      label: shortLabel(n.name),
      degree: n.degree,
      impact: n.impact,
      isSample: n.is_sample,
      createdAt: parseTime(n.created_at),
      r: nodeRadius(n.type, n.degree, focus),
      colorVar: nodeColorVar(n),
      shape: nodeShape(n.type),
      rank: 0,
      focus,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const links: VizLink[] = [];
  const linkIds = new Set<string>();
  const neighbours = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of data.links) {
    if (!byId.has(l.source) || !byId.has(l.target) || l.source === l.target) continue;
    const id = linkKey(l);
    if (linkIds.has(id)) continue;
    linkIds.add(id);
    const causal = l.causal && CAUSAL.has(l.type);
    links.push({
      id,
      source: l.source,
      target: l.target,
      sourceId: l.source,
      targetId: l.target,
      type: l.type,
      linkType: causal ? (l.type as LinkType) : null,
      confidence: l.confidence,
      createdAt: parseTime(l.created_at),
      relation: l.relation ?? (causal ? "drives" : l.type),
      polarity: causal ? (l.polarity ?? null) : null,
      strength: causal ? (l.strength ?? null) : null,
      delayed: causal ? (l.delayed ?? null) : null,
      apiId: l.id ?? null,
    });
    neighbours.get(l.source)!.add(l.target);
    neighbours.get(l.target)!.add(l.source);
  }

  // Label priority.
  const weight = (n: VizNode) => (n.focus ? 1e6 : 0) + n.degree * (n.type === "story" ? 0.5 : n.type === "forecast" ? 0.8 : 1);
  [...nodes]
    .sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .forEach((n, i) => (n.rank = i));

  const types = orderTypes(nodes.map((n) => n.type));
  const order: LinkType[] = ["reported", "inferred", "projected", "conditional"];
  const present = new Set(links.map((l) => l.linkType).filter((t): t is LinkType => t !== null));
  return {
    nodes,
    links,
    byId,
    neighbours,
    types,
    linkTypes: order.filter((t) => present.has(t)),
    hasSample: nodes.some((n) => n.isSample),
  };
}

/** Keep the place of nodes that were already on screen, so new data doesn't shuffle the drawing. */
export function carryPositions(previous: VizGraph | null, next: VizGraph): VizGraph {
  if (!previous) return next;
  for (const node of next.nodes) {
    const old = previous.byId.get(node.id);
    if (old && old.x !== undefined && old.y !== undefined) {
      node.x = old.x;
      node.y = old.y;
    }
  }
  return next;
}

/** The id at either end of a link, before or after force-graph swaps in node objects. */
export function endId(end: string | VizNode | undefined): string {
  return typeof end === "string" ? end : (end?.id ?? "");
}

/** A node and everything linked to it (for hover focus). */
export function focusSet(graph: VizGraph, id: string | null): Set<string> | null {
  if (!id || !graph.byId.has(id)) return null;
  return new Set([id, ...(graph.neighbours.get(id) ?? [])]);
}

/**
 * Which labels to draw at this zoom: important nodes first, more as you
 * zoom in, always the focused node and its neighbours. Overlaps are
 * removed by the canvas as it draws.
 */
export function labelBudget(zoom: number, width: number, compact: boolean): number {
  const base = compact ? 6 : width < 900 ? 10 : 16;
  return Math.min(40, Math.max(3, Math.round(base * Math.max(0.5, zoom) ** 1.3)));
}

// ---------------------------------------------------------------------------
// Time-lapse
// ---------------------------------------------------------------------------

/**
 * When each node appears in the replay. A story appears when it was first
 * seen; anything else appears with the first story that links to it (its
 * own record usually dates from when the database was loaded), else with
 * its earliest neighbour, else at its own time.
 */
export function revealTimes(
  nodes: readonly Pick<GraphNode, "id" | "type" | "created_at">[],
  links: readonly Pick<GraphLink, "source" | "target">[],
): Map<string, number> {
  const own = new Map<string, number | null>(nodes.map((n) => [n.id, parseTime(n.created_at)]));
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const l of links) {
    if (!adj.has(l.source) || !adj.has(l.target)) continue;
    adj.get(l.source)!.push(l.target);
    adj.get(l.target)!.push(l.source);
  }
  const out = new Map<string, number>();
  for (const n of nodes) {
    if (n.type === "story") {
      const t = own.get(n.id);
      if (t !== null && t !== undefined) out.set(n.id, t);
    }
  }
  // Pass 1: the earliest linked story.
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    const times = adj
      .get(n.id)!
      .filter((m) => type.get(m) === "story" && out.has(m))
      .map((m) => out.get(m)!);
    if (times.length) out.set(n.id, Math.min(...times));
  }
  // Pass 2: the earliest neighbour with a time, then its own time.
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    const times = adj
      .get(n.id)!
      .filter((m) => out.has(m))
      .map((m) => out.get(m)!);
    const t = times.length ? Math.min(...times) : own.get(n.id);
    if (t !== null && t !== undefined) out.set(n.id, t);
  }
  // Anything left (no times anywhere) appears at the very start.
  const start = out.size ? Math.min(...out.values()) : 0;
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, start);
  return out;
}

/** First and last reveal time; null when there is nothing to replay. */
export function timelapseRange(times: ReadonlyMap<string, number>): { start: number; end: number } | null {
  if (times.size === 0) return null;
  const values = [...times.values()];
  return { start: Math.min(...values), end: Math.max(...values) };
}

/** Node ids in the order they appear (ties: by id, so the replay is stable). */
export function revealOrder(times: ReadonlyMap<string, number>): string[] {
  return [...times.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

/** The ids visible at `cursor`. */
export function visibleAt(times: ReadonlyMap<string, number>, cursor: number): Set<string> {
  const out = new Set<string>();
  for (const [id, t] of times) if (t <= cursor) out.add(id);
  return out;
}

/** `count` evenly spaced cursor positions from start to end (for stepping under reduced motion). */
export function stepPositions(range: { start: number; end: number }, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  if (range.end <= range.start) return [range.end];
  return Array.from({ length: n }, (_, i) => range.start + ((range.end - range.start) * (i + 1)) / n);
}

// ---------------------------------------------------------------------------
// Search inside the graph
// ---------------------------------------------------------------------------

/**
 * Nodes whose name matches `query`: exact, then starts-with, then a word
 * starting with it, then anywhere; best-connected first within each.
 */
export function searchNodes(nodes: readonly VizNode[], query: string, limit = 6): VizNode[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const score = (n: VizNode): number => {
    const name = n.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.split(/[\s(/-]+/).some((w) => w.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return nodes
    .map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || b.n.degree - a.n.degree || a.n.name.localeCompare(b.n.name))
    .slice(0, limit)
    .map((x) => x.n);
}

// ---------------------------------------------------------------------------
// Relations in words (the list view, hover cards)
// ---------------------------------------------------------------------------

/** [from the source's side, from the target's side] */
const RELATIONS: Record<string, [string, string]> = {
  located_in: ["Located in", "Home to"],
  part_of: ["Part of", "Includes"],
  mentions: ["Mentions", "In the news"],
  about: ["About", "Forecast about it"],
  relates_to: ["Related to", "Related to"],
  produces: ["Produces", "Produced in"],
  owns: ["Owns", "Owned by"],
  subsidiary_of: ["Subsidiary of", "Parent of"],
  member_of: ["Member of", "Has member"],
  depends_on: ["Depends on", "Needed by"],
  competes_with: ["Competes with", "Competes with"],
  exports_to: ["Exports to", "Buys from"],
  imports_from: ["Imports from", "Sells to"],
  in_sector: ["In sector", "Includes"],
  reported: ["Leads to", "Follows from"],
  inferred: ["Leads to", "Follows from"],
  projected: ["May lead to", "May follow from"],
  conditional: ["May lead to", "May follow from"],
};

/** A named relation in words, both ways (api.schema relations). */
export interface RelationWords {
  key: string;
  /** Read from the source: "Owns". */
  label: string;
  /** Read from the target: "Owned by". */
  inverse: string;
  /** Lucide icon name, when the schema sent one. */
  icon: string | null;
  symmetric: boolean;
  causal: boolean;
}

export type RelationIndex = ReadonlyMap<string, RelationWords>;

/**
 * The named relations as types.yaml has them: the offline fallback until
 * api.schema answers (and where it isn't available, e.g. the snapshot).
 */
const RELATION_FALLBACK: [key: string, label: string, inverse: string, symmetric?: boolean][] = [
  ["located_in", "Located in", "Home to"],
  ["part_of", "Part of", "Includes"],
  ["owns", "Owns", "Owned by"],
  ["subsidiary_of", "Subsidiary of", "Parent of"],
  ["produces", "Produces", "Produced by"],
  ["exports_to", "Exports to", "Imports from"],
  ["imports_from", "Imports from", "Exports to"],
  ["depends_on", "Depends on", "Needed by"],
  ["member_of", "Member of", "Has member"],
  ["competes_with", "Competes with", "Competes with", true],
  ["in_sector", "In sector", "Includes"],
  ["mentions", "Mentions", "In the news"],
  ["about", "About", "Covered by"],
  ["relates_to", "Related to", "Related to", true],
  ["supplies", "Supplies", "Supplied by"],
  ["operates", "Operates", "Operated by"],
  ["regulates", "Regulates", "Regulated by"],
  ["drives", "Drives", "Driven by"],
];

/** Relation words by key: from api.schema when given, else the built-in copy of types.yaml. */
export function relationIndex(relations?: SchemaResponse["relations"] | null): RelationIndex {
  const out = new Map<string, RelationWords>();
  for (const [key, label, inverse, symmetric = false] of RELATION_FALLBACK) {
    out.set(key, { key, label, inverse, icon: null, symmetric, causal: key === "drives" });
  }
  for (const r of relations ?? []) {
    out.set(r.key, {
      key: r.key,
      label: r.label,
      inverse: r.inverse_label,
      icon: r.icon,
      symmetric: r.symmetric,
      causal: r.causal,
    });
  }
  return out;
}

/**
 * How `fromId` relates to the other end of a link, in a few words. With
 * named relations (an index), it reads from that end's side: "Owns" from
 * the owner, "Owned by" from what is owned; without, the older wording by
 * edge or link type.
 */
export function relationLabel(
  link: Pick<VizLink, "type" | "sourceId"> & { relation?: string },
  fromId: string,
  index?: RelationIndex | null,
): string {
  const outgoing = link.sourceId === fromId;
  const named = index && link.relation ? index.get(link.relation) : undefined;
  if (named) return outgoing || named.symmetric ? named.label : named.inverse;
  const words = RELATIONS[link.type];
  if (words) return outgoing ? words[0] : words[1];
  const readable = link.type.replace(/_/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/** A link's relation read from its source ("Owns"), as link cards name it. */
export function linkRelationName(link: Pick<VizLink, "type" | "sourceId" | "relation">, index: RelationIndex): string {
  return relationLabel(link, link.sourceId, index);
}

/** A link's two ends as nodes (force-graph swaps them in; before it draws, look them up). */
export function linkEnds(link: VizLink, byId?: ReadonlyMap<string, VizNode>): [VizNode, VizNode] | null {
  const s = typeof link.source === "object" ? link.source : byId?.get(link.sourceId);
  const t = typeof link.target === "object" ? link.target : byId?.get(link.targetId);
  return s && t ? [s, t] : null;
}

/**
 * One line for screen readers: "Located in: Mundra Port to India." or
 * "Drives, raises, delayed: A to B. Inferred, confidence 62%. Weak link…".
 */
export function describeLink(link: VizLink, index: RelationIndex | null, byId?: ReadonlyMap<string, VizNode>): string {
  const ends = linkEnds(link, byId);
  const from = ends ? ends[0].name : link.sourceId;
  const to = ends ? ends[1].name : link.targetId;
  const name = index ? linkRelationName(link, index) : link.linkType ? "Leads to" : link.type.replace(/_/g, " ");
  const parts = [name];
  const polarity = index ? polarityInfo(link.polarity) : null;
  if (polarity) parts.push(polarity.word);
  if (index && link.delayed) parts.push("delayed");
  let text = `${parts.join(", ")}: ${from} to ${to}.`;
  if (link.linkType) {
    text += ` ${link.linkType.charAt(0).toUpperCase()}${link.linkType.slice(1)}`;
    text += link.confidence !== null ? `, confidence ${Math.round(link.confidence * 100)}%.` : ", confidence unknown.";
    if (isWeak(link.confidence)) text += ` ${WEAK_LINK_LABEL}.`;
  }
  return text;
}

export interface Connection {
  node: VizNode;
  link: VizLink;
  relation: string;
}

export interface ListEntry {
  node: VizNode;
  connections: Connection[];
  /** Connections beyond the ones listed. */
  more: number;
}

/**
 * The accessible list: the best-connected nodes, each with its strongest
 * connections (cause and effect first, then the best-connected neighbours).
 */
export function topConnections(graph: VizGraph, count = 40, perNode = 6, index?: RelationIndex | null): ListEntry[] {
  const byNode = new Map<string, Connection[]>();
  for (const link of graph.links) {
    const a = graph.byId.get(link.sourceId);
    const b = graph.byId.get(link.targetId);
    if (!a || !b) continue;
    (byNode.get(a.id) ?? byNode.set(a.id, []).get(a.id)!).push({ node: b, link, relation: relationLabel(link, a.id, index) });
    (byNode.get(b.id) ?? byNode.set(b.id, []).get(b.id)!).push({ node: a, link, relation: relationLabel(link, b.id, index) });
  }
  return [...graph.nodes]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    .map((node) => {
      const all = (byNode.get(node.id) ?? []).sort(
        (x, y) =>
          Number(y.link.linkType !== null) - Number(x.link.linkType !== null) ||
          (y.link.confidence ?? 0) - (x.link.confidence ?? 0) ||
          y.node.degree - x.node.degree ||
          x.node.name.localeCompare(y.node.name),
      );
      return { node, connections: all.slice(0, perNode), more: Math.max(0, all.length - perNode) };
    });
}

// ---------------------------------------------------------------------------
// Hover cards
// ---------------------------------------------------------------------------

/** Hover card width in px. */
export const CARD_W = 264;

/** Where a hover card of this size goes: beside the point, flipped to stay inside the box. */
export function placeCard(
  point: { x: number; y: number },
  box: { width: number; height: number },
  height = 110,
): { left: number; top: number } {
  const gap = 14;
  let left = point.x + gap;
  let top = point.y + gap;
  if (left + CARD_W > box.width - 8) left = Math.max(8, point.x - gap - CARD_W);
  if (top + height > box.height - 8) top = Math.max(8, point.y - gap - height);
  return { left: Math.round(left), top: Math.round(top) };
}

// ---------------------------------------------------------------------------
// Kinds in words
// ---------------------------------------------------------------------------

export const TYPE_NAMES: Record<EntityType, { one: string; many: string }> = {
  region: { one: "Place", many: "Places" },
  organization: { one: "Organisation", many: "Organisations" },
  person: { one: "Person", many: "People" },
  commodity: { one: "Commodity", many: "Commodities" },
  sector: { one: "Sector", many: "Sectors" },
  infrastructure: { one: "Infrastructure", many: "Infrastructure" },
  policy: { one: "Policy", many: "Policies" },
  indicator: { one: "Indicator", many: "Indicators" },
  story: { one: "Story", many: "Stories" },
  forecast: { one: "Crowd forecast", many: "Crowd forecasts" },
  user_entity: { one: "Your business", many: "Your business" },
};

/** "3 stories", "1 place". */
export function typeCount(type: EntityType, n: number): string {
  const names = TYPE_NAMES[type] ?? { one: type, many: type };
  return `${n} ${(n === 1 ? names.one : names.many).toLowerCase()}`;
}

/** One line for screen readers: "312 nodes and 845 links: 120 stories, 40 places…". */
export function describeGraph(graph: VizGraph, typeLabel: (t: EntityType, n: number) => string): string {
  const counts = graph.types.map((t) => {
    const n = graph.nodes.filter((x) => x.type === t).length;
    return typeLabel(t, n);
  });
  const base = `${graph.nodes.length} ${graph.nodes.length === 1 ? "node" : "nodes"} and ${graph.links.length} ${
    graph.links.length === 1 ? "link" : "links"
  }`;
  return counts.length ? `${base}: ${counts.join(", ")}` : base;
}
