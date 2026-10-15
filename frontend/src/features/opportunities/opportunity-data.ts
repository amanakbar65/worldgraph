/**
 * Pure data shaping for Opportunities: the request, which wedge each story
 * sits in, who it suits, why it fits the viewer, and the words the radar
 * and the cards use for the two scores.
 */
import {
  SECTOR_IDS,
  type OpportunitiesResponse,
  type Profile,
  type RpcArgs,
  type SectorId,
  type StorySummary,
  type TimeWindow,
} from "@/api/contract";
import { formatProbability } from "@/lib/format";
import { SECTORS } from "@/lib/icons";
import { isEmpty, profilePlaces } from "@/state/profile";

import type { RadarInput, RadarMeasure } from "./radar";

export type OpportunityItem = OpportunitiesResponse["items"][number];

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface OpportunityQuery {
  /** The sector lens (empty = all sectors). */
  sectors: readonly SectorId[];
  profile: Profile;
  /** Rank by fit to the profile (only when it has something in it). */
  forYou: boolean;
  /** Only the profile's places (where you operate, buy and sell). */
  placesOnly: boolean;
  window: TimeWindow;
  sample: boolean | undefined;
}

/** True when the profile can rank the list (it holds something). */
export const canRankForYou = (profile: Profile) => !isEmpty(profile);

/** api.opportunities arguments; empty lists are left out so equal requests share a cache entry. */
export function opportunitiesArgs(q: OpportunityQuery): RpcArgs["opportunities"] {
  const args: RpcArgs["opportunities"] = { window: q.window };
  if (q.sectors.length) args.sectors = SECTOR_IDS.filter((s) => q.sectors.includes(s));
  const places = profilePlaces(q.profile);
  if (q.placesOnly && places.length) args.regions = places;
  if (q.forYou && canRankForYou(q.profile)) args.profile = q.profile;
  if (q.sample !== undefined) args.sample = q.sample;
  return args;
}

// ---------------------------------------------------------------------------
// The radar
// ---------------------------------------------------------------------------

/** The radar's wedges: the sector lens when it's on, else all nine (in the fixed order). */
export function radarSectors(lens: readonly SectorId[]): SectorId[] {
  const on = SECTOR_IDS.filter((s) => lens.includes(s));
  return on.length ? on : [...SECTOR_IDS];
}

/**
 * The one wedge a story sits in: its main (first) sector that is on the
 * radar. Null when none is.
 */
export function primarySector(story: Pick<StorySummary, "sectors">, onRadar: readonly SectorId[]): SectorId | null {
  return story.sectors.find((s) => onRadar.includes(s)) ?? null;
}

/** The radar's input: each story once, in list order, in its wedge. */
export function radarInputs(items: readonly OpportunityItem[], onRadar: readonly SectorId[]): RadarInput[] {
  const seen = new Set<string>();
  const out: RadarInput[] = [];
  for (const item of items) {
    if (seen.has(item.story.id)) continue;
    const sector = primarySector(item.story, onRadar);
    if (!sector) continue;
    seen.add(item.story.id);
    out.push({ id: item.story.id, sector, relevance: item.relevance, momentum: item.momentum });
  }
  return out;
}

const SHORT_LABELS: Partial<Record<SectorId, string>> = {
  "agri-food": "Agri-food",
  "logistics-trade": "Logistics",
};

/** Rough width of a label in pixels (to choose the long or the short name). */
export const textWidth = (text: string, fontPx: number) => text.length * fontPx * 0.58;

/** A sector's name on the rim: the full name when it fits the arc, else a short one. */
export function rimLabel(sector: SectorId, roomPx: number, fontPx = 12): string {
  const full = SECTORS[sector].label;
  if (textWidth(full, fontPx) <= roomPx) return full;
  return SHORT_LABELS[sector] ?? full;
}

/** How many stories sit in each wedge. */
export function wedgeCounts(inputs: readonly RadarInput[]): Partial<Record<SectorId, number>> {
  const counts: Partial<Record<SectorId, number>> = {};
  for (const i of inputs) counts[i.sector] = (counts[i.sector] ?? 0) + 1;
  return counts;
}

/** Names for the two scores, depending on whether the profile ranks the list. */
export function scoreNames(forYou: boolean): Record<RadarMeasure, string> {
  return { relevance: forYou ? "Fit" : "Importance", momentum: "Momentum" };
}

/** One line on how to read the radar. */
export function radarCaption(measure: RadarMeasure, forYou: boolean): string {
  const fit = forYou ? "a better fit for your business" : "more important";
  return measure === "relevance"
    ? `Closer to the centre: ${fit}. Bigger dot: gaining pace faster.`
    : `Closer to the centre: gaining pace faster. Bigger dot: ${fit}.`;
}

/** "Rupee firms…: Finance, fit 84%, momentum 94%, crowd forecast 58%" for a dot or a row. */
export function describeItem(item: OpportunityItem, sector: SectorId | null, forYou: boolean): string {
  const names = scoreNames(forYou);
  const parts = [item.story.headline];
  if (sector) parts.push(SECTORS[sector].label);
  if (!item.story.analysed) parts.push("draft awaiting analysis");
  else if (item.story.kind === "projected") parts.push("projected");
  parts.push(`${names.relevance.toLowerCase()} ${formatProbability(item.relevance)}`);
  parts.push(`momentum ${formatProbability(item.momentum)}`);
  if (item.forecast) parts.push(`crowd forecast ${formatProbability(item.forecast.probability)}`);
  if (item.story.is_sample) parts.push("sample data");
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface SuitChip {
  label: string;
  /** Set when the name is one of the nine sectors (it gets the sector's icon). */
  sector: SectorId | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SECTOR_BY_NAME: Map<string, SectorId> = new Map(
  SECTOR_IDS.flatMap((id) => [
    [norm(SECTORS[id].label), id] as const,
    [norm(id), id] as const,
  ]),
);

/** "Who it suits" as chips: sector names get their sector (and icon); the rest stay words. Each once. */
export function suitChips(suits: readonly string[]): SuitChip[] {
  const out: SuitChip[] = [];
  for (const raw of suits) {
    const label = raw.trim();
    if (!label) continue;
    const sector = SECTOR_BY_NAME.get(norm(label)) ?? null;
    const key = sector ?? norm(label);
    if (out.some((c) => (c.sector ?? norm(c.label)) === key)) continue;
    out.push({ label: sector ? SECTORS[sector].label : label, sector });
  }
  return out;
}

/** What the "why now" line may show: never a stand-in for a draft that isn't analysed yet. */
export function whyNow(item: OpportunityItem): string | null {
  if (!item.story.analysed) return null;
  const text = item.why_now.trim();
  return text && text !== item.story.headline.trim() ? text : null;
}

export interface OpportunitySummary {
  total: number;
  projected: number;
  withForecast: number;
  sample: boolean;
}

export function summarise(items: readonly OpportunityItem[]): OpportunitySummary {
  return {
    total: items.length,
    projected: items.filter((i) => i.story.kind === "projected").length,
    withForecast: items.filter((i) => i.forecast !== null).length,
    sample: items.some((i) => i.story.is_sample || i.forecast?.is_sample === true),
  };
}
