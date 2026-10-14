/**
 * Pure data shaping for My Business: the "Affects you" feed and its
 * filters, why each story matched, where the news reaches the profile, the
 * hop chain of a downstream match, and watchlist activity.
 */
import type {
  AffectsResponse,
  ForecastSummary,
  CascadeLink,
  CascadeResponse,
  EntityRef,
  EntityType,
  Impact,
  Profile,
  SectorId,
  StorySummary,
  TimeWindow,
} from "@/api/contract";
import { formatCompact } from "@/lib/format";
import { sectorLabel } from "@/lib/icons";
import { WINDOW_MS } from "@/lib/time";
import { hasKeyword, PROFILE_ROLES, ROLE_INFO, rolesOf, type Alert, type ProfileRole } from "@/state/profile";

export type AffectsItem = AffectsResponse["items"][number];

// ---------------------------------------------------------------------------
// Feed filters
// ---------------------------------------------------------------------------

export type ImpactFilter = "all" | "risk" | "opportunity";
export type PathFilter = "all" | "direct" | "downstream";

export interface FeedFilter {
  impact: ImpactFilter;
  path: PathFilter;
  /** Only stories that reach this profile node (from "Where it reaches you"). */
  node: string | null;
}

export const NO_FILTER: FeedFilter = { impact: "all", path: "all", node: null };

/** A direct match touches your profile itself; downstream ones follow from such a story. */
export const isDirect = (item: Pick<AffectsItem, "path">) => item.path.length <= 1;

/** Causal links between the matched story and this one (0 for a direct match). */
export const hopCount = (item: Pick<AffectsItem, "path">) => Math.max(0, item.path.length - 1);

export function filterFeed(items: readonly AffectsItem[], filter: FeedFilter): AffectsItem[] {
  return items.filter((item) => {
    if (filter.impact !== "all" && (!item.story.analysed || item.story.impact !== filter.impact)) return false;
    if (filter.path === "direct" && !isDirect(item)) return false;
    if (filter.path === "downstream" && isDirect(item)) return false;
    if (filter.node && !item.matched.some((m) => m.id === filter.node)) return false;
    return true;
  });
}

export interface FeedCounts {
  all: number;
  risk: number;
  opportunity: number;
  direct: number;
  downstream: number;
}

/** Counts for the filter controls (drafts have no impact yet, so they count only in "all"). */
export function feedCounts(items: readonly AffectsItem[]): FeedCounts {
  const counts: FeedCounts = { all: items.length, risk: 0, opportunity: 0, direct: 0, downstream: 0 };
  for (const item of items) {
    if (item.story.analysed && item.story.impact === "risk") counts.risk += 1;
    if (item.story.analysed && item.story.impact === "opportunity") counts.opportunity += 1;
    if (isDirect(item)) counts.direct += 1;
    else counts.downstream += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Why it matched
// ---------------------------------------------------------------------------

/** Most specific first: what you buy, where you work, then the broad sector. */
const ROLE_ORDER: readonly ProfileRole[] = ["inputs", "competitors", "locations", "suppliers", "markets", "sectors"];

export interface MatchedNode {
  entity: EntityRef;
  /** The lists that hold it, most specific first (empty if no longer in the profile). */
  roles: ProfileRole[];
}

/** The profile nodes a story reaches, each once, with their roles. */
export function matchedNodes(matched: readonly EntityRef[], profile: Profile): MatchedNode[] {
  const out: MatchedNode[] = [];
  for (const entity of matched) {
    if (out.some((m) => m.entity.id === entity.id)) continue;
    const roles = rolesOf(entity.id, profile).sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
    out.push({ entity, roles });
  }
  return out.sort((a, b) => rank(a) - rank(b));
}

function rank(node: MatchedNode): number {
  return node.roles.length ? ROLE_ORDER.indexOf(node.roles[0]) : ROLE_ORDER.length;
}

/** Your keywords that appear in the story's headline or so-what. */
export function keywordHits(story: Pick<StorySummary, "headline" | "so_what">, profile: Profile): string[] {
  const text = `${story.headline} ${story.so_what ?? ""}`;
  return profile.keywords.filter((k) => hasKeyword(text, k));
}

/** "Crude oil (your input)" style phrases for sentences and screen readers. */
export function nodePhrase(node: MatchedNode): string {
  const role = node.roles[0];
  return role ? `${node.entity.name} (${ROLE_INFO[role].phrase})` : node.entity.name;
}

/** One sentence on why a story is in the feed. */
export function whySentence(item: AffectsItem, profile: Profile): string {
  const nodes = matchedNodes(item.matched, profile);
  const keywords = keywordHits(item.story, profile);
  const parts = nodes.map(nodePhrase);
  if (keywords.length) parts.push(`the keyword ${keywords.map((k) => `“${k}”`).join(", ")}`);
  const what = parts.length ? joinWords(parts) : "your profile";
  const hops = hopCount(item);
  if (hops === 0) return `Touches ${what}.`;
  return `${hops === 1 ? "One step" : `${hops} steps`} downstream of news that touches ${what}.`;
}

export function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The sector a "sector:energy" node stands for. */
export function sectorOfNode(id: string): SectorId | null {
  const slug = id.startsWith("sector:") ? id.slice("sector:".length) : null;
  return slug && sectorLabel(slug as SectorId) !== slug ? (slug as SectorId) : null;
}

// ---------------------------------------------------------------------------
// Where it reaches you
// ---------------------------------------------------------------------------

export interface ExposureRow {
  entity: EntityRef;
  roles: ProfileRole[];
  risk: number;
  opportunity: number;
  /** Neutral stories plus drafts not analysed yet. */
  other: number;
  total: number;
}

/**
 * How many feed stories reach each profile node, split by impact. Busiest
 * first; ties keep the more specific role first.
 */
export function exposure(items: readonly AffectsItem[], profile: Profile): ExposureRow[] {
  const rows = new Map<string, ExposureRow>();
  for (const item of items) {
    const impact: Impact | "other" = item.story.analysed ? item.story.impact : "other";
    for (const node of matchedNodes(item.matched, profile)) {
      const row =
        rows.get(node.entity.id) ??
        ({ entity: node.entity, roles: node.roles, risk: 0, opportunity: 0, other: 0, total: 0 } satisfies ExposureRow);
      if (impact === "risk") row.risk += 1;
      else if (impact === "opportunity") row.opportunity += 1;
      else row.other += 1;
      row.total += 1;
      rows.set(node.entity.id, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.total - a.total ||
      ROLE_ORDER.indexOf(a.roles[0] ?? "sectors") - ROLE_ORDER.indexOf(b.roles[0] ?? "sectors") ||
      a.entity.name.localeCompare(b.entity.name),
  );
}

/** Profile entries (ids and sectors) the feed doesn't reach. */
export function quietCount(rows: readonly ExposureRow[], profile: Profile): number {
  const reached = new Set(rows.map((r) => r.entity.id));
  let n = 0;
  for (const role of PROFILE_ROLES) {
    for (const id of profile[role]) {
      const nodeId = role === "sectors" ? `sector:${id}` : id;
      if (!reached.has(nodeId)) n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// The hop chain of a downstream story
// ---------------------------------------------------------------------------

export interface HopStep {
  id: string;
  /** The story at this step, when the cascade includes it. */
  story: StorySummary | null;
  /** The causal link into this step from the previous one (null for the first). */
  link: CascadeLink | null;
}

/**
 * The path from the story that touches you to this one, with each causal
 * link's type, mechanism and confidence from api.cascade.
 */
export function buildHopChain(path: readonly string[], cascade: Pick<CascadeResponse, "nodes" | "links"> | undefined): HopStep[] {
  const nodes = new Map((cascade?.nodes ?? []).map((n) => [n.id, n]));
  return path.map((id, i) => {
    const prev = i > 0 ? path[i - 1] : null;
    const link = prev ? (cascade?.links.find((l) => l.src === prev && l.dst === id) ?? null) : null;
    return { id, story: nodes.get(id) ?? null, link };
  });
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export type WatchKind = "region" | "forecast" | "entity";

export function watchKind(id: string): WatchKind {
  if (id.startsWith("forecast:")) return "forecast";
  if (id.startsWith("region:")) return "region";
  return "entity";
}

/** The node type an id names, from its prefix (infra: is infrastructure). */
export function typeOfId(id: string): EntityType | null {
  const prefix = id.slice(0, id.indexOf(":"));
  const map: Record<string, EntityType> = {
    region: "region",
    org: "organization",
    organization: "organization",
    commodity: "commodity",
    sector: "sector",
    infra: "infrastructure",
    infrastructure: "infrastructure",
    policy: "policy",
    indicator: "indicator",
    forecast: "forecast",
    story: "story",
    person: "person",
  };
  return map[prefix] ?? null;
}

export interface WatchActivity {
  /** Stories in the window (from the newest 20 the entity page lists). */
  inWindow: number;
  /** True when every listed story is in the window: there may be more. */
  capped: boolean;
  /** Stories first seen after the last visit. */
  fresh: number;
  latest: StorySummary | null;
}

const TIMELINE_LIMIT = 20;

/** Recent activity for a watched place or entity, from its timeline (newest first). */
export function watchActivity(
  timeline: readonly StorySummary[],
  window: TimeWindow,
  since: string | null,
  now: number = Date.now(),
): WatchActivity {
  const from = now - WINDOW_MS[window];
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  let inWindow = 0;
  let fresh = 0;
  for (const story of timeline) {
    const t = story.first_seen ? Date.parse(story.first_seen) : Number.NaN;
    if (Number.isNaN(t)) continue;
    if (t >= from) inWindow += 1;
    if (!Number.isNaN(sinceMs) && t > sinceMs) fresh += 1;
  }
  return {
    inWindow,
    capped: timeline.length >= TIMELINE_LIMIT && inWindow >= TIMELINE_LIMIT,
    fresh,
    latest: timeline.find((s) => s.first_seen) ?? null,
  };
}

/** Does any of these stories carry sample data? */
export const anySample = (stories: readonly Pick<StorySummary, "is_sample">[]) => stories.some((s) => s.is_sample);

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export interface ImpactCounts {
  risk: number;
  opportunity: number;
  other: number;
}

/** "3 risk, 2 opportunity, 1 other" for screen readers. */
export function describeImpactCounts(c: ImpactCounts): string {
  const parts: string[] = [];
  if (c.risk) parts.push(`${c.risk} risk`);
  if (c.opportunity) parts.push(`${c.opportunity} opportunity`);
  if (c.other) parts.push(`${c.other} neutral or awaiting analysis`);
  return parts.length ? parts.join(", ") : "no stories";
}

/** "12.4K MANA volume", or a plain note when the provider gives none. */
export function volumeText(forecast: Pick<ForecastSummary, "volume" | "volume_unit">): string {
  if (forecast.volume === null) return "Volume not reported";
  const unit = forecast.volume_unit ? ` ${forecast.volume_unit}` : "";
  return `${formatCompact(forecast.volume)}${unit} volume`;
}

/** A stable key for an alert in a list. */
export function alertKey(alert: Alert): string {
  return alert.kind === "story" ? alert.story.id : `${alert.kind}:${alert.forecast.id}`;
}

/** Has the viewer chosen anything on this step? */
export function stepFilled(profile: Profile, step: number): boolean {
  if (step === 0) return profile.sectors.length > 0;
  if (step === 1) return profile.locations.length + profile.suppliers.length + profile.markets.length > 0;
  return profile.inputs.length + profile.competitors.length + profile.keywords.length > 0;
}
