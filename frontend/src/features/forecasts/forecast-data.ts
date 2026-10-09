/**
 * Pure logic for the forecasts view and the forecast panel: the filter
 * arguments sent to api.forecasts, the client-side shaping of the list
 * (thin markets, categories, sort), the movers, and how figures and the
 * If YES / If NO branches read. No React here, so it is easy to test.
 */
import {
  ArrowLeftRight,
  ChartColumn,
  Cpu,
  Globe,
  Landmark,
  Package,
  ScrollText,
  Vote,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  ForecastCategory,
  Profile,
  SECTOR_IDS,
  type ForecastResponse,
  type ForecastSummary,
  type RpcArgs,
  type SectorId,
} from "@/api/contract";
import { formatCompact, formatProbability } from "@/lib/format";
import { describeForecast } from "@/lib/meaning";
import { relativeTime } from "@/lib/time";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type ForecastSort = NonNullable<RpcArgs["forecasts"]["sort"]>;

export const SORT_OPTIONS: readonly { value: ForecastSort; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "moved", label: "Biggest moves" },
  { value: "ending", label: "Ending soon" },
  { value: "volume", label: "Most volume" },
];

export interface CategoryInfo {
  label: string;
  icon: LucideIcon;
}

/** The nine forecast categories, in the contract's order. */
export const CATEGORY_IDS: readonly ForecastCategory[] = ForecastCategory.options;

export const CATEGORIES: Record<ForecastCategory, CategoryInfo> = {
  economy: { label: "Economy", icon: ChartColumn },
  finance: { label: "Finance", icon: Landmark },
  policy: { label: "Policy", icon: ScrollText },
  politics: { label: "Politics", icon: Vote },
  geopolitics: { label: "Geopolitics", icon: Globe },
  trade: { label: "Trade", icon: ArrowLeftRight },
  tech: { label: "Tech", icon: Cpu },
  commodities: { label: "Commodities", icon: Package },
  energy: { label: "Energy", icon: Zap },
};

export function categoryLabel(category: string): string {
  return CATEGORIES[category as ForecastCategory]?.label ?? category;
}

// ---------------------------------------------------------------------------
// Filters → api.forecasts arguments
// ---------------------------------------------------------------------------

export interface RegionFilter {
  id: string;
  name: string;
}

export interface ForecastFilters {
  /** Empty means every category. */
  categories: ForecastCategory[];
  /** Places picked in the search box; empty means everywhere. */
  regions: RegionFilter[];
  includeThin: boolean;
  sort: ForecastSort;
}

export const DEFAULT_FILTERS: ForecastFilters = {
  categories: [],
  regions: [],
  includeThin: false,
  sort: "relevance",
};

/** At most this many places at once (the chips stay on one line). */
export const MAX_REGIONS = 3;

/** True when anything narrows the list (the sort doesn't count). */
export function hasActiveFilters(filters: ForecastFilters, sectors: readonly SectorId[]): boolean {
  return filters.categories.length > 0 || filters.regions.length > 0 || sectors.length > 0;
}

/** Keep a list in a fixed order, so equal choices make equal cache keys. */
function inOrder<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const chosen = new Set(values);
  return order.filter((v) => chosen.has(v));
}

/**
 * The api.forecasts arguments for these filters. With nothing chosen this
 * is exactly the first-frame shape in lib/snapshot-plan.ts (empty lists,
 * relevance, no thin markets). The business profile only changes the
 * relevance order, so it is sent with that sort only.
 */
export function forecastsArgs({
  filters,
  sectors,
  sample,
  profile = null,
}: {
  filters: ForecastFilters;
  sectors: readonly SectorId[];
  sample: boolean | undefined;
  profile?: Profile | null;
}): RpcArgs["forecasts"] {
  const args: RpcArgs["forecasts"] = {
    sectors: inOrder(sectors, SECTOR_IDS),
    regions: [...new Set(filters.regions.map((r) => r.id))].sort(),
    categories: inOrder(filters.categories, CATEGORY_IDS),
    sort: filters.sort,
    include_thin: filters.includeThin,
  };
  if (sample !== undefined) args.sample = sample;
  if (profile && filters.sort === "relevance") args.profile = profile;
  return args;
}

/**
 * The stored business profile, when it is one and says something; null
 * otherwise (a missing, malformed or empty profile is simply not used).
 */
export function usableProfile(value: unknown): Profile | null {
  const parsed = Profile.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const lists = [p.sectors, p.locations, p.inputs, p.suppliers, p.markets, p.competitors, p.keywords];
  return lists.some((list) => list.length > 0) ? p : null;
}

// ---------------------------------------------------------------------------
// Shaping the list in the browser
// ---------------------------------------------------------------------------

const byVolumeThenId = (a: ForecastSummary, b: ForecastSummary) =>
  (b.volume ?? -1) - (a.volume ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const timeOf = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Sort a copy of the list the way the database does for each choice
 * (missing values last; then by volume and id). Relevance keeps the
 * database's order, which may use the business profile.
 */
export function sortForecasts(list: readonly ForecastSummary[], sort: ForecastSort): ForecastSummary[] {
  const copy = [...list];
  if (sort === "relevance") return copy;
  const key = (f: ForecastSummary): number | null => {
    if (sort === "moved") return f.change_24h === null ? null : -Math.abs(f.change_24h);
    if (sort === "ending") return timeOf(f.end_date);
    return f.volume === null ? null : -f.volume;
  };
  return copy.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb !== null) return 1;
    if (kb === null && ka !== null) return -1;
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    return byVolumeThenId(a, b);
  });
}

/**
 * What the list shows: the database already filters and sorts, and doing
 * the same here keeps the list true while a new answer loads (the previous
 * one stays on screen) and when the answer is the bundled sample snapshot.
 */
export function shapeList(list: readonly ForecastSummary[], filters: ForecastFilters): ForecastSummary[] {
  const categories = new Set(filters.categories);
  const kept = list.filter(
    (f) => (filters.includeThin || !f.thin) && (categories.size === 0 || categories.has(f.category)),
  );
  return sortForecasts(kept, filters.sort);
}

/** A move this big (in probability units) counts as a mover; bigger ones glow. */
export const MOVER_MIN_CHANGE = 0.03;
export const BIG_MOVE = 0.1;

/** The biggest 24-hour moves among markets that aren't thin. */
export function pickMovers(list: readonly ForecastSummary[], count = 3): ForecastSummary[] {
  return list
    .filter((f) => !f.thin && f.change_24h !== null && Math.abs(f.change_24h) >= MOVER_MIN_CHANGE)
    .sort((a, b) => Math.abs(b.change_24h ?? 0) - Math.abs(a.change_24h ?? 0) || byVolumeThenId(a, b))
    .slice(0, count);
}

export function isBigMove(change: number | null): boolean {
  return change !== null && Math.abs(change) >= BIG_MOVE;
}

/**
 * The y range for a probability sparkline: the data's own range, widened to
 * at least 10 points so small wobbles don't look like big swings.
 */
export function sparklineDomain(values: readonly number[], minSpan = 0.1): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (lo < 0) [lo, hi] = [0, Math.min(1, hi - lo)];
  if (hi > 1) [lo, hi] = [Math.max(0, lo - (hi - 1)), 1];
  return [lo, hi];
}

// ---------------------------------------------------------------------------
// How figures read
// ---------------------------------------------------------------------------

/** Volume as a figure and its unit: { value: "48K", unit: "MANA" }; null when not reported. */
export function volumeParts(
  f: Pick<ForecastSummary, "volume" | "volume_unit">,
  locale?: string,
): { value: string; unit: string | null } | null {
  if (f.volume === null) return null;
  return { value: formatCompact(f.volume, locale), unit: f.volume_unit?.trim() || null };
}

/** "48K MANA volume", "412K volume" or "Volume not reported". */
export function volumeText(f: Pick<ForecastSummary, "volume" | "volume_unit">, locale?: string): string {
  const parts = volumeParts(f, locale);
  if (!parts) return "Volume not reported";
  return `${parts.value}${parts.unit ? ` ${parts.unit}` : ""} volume`;
}

/** "▲ 8" style text needs words for screen readers: "up 8 points", "unchanged". */
export function changeWords(change: number | null): string {
  if (change === null) return "no 24-hour change reported";
  const points = Math.round(change * 100);
  if (points === 0) return "unchanged in 24 hours";
  return `${points > 0 ? "up" : "down"} ${Math.abs(points)} point${Math.abs(points) === 1 ? "" : "s"} in 24 hours`;
}

export type MoneyKind = "play" | "real" | "none" | "sample" | "unknown";

const PLAY_UNITS = new Set(["MANA", "M$", "MANA$"]);
const PROVIDER_MONEY: Record<string, MoneyKind> = {
  sample: "sample",
  manifold: "play",
  metaculus: "none",
  polymarket: "real",
  kalshi: "real",
};

/** Whether the forecasters stake play money, real money or nothing. */
export function moneyKind(f: Pick<ForecastSummary, "provider" | "volume_unit" | "is_sample">): MoneyKind {
  if (f.is_sample) return "sample";
  const known = PROVIDER_MONEY[f.provider.toLowerCase()];
  if (known) return known;
  if (f.volume_unit && PLAY_UNITS.has(f.volume_unit.trim().toUpperCase())) return "play";
  return "unknown";
}

/** One plain sentence on what kind of source this is. */
export function moneyNote(f: Pick<ForecastSummary, "provider" | "provider_name" | "volume_unit" | "is_sample">): string {
  switch (moneyKind(f)) {
    case "sample":
      return "Sample data: an invented question to show how forecasts look.";
    case "play":
      return `Play money: ${f.provider_name} forecasters use a virtual currency${f.volume_unit ? ` (${f.volume_unit})` : ""}, not cash.`;
    case "none":
      return `${f.provider_name} forecasters predict for points; no money is involved.`;
    case "real":
      return `A real-money market, shown for information only.`;
    default:
      return `Shown for information only.`;
  }
}

/** The accessible name of a forecast row: what, how likely, how it moved, how big, when it ends, from whom. */
export function forecastLabel(f: ForecastSummary, now = Date.now()): string {
  const parts = [f.short_title, describeForecast(f.probability, f.change_24h, f.thin), volumeText(f)];
  if (f.end_date) {
    const when = relativeTime(f.end_date, now);
    if (when) parts.push(`${Date.parse(f.end_date) <= now ? "ended" : "ends"} ${when}`);
  }
  parts.push(`source ${f.provider_name}${moneyKind(f) === "play" ? ", play money" : ""}`);
  if (f.is_sample) parts.push("sample data");
  return parts.join(". ");
}

// ---------------------------------------------------------------------------
// If YES / If NO
// ---------------------------------------------------------------------------

export type BranchEffect = ForecastResponse["branches"][number]["effects"][number];

export interface BranchView {
  outcome: "YES" | "NO";
  probability: number;
  effects: BranchEffect[];
}

/** True for a plain yes/no question (or one with no outcomes listed). */
export function isBinary(outcomes: readonly string[]): boolean {
  const set = new Set(outcomes.map((o) => o.trim().toUpperCase()));
  return set.size === 0 || (set.size === 2 && set.has("YES") && set.has("NO"));
}

/**
 * Both branches of a yes/no question, YES first, each with its chance and
 * the effects that would follow. The chance comes from the answer when it
 * has the branch, otherwise from the forecast itself (NO = 1 − YES). Other
 * questions get none.
 */
export function branchViews(data: ForecastResponse): BranchView[] {
  if (!isBinary(data.forecast.outcomes)) return [];
  const p = Math.min(1, Math.max(0, data.forecast.probability));
  const given = new Map(data.branches.map((b) => [b.outcome.trim().toUpperCase(), b]));
  return (["YES", "NO"] as const).map((outcome) => {
    const branch = given.get(outcome);
    return {
      outcome,
      probability: branch ? branch.probability : outcome === "YES" ? p : 1 - p,
      effects: branch?.effects ?? [],
    };
  });
}

/** "If YES · 31%". */
export function branchTitle(outcome: string, probability: number): string {
  return `If ${outcome.toUpperCase()} · ${formatProbability(probability)}`;
}

/** The two chances of a yes/no question, for the outcome bars. */
export function outcomeChances(
  forecast: Pick<ForecastResponse["forecast"], "probability" | "outcomes">,
): { outcome: string; probability: number }[] {
  if (!isBinary(forecast.outcomes)) return [];
  const p = Math.min(1, Math.max(0, forecast.probability));
  return [
    { outcome: "YES", probability: p },
    { outcome: "NO", probability: 1 - p },
  ];
}

/** Whether the full question adds anything to the short title. */
export function questionAddsDetail(shortTitle: string, question: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(question) !== "" && norm(question) !== norm(shortTitle);
}
