/**
 * Pure data shaping for Compare: lining up the same indicator across
 * regions (Inflation next to Inflation), the sector pulse side by side, and
 * adding or removing regions.
 */
import { SECTOR_IDS, type CompareResponse, type Kpi, type RegionRef, type SectorId, type TimeWindow } from "@/api/contract";

import { shapeSectorPulse, type ImpactCounts, type PulseTile } from "./region-data";

export const MAX_COMPARE = 3;
export const MIN_COMPARE = 2;

export type CompareRegion = CompareResponse["regions"][number];

// ---------------------------------------------------------------------------
// Which indicator is which
// ---------------------------------------------------------------------------

/** Indicators that measure the same thing under another name. */
const KEY_ALIASES: Record<string, string> = {
  "ecb-rate": "policy-rate",
  "deposit-rate": "policy-rate",
  "repo-rate": "policy-rate",
  inflation: "cpi",
  "cpi-inflation": "cpi",
  "exchange-rate": "fx",
};

/** Row names for indicators that appear under several names. */
const ROW_LABELS: Record<string, string> = {
  cpi: "Inflation",
  "policy-rate": "Policy rate",
  fx: "Currency per US dollar",
  pmi: "Manufacturing PMI",
  diesel: "Diesel price",
  petrol: "Petrol price",
  "power-demand": "Power demand",
  "industrial-power": "Industrial power price",
};

const suffixOf = (id: string | null | undefined) => (id ? id.replace(/^region:/, "") : null);

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * What an indicator measures, independent of the place: "indicator:in-cpi"
 * and "indicator:us-cpi" are both "cpi". Indicator ids start with the
 * region's id (a state's own, or its country's when the KPIs fall back);
 * anything else is matched by its name.
 */
export function kpiKey(kpi: Pick<Kpi, "id" | "name">, region: Pick<RegionRef, "id" | "country_id">): string {
  const local = kpi.id.replace(/^[a-z_]+:/, "");
  const prefixes = [suffixOf(region.id), suffixOf(region.country_id)]
    .filter((p): p is string => !!p)
    .map((p) => `${p}-`)
    .sort((a, b) => b.length - a.length); // the most specific place first
  for (const prefix of prefixes) {
    if (local.startsWith(prefix) && local.length > prefix.length) {
      const key = local.slice(prefix.length);
      return KEY_ALIASES[key] ?? key;
    }
  }
  return `name:${normaliseName(kpi.name)}`;
}

/**
 * True when a state's or city's KPIs are its country's (api.compare doesn't
 * say, so we read it off the indicator ids).
 */
export function usesCountryFigures(region: Pick<RegionRef, "id" | "subtype" | "country_id">, kpis: readonly Pick<Kpi, "id">[]): boolean {
  if (region.subtype === "country" || region.subtype === "bloc") return false;
  const own = suffixOf(region.id);
  const country = suffixOf(region.country_id);
  if (!country || country === own || kpis.length === 0) return false;
  return kpis.every((k) => {
    const local = k.id.replace(/^[a-z_]+:/, "");
    return local.startsWith(`${country}-`) && !local.startsWith(`${own}-`);
  });
}

// ---------------------------------------------------------------------------
// KPI rows
// ---------------------------------------------------------------------------

export interface KpiRow {
  key: string;
  /** What the row measures, e.g. "Inflation". */
  label: string;
  /** One cell per region, in column order; null where that region has no such figure. */
  cells: (Kpi | null)[];
  /** How many regions have this figure. */
  shared: number;
}

/**
 * Line up the regions' KPIs so the same indicator sits in the same row.
 * Rows that more regions share come first; ties keep the order the
 * database ranked them in. A null region (a column still loading) gets
 * null cells.
 */
export function alignKpis(regions: readonly (Pick<CompareRegion, "region" | "kpis"> | null)[]): KpiRow[] {
  interface Draft {
    key: string;
    cells: (Kpi | null)[];
    /** Best (lowest) position any region gave it. */
    rank: number;
    /** When the row was first met, to keep ties stable. */
    created: number;
    names: Map<string, number>;
  }
  const rows = new Map<string, Draft>();
  regions.forEach((r, col) => {
    r?.kpis.forEach((kpi, rank) => {
      const key = kpiKey(kpi, r.region);
      let row = rows.get(key);
      if (!row) {
        row = { key, cells: regions.map(() => null), rank, created: rows.size, names: new Map() };
        rows.set(key, row);
      }
      row.rank = Math.min(row.rank, rank);
      // One figure per region per row: the first, as the database ranks them.
      if (row.cells[col] === null) row.cells[col] = kpi;
      row.names.set(kpi.name, (row.names.get(kpi.name) ?? 0) + 1);
    });
  });
  return [...rows.values()]
    .map((row) => ({ ...row, shared: row.cells.filter((c) => c !== null).length }))
    .sort((a, b) => b.shared - a.shared || a.rank - b.rank || a.created - b.created)
    .map((row) => {
      const common = [...row.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.key;
      return { key: row.key, label: ROW_LABELS[row.key] ?? common, cells: row.cells, shared: row.shared };
    });
}

// ---------------------------------------------------------------------------
// Sector pulse, side by side
// ---------------------------------------------------------------------------

export interface PulseRow {
  sector: SectorId;
  label: string;
  /** One tile per region, in column order (null while that column loads). */
  cells: (PulseTile | null)[];
  /** Bar length per cell: its story count relative to the busiest cell in the row (0..1). */
  shares: number[];
}

export function comparePulseRows(
  regions: readonly (Pick<CompareRegion, "sector_pulse"> | null)[],
  window: TimeWindow,
): PulseRow[] {
  const shaped = regions.map((r) => (r ? shapeSectorPulse(r.sector_pulse, window) : null));
  return SECTOR_IDS.map((sector, i) => {
    const cells = shaped.map((tiles) => (tiles ? tiles[i] : null));
    const max = Math.max(0, ...cells.map((c) => c?.count ?? 0));
    return {
      sector,
      label: cells.find((c) => c)?.label ?? sector,
      cells,
      shares: cells.map((c) => (c && max > 0 ? c.count / max : 0)),
    };
  });
}

// ---------------------------------------------------------------------------
// Story counts
// ---------------------------------------------------------------------------

/** The largest story total among the columns, for bars on a shared scale. */
export function maxTotal(counts: readonly (ImpactCounts | null)[]): number {
  return Math.max(0, ...counts.map((c) => (c ? c.risk + c.opportunity + c.neutral : 0)));
}

// ---------------------------------------------------------------------------
// Choosing regions
// ---------------------------------------------------------------------------

/** Add a region (no repeats, at most three). */
export function addRegion(ids: readonly string[], id: string): string[] {
  if (ids.includes(id) || ids.length >= MAX_COMPARE) return [...ids];
  return [...ids, id];
}

export function removeRegion(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

/** Clean ids from a link or a caller: no repeats, at most three. */
export function cleanIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_COMPARE);
}

/** The columns' data in the order of `ids` (null while a new column loads). */
export function columnsFor(ids: readonly string[], data: CompareResponse | undefined): (CompareRegion | null)[] {
  const byId = new Map((data?.regions ?? []).map((r) => [r.region.id, r]));
  return ids.map((id) => byId.get(id) ?? null);
}
