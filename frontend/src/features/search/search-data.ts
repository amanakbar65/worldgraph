/**
 * Search as data: results grouped by type (best match's group first), the
 * short context line under each result, where Enter takes you, recent
 * searches, and matching quick actions.
 */
import type { EntityType, Impact, SearchResponse } from "@/api/contract";
import type { Panel } from "@/state/nav";

export type SearchResult = SearchResponse["results"][number];

/** Shortest query that is sent to api.search. */
export const MIN_QUERY = 2;
export const SEARCH_LIMIT = 20;
export const MAX_RECENT = 6;

/** Group names, in the order used when two groups match equally well. */
export const GROUP_LABELS: Record<EntityType, string> = {
  region: "Places",
  story: "Stories",
  forecast: "Crowd forecasts",
  organization: "Companies and organisations",
  commodity: "Commodities",
  policy: "Policies",
  infrastructure: "Infrastructure",
  sector: "Sectors",
  indicator: "Indicators",
  person: "People",
  user_entity: "Your business",
};
const GROUP_RANK = Object.keys(GROUP_LABELS) as EntityType[];

export interface ResultGroup {
  type: EntityType;
  label: string;
  items: SearchResult[];
}

/**
 * Results grouped by type. Groups are ordered by their best match (so
 * "brent" leads with Indicators and "india" with Places); results keep the
 * database's order inside each group.
 */
export function groupResults(results: readonly SearchResult[]): ResultGroup[] {
  const groups = new Map<EntityType, ResultGroup & { best: number }>();
  for (const r of results) {
    const group = groups.get(r.type);
    if (group) {
      group.items.push(r);
      group.best = Math.max(group.best, r.score);
    } else {
      groups.set(r.type, { type: r.type, label: GROUP_LABELS[r.type] ?? r.type, items: [r], best: r.score });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.best - a.best || GROUP_RANK.indexOf(a.type) - GROUP_RANK.indexOf(b.type))
    .map(({ type, label, items }) => ({ type, label, items }));
}

const IMPACTS: readonly Impact[] = ["risk", "opportunity", "neutral"];
const isImpact = (word: string): word is Impact => (IMPACTS as readonly string[]).includes(word);

export interface ResultContext {
  /** The line under the name, without repeating the group, e.g. "India" or "46% crowd forecast". */
  text: string | null;
  /** A story's impact, shown with its icon and colour. */
  impact: Impact | null;
}

/**
 * What to show under a result: "Story · India · risk" → "India" plus the
 * risk impact; "Projected · India · risk" keeps "Projected"; "Forecast ·
 * 46%" → "46% crowd forecast"; anything else as the database wrote it.
 */
export function resultContext(result: Pick<SearchResult, "type" | "context">): ResultContext {
  const context = result.context?.trim();
  if (!context) return { text: result.type === "forecast" ? "Crowd forecast" : null, impact: null };
  const parts = context.split(" · ").map((p) => p.trim()).filter(Boolean);
  if (result.type === "story") {
    if (parts[0] === "Story") parts.shift();
    const impact = parts.find(isImpact) ?? null;
    const rest = parts.filter((p) => !isImpact(p));
    return { text: rest.join(" · ") || null, impact };
  }
  if (result.type === "forecast") {
    const pct = parts.find((p) => /^\d+%$/.test(p));
    return { text: pct ? `${pct} crowd forecast` : "Crowd forecast", impact: null };
  }
  return { text: parts.join(" · "), impact: null };
}

/** The context as one line of plain text (for accessible names and tests). */
export function contextLabel(result: Pick<SearchResult, "type" | "context">): string | null {
  const { text, impact } = resultContext(result);
  const words = [text, impact && impact.charAt(0).toUpperCase() + impact.slice(1)].filter(Boolean);
  return words.length ? words.join(" · ") : null;
}

/** Where Enter takes you: regions, stories and forecasts have their own panels; the rest open as entities. */
export function panelFor(result: Pick<SearchResult, "id" | "type">): Panel {
  switch (result.type) {
    case "region":
      return { kind: "region", id: result.id };
    case "story":
      return { kind: "story", id: result.id };
    case "forecast":
      return { kind: "forecast", id: result.id };
    default:
      return { kind: "entity", id: result.id };
  }
}

// ---------------------------------------------------------------------------
// Recent searches
// ---------------------------------------------------------------------------

export type RecentItem = Pick<SearchResult, "id" | "type" | "name" | "context">;

const NODE_ID = /^[a-z_]+:[a-z0-9][a-z0-9.-]*$/;
const TYPES = new Set<string>(Object.keys(GROUP_LABELS));

/** Recent items from storage, made safe (anything malformed is dropped). */
export function parseRecent(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return [];
  const out: RecentItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !NODE_ID.test(r.id)) continue;
    if (typeof r.type !== "string" || !TYPES.has(r.type)) continue;
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    if (out.some((x) => x.id === r.id)) continue;
    out.push({
      id: r.id,
      type: r.type as EntityType,
      name: r.name.slice(0, 200),
      context: typeof r.context === "string" ? r.context.slice(0, 120) : null,
    });
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

/** The list with this item first (moved up if it was already there), at most six. */
export function addRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  const entry: RecentItem = { id: item.id, type: item.type, name: item.name, context: item.context };
  return [entry, ...list.filter((x) => x.id !== item.id)].slice(0, MAX_RECENT);
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export interface ActionInfo {
  id: string;
  label: string;
  /** Other words that find it, e.g. "dark" for the theme switch. */
  keywords: readonly string[];
  /** Shown before anything is typed. */
  pinned?: boolean;
}

/** Actions whose label or keywords contain every word typed (any order, ignoring case). */
export function matchActions<A extends ActionInfo>(actions: readonly A[], query: string): A[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return actions.filter((a) => a.pinned);
  return actions.filter((a) => {
    const hay = `${a.label} ${a.keywords.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
