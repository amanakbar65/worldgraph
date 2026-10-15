/**
 * Data shaping for entity pages, kept free of React so it can be tested:
 * which panel an id really belongs in, facts that can link to their nodes,
 * backlinks grouped by kind, an indicator's subject, and how an entity
 * touches the viewer's business profile.
 */
import { Profile, type EntityResponse, type EntityType, type GraphData, type StorySummary } from "@/api/contract";
import type { Panel } from "@/state/nav";

import { orderTypes, TYPE_NAMES } from "./graph-data";

// ---------------------------------------------------------------------------
// Which panel
// ---------------------------------------------------------------------------

const prefixOf = (id: string) => id.slice(0, Math.max(0, id.indexOf(":")));

/**
 * Stories, forecasts and places have panels of their own; an entity page
 * for one of them hands over to that panel. The exception: a place's own
 * panel can ask for its full page ("See everything"), and handing back
 * would go nowhere, so that page shows here.
 *
 * `type` is the entity's type once api.entity has answered (ids normally
 * start with their type, but the type is the final word).
 */
export function redirectFor(id: string, below: Panel | null, type?: EntityType | null): Panel | null {
  const kind = type ?? prefixOf(id);
  if (kind === "story") return { kind: "story", id };
  if (kind === "forecast") return { kind: "forecast", id };
  if (kind === "region") {
    if (below && below.kind === "region" && below.id === id) return null;
    return { kind: "region", id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface FactLink {
  id: string;
  type: EntityType;
  name: string;
}

export interface ShapedFact {
  label: string;
  value: string;
  /** The nodes the value names, when every one of them is a neighbour on the page's graph. */
  links: FactLink[] | null;
}

/** Facts the header already says (the kind of thing it is). */
const HIDDEN_FACTS = new Set(["Type"]);

/**
 * The facts to list, with the names in each value matched to the nodes
 * they name ("Located in: India" → India's node), so they can be tapped.
 * A value links only when all of its names match a neighbour of `selfId`;
 * otherwise it stays plain text.
 */
export function shapeFacts(
  facts: readonly { label: string; value: string }[],
  graph: GraphData,
  selfId: string,
): ShapedFact[] {
  const neighbours = new Set<string>();
  for (const l of graph.links) {
    if (l.source === selfId) neighbours.add(l.target);
    if (l.target === selfId) neighbours.add(l.source);
  }
  const byName = new Map<string, FactLink>();
  for (const n of graph.nodes) {
    if (n.id === selfId || !neighbours.has(n.id) || n.type === "story") continue;
    const key = n.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { id: n.id, type: n.type, name: n.name });
  }
  return facts
    .filter((f) => !HIDDEN_FACTS.has(f.label) && f.value.trim() !== "")
    .map((f) => {
      const names = f.value.split(", ").map((s) => s.trim().toLowerCase());
      const links = names.map((n) => byName.get(n));
      const all = links.length > 0 && links.every((l): l is FactLink => !!l);
      return { label: f.label, value: f.value, links: all ? (links as FactLink[]) : null };
    });
}

/** The line under an entity's name: "Organisation · Company", "Commodity", "Indicator · Monthly". */
export function kindLine(type: EntityType, subtype: string | null): string {
  const kind = TYPE_NAMES[type]?.one ?? readable(type);
  if (!subtype || type === "region") return kind;
  return `${kind} · ${readable(subtype)}`;
}

/** "export-control" → "Export control". */
export function readable(text: string): string {
  const words = text.trim().replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

/** What an indicator measures (its `about` edge), e.g. a country or a commodity. */
export function indicatorSubject(entity: { id: string; type: EntityType }, graph: GraphData): FactLink | null {
  if (entity.type !== "indicator") return null;
  const link = graph.links.find((l) => l.source === entity.id && l.type === "about");
  const node = link ? graph.nodes.find((n) => n.id === link.target) : undefined;
  return node ? { id: node.id, type: node.type, name: node.name } : null;
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export type Backlink = EntityResponse["backlinks"][number];

export interface BacklinkGroup {
  type: EntityType;
  /** "Places", "Commodities"… */
  title: string;
  /** How they link here, in a few words: "produce it", "part of it". */
  relation: string;
  items: Backlink[];
}

/** How a backlink points at this page, from this page's side. */
function backlinkRelation(type: EntityType, edge: string): string {
  switch (edge) {
    case "produces":
      return "produce it";
    case "about":
      return type === "indicator" ? "measure it" : type === "forecast" ? "forecast about it" : "apply to it";
    case "located_in":
      return "located here";
    case "part_of":
      return "part of it";
    case "member_of":
      return "members";
    case "in_sector":
      return "in this sector";
    case "owns":
      return "own it";
    case "subsidiary_of":
      return "subsidiaries";
    case "depends_on":
      return "depend on it";
    case "competes_with":
      return "compete with it";
    case "exports_to":
      return "export to it";
    case "imports_from":
      return "import from it";
    case "relates_to":
      return "related";
    default:
      return readable(edge).toLowerCase();
  }
}

/**
 * Backlinks by kind (in the graph's fixed order), each kind once, leaving
 * out what the page already shows elsewhere (its forecasts and key
 * numbers). Items keep the api's order (by name).
 */
export function groupBacklinks(backlinks: readonly Backlink[], shownElsewhere: ReadonlySet<string> = new Set()): BacklinkGroup[] {
  const byType = new Map<EntityType, Backlink[]>();
  const seen = new Set<string>();
  for (const b of backlinks) {
    if (shownElsewhere.has(b.id) || seen.has(b.id)) continue;
    seen.add(b.id);
    (byType.get(b.type) ?? byType.set(b.type, []).get(b.type)!).push(b);
  }
  return orderTypes([...byType.keys()]).map((type) => {
    const items = byType.get(type)!;
    const relations = [...new Set(items.map((b) => backlinkRelation(type, b.edge_type)))];
    return {
      type,
      title: TYPE_NAMES[type]?.many ?? readable(type),
      relation: relations.slice(0, 2).join(", "),
      items,
    };
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface ImpactCounts {
  risk: number;
  opportunity: number;
  neutral: number;
  /** Drafts from the news feed that haven't been analysed yet (no impact). */
  drafts: number;
}

/** How the latest stories split by impact (drafts counted apart: they have no impact yet). */
export function countImpacts(stories: readonly Pick<StorySummary, "impact" | "analysed">[]): ImpactCounts {
  const out: ImpactCounts = { risk: 0, opportunity: 0, neutral: 0, drafts: 0 };
  for (const s of stories) {
    if (!s.analysed) out.drafts += 1;
    else out[s.impact] += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Impact on you
// ---------------------------------------------------------------------------

const ROLES: [keyof Profile, string][] = [
  ["inputs", "An input you buy"],
  ["locations", "Where you operate"],
  ["suppliers", "Where you source from"],
  ["markets", "Where you sell"],
  ["competitors", "A competitor you follow"],
];

/** A stored business profile, or null when there is none or it doesn't parse. */
export function readProfile(value: unknown): Profile | null {
  const parsed = Profile.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** How this entity appears in the viewer's business profile ("An input you buy"…); empty when it doesn't. */
export function profileRoles(profile: Profile | null, id: string): string[] {
  if (!profile) return [];
  const out: string[] = [];
  for (const [key, label] of ROLES) {
    const list = profile[key];
    if (Array.isArray(list) && (list as unknown[]).includes(id)) out.push(label);
  }
  if (id.startsWith("sector:") && profile.sectors.some((s) => `sector:${s}` === id)) out.push("Your sector");
  return out;
}
