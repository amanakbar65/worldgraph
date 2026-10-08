/**
 * Pure data shaping for the region panel: the breadcrumb, level words, the
 * sector pulse tiles, the children list and the "Sample data" check.
 * No React here, so it is easy to test.
 */
import {
  SECTOR_IDS,
  type Direction,
  type Impact,
  type RegionRef,
  type RegionResponse,
  type SectorId,
  type SectorPulse,
  type TimeWindow,
} from "@/api/contract";
import { sectorLabel } from "@/lib/icons";
import { WINDOW_LABELS } from "@/lib/time";

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

const LEVEL_WORDS: Record<string, string> = {
  bloc: "Bloc",
  country: "Country",
  state: "State or province",
  city: "City",
};

/** "Country", "State or province", "City", "Bloc"; unknown levels read "Region". */
export function levelLabel(subtype: string | null | undefined): string {
  return (subtype && LEVEL_WORDS[subtype]) || "Region";
}

/** What a region's children are called, e.g. "States and provinces" for a country. */
export function childrenTitle(subtype: string, childSubtypes: readonly string[] = []): string {
  if (subtype === "bloc") return "Member countries";
  if (subtype === "state") return "Cities";
  if (subtype === "country") return "States and provinces";
  // Unknown level: describe what the children are.
  const kinds = new Set(childSubtypes);
  if (kinds.size === 1 && kinds.has("city")) return "Cities";
  if (kinds.size === 1 && kinds.has("country")) return "Countries";
  return "Places within";
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

export interface Crumb {
  id: string;
  name: string;
  subtype: string;
  /** The region the panel is showing (last crumb, not a link). */
  current: boolean;
}

/**
 * The path down to this region: country → state → (this region). The API
 * sends the ancestors (top first, without the region itself); this drops
 * repeats and any stray copy of the region, then appends it as the current
 * crumb.
 */
export function buildBreadcrumb(region: Pick<RegionResponse["region"], "id" | "name" | "subtype" | "breadcrumb">): Crumb[] {
  const seen = new Set<string>([region.id]);
  const crumbs: Crumb[] = [];
  for (const ref of region.breadcrumb) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    crumbs.push({ id: ref.id, name: ref.name, subtype: ref.subtype, current: false });
  }
  crumbs.push({ id: region.id, name: region.name, subtype: region.subtype, current: true });
  return crumbs;
}

/**
 * The region whose figures the KPI tiles show, when it isn't this one
 * (a state or city falls back to its country). Null when the KPIs are the
 * region's own, or when there are none.
 */
export function kpiScopeRegion(
  data: Pick<RegionResponse, "kpis" | "kpi_scope"> & { region: Pick<RegionResponse["region"], "id" | "breadcrumb"> },
): RegionRef | { id: string; name: null } | null {
  const scope = data.kpi_scope;
  if (!scope || scope === data.region.id || data.kpis.length === 0) return null;
  return data.region.breadcrumb.find((r) => r.id === scope) ?? { id: scope, name: null };
}

// ---------------------------------------------------------------------------
// Sector pulse
// ---------------------------------------------------------------------------

/** Short names that fit a tile; the full name stays in the accessible label. */
export const SHORT_SECTOR_LABELS: Record<SectorId, string> = {
  energy: "Energy",
  "agri-food": "Agri-food",
  manufacturing: "Manufacturing",
  "logistics-trade": "Logistics",
  finance: "Finance",
  tech: "Tech",
  health: "Health",
  "real-estate": "Real estate",
  consumer: "Consumer",
};

export interface PulseTile {
  sector: SectorId;
  /** Full name, e.g. "Logistics and trade". */
  label: string;
  /** Tile name, e.g. "Logistics". */
  shortLabel: string;
  /** Dominant impact; a sector with no stories reads neutral. */
  impact: Impact;
  /** Momentum vs the previous window (more or fewer stories). */
  direction: Direction | null;
  count: number;
  /** −1 (all risk) … +1 (all opportunity), importance-weighted. */
  score: number;
  /** 0..1: how one-sided the sector is (|score|). */
  strength: number;
  /** One sentence for screen readers and tooltips. */
  description: string;
}

const IMPACT_PHRASES: Record<Impact, string> = {
  risk: "mostly risk",
  opportunity: "mostly opportunity",
  neutral: "mixed or neutral",
};

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(-1, Math.min(1, score));
}

/** "Energy: 7 stories, mostly opportunity, more than the previous 7 days." */
export function describePulse(
  p: Pick<PulseTile, "label" | "impact" | "direction" | "count">,
  window: TimeWindow,
): string {
  if (p.count === 0) {
    const was = p.direction === "down" ? `, down from the previous ${windowWords(window)}` : "";
    return `${p.label}: no stories in the ${windowWords(window, true)}${was}.`;
  }
  const stories = `${p.count} ${p.count === 1 ? "story" : "stories"}`;
  const momentum =
    p.direction === "up"
      ? `, more than the previous ${windowWords(window)}`
      : p.direction === "down"
        ? `, fewer than the previous ${windowWords(window)}`
        : "";
  return `${p.label}: ${stories}, ${IMPACT_PHRASES[p.impact]}${momentum}.`;
}

/** "24 hours" / "7 days" / "30 days"; with `last`, "last 7 days". */
export function windowWords(window: TimeWindow, last = false): string {
  const long = WINDOW_LABELS[window].long; // "Last 7 days"
  const words = long.replace(/^Last\s+/i, "");
  return last ? `last ${words}` : words;
}

/**
 * The nine sector tiles, always in the contract's fixed order. Missing
 * sectors are filled in as quiet (no stories); a sector with no stories in
 * the window never shows a risk or opportunity colour.
 */
export function shapeSectorPulse(pulse: readonly SectorPulse[], window: TimeWindow): PulseTile[] {
  const bySector = new Map<SectorId, SectorPulse>();
  for (const p of pulse) if (!bySector.has(p.sector)) bySector.set(p.sector, p);
  return SECTOR_IDS.map((sector) => {
    const p = bySector.get(sector);
    const count = Math.max(0, p?.count ?? 0);
    const score = count > 0 ? clampScore(p?.score ?? 0) : 0;
    const impact: Impact = count > 0 ? (p?.impact ?? "neutral") : "neutral";
    const label = sectorLabel(sector);
    const tile = {
      sector,
      label,
      shortLabel: SHORT_SECTOR_LABELS[sector],
      impact,
      direction: p?.direction ?? null,
      count,
      score,
      strength: Math.abs(score),
    };
    return { ...tile, description: describePulse(tile, window) };
  });
}

/** Sectors with stories, busiest first: for a one-line summary. */
export function busiestSectors(tiles: readonly PulseTile[], limit = 3): PulseTile[] {
  return tiles
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || b.strength - a.strength)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Children and counts
// ---------------------------------------------------------------------------

export type RegionChild = RegionResponse["children"][number];

export interface ImpactCounts {
  risk: number;
  opportunity: number;
  neutral: number;
}

export function totalOf(counts: ImpactCounts): number {
  return counts.risk + counts.opportunity + counts.neutral;
}

/** Shares of a stacked bar, in a calm fixed order: opportunity, neutral, risk. */
export function impactShares(counts: ImpactCounts): { impact: Impact; count: number; share: number }[] {
  const total = totalOf(counts);
  const order: Impact[] = ["opportunity", "neutral", "risk"];
  return order
    .map((impact) => ({ impact, count: counts[impact], share: total > 0 ? counts[impact] / total : 0 }))
    .filter((s) => s.count > 0);
}

/** "3 opportunity, 2 risk, 1 neutral" (only non-zero parts), or "No stories". */
export function describeCounts(counts: ImpactCounts): string {
  const parts = (["opportunity", "risk", "neutral"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${k}`);
  return parts.length ? parts.join(", ") : "No stories";
}

/** Busiest first (the API already sorts this way; kept stable for ties). */
export function sortChildren(children: readonly RegionChild[]): RegionChild[] {
  return children
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.count - a.c.count || a.i - b.i)
    .map(({ c }) => c);
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** True when anything the panel shows is illustrative sample data. */
export function showsSample(data: Pick<RegionResponse, "kpis" | "stories" | "decisions" | "graph">): boolean {
  return (
    data.kpis.some((k) => k.is_sample) ||
    data.stories.some((s) => s.is_sample) ||
    data.decisions.some((f) => f.is_sample) ||
    data.graph.nodes.some((n) => n.is_sample)
  );
}
