/**
 * What each colour means, in one place.
 *
 * Colour is reserved for meaning: impact (risk, opportunity, neutral),
 * forecasts (crowd odds) and entity types. Components take the Tailwind
 * classes or CSS variables from here instead of naming colours themselves,
 * and always pair them with an icon or ▲ ▼ (see `icons.ts`).
 *
 * The class strings are written out in full so Tailwind's scanner finds them.
 */
import type { Direction, EntityType, Horizon, Impact, Kpi, LinkType } from "@/api/contract";
import { formatProbability } from "@/lib/format";

/** One meaning colour, ready to use as classes or as a CSS variable. */
export interface Tone {
  /** Readable label, e.g. "Risk". */
  label: string;
  /** Custom property name, e.g. "--risk". */
  cssVar: string;
  /** `var(--risk)`, for SVG attributes and inline styles. */
  color: string;
  /** Text and icon colour. */
  text: string;
  /** Solid fill for marks (dots, bars). */
  bg: string;
  /** A quiet 12 % wash for badges and chip backgrounds. */
  tint: string;
  /** A soft border in the same hue. */
  border: string;
  /** SVG fill and stroke. */
  fill: string;
  stroke: string;
}

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

export const IMPACT_TONES: Record<Impact, Tone> = {
  risk: {
    label: "Risk",
    cssVar: "--risk",
    color: "var(--risk)",
    text: "text-risk",
    bg: "bg-risk",
    tint: "bg-risk/12",
    border: "border-risk/40",
    fill: "fill-risk",
    stroke: "stroke-risk",
  },
  opportunity: {
    label: "Opportunity",
    cssVar: "--opportunity",
    color: "var(--opportunity)",
    text: "text-opportunity",
    bg: "bg-opportunity",
    tint: "bg-opportunity/12",
    border: "border-opportunity/40",
    fill: "fill-opportunity",
    stroke: "stroke-opportunity",
  },
  neutral: {
    label: "Neutral",
    cssVar: "--neutral",
    color: "var(--neutral)",
    text: "text-neutral",
    bg: "bg-neutral",
    tint: "bg-neutral/12",
    border: "border-neutral/40",
    fill: "fill-neutral",
    stroke: "stroke-neutral",
  },
};

/** Crowd forecasts: violet, with the crowd icon and a ring shape. */
export const FORECAST_TONE: Tone = {
  label: "Crowd forecast",
  cssVar: "--forecast",
  color: "var(--forecast)",
  text: "text-forecast",
  bg: "bg-forecast",
  tint: "bg-forecast/12",
  border: "border-forecast/40",
  fill: "fill-forecast",
  stroke: "stroke-forecast",
};

export function impactTone(impact: Impact): Tone {
  return IMPACT_TONES[impact] ?? IMPACT_TONES.neutral;
}

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_TONES: Record<EntityType, Tone> = {
  region: {
    label: "Region",
    cssVar: "--type-region",
    color: "var(--type-region)",
    text: "text-type-region",
    bg: "bg-type-region",
    tint: "bg-type-region/12",
    border: "border-type-region/40",
    fill: "fill-type-region",
    stroke: "stroke-type-region",
  },
  organization: {
    label: "Organisation",
    cssVar: "--type-organization",
    color: "var(--type-organization)",
    text: "text-type-organization",
    bg: "bg-type-organization",
    tint: "bg-type-organization/12",
    border: "border-type-organization/40",
    fill: "fill-type-organization",
    stroke: "stroke-type-organization",
  },
  person: {
    label: "Person",
    cssVar: "--type-person",
    color: "var(--type-person)",
    text: "text-type-person",
    bg: "bg-type-person",
    tint: "bg-type-person/12",
    border: "border-type-person/40",
    fill: "fill-type-person",
    stroke: "stroke-type-person",
  },
  commodity: {
    label: "Commodity",
    cssVar: "--type-commodity",
    color: "var(--type-commodity)",
    text: "text-type-commodity",
    bg: "bg-type-commodity",
    tint: "bg-type-commodity/12",
    border: "border-type-commodity/40",
    fill: "fill-type-commodity",
    stroke: "stroke-type-commodity",
  },
  sector: {
    label: "Sector",
    cssVar: "--type-sector",
    color: "var(--type-sector)",
    text: "text-type-sector",
    bg: "bg-type-sector",
    tint: "bg-type-sector/12",
    border: "border-type-sector/40",
    fill: "fill-type-sector",
    stroke: "stroke-type-sector",
  },
  infrastructure: {
    label: "Infrastructure",
    cssVar: "--type-infrastructure",
    color: "var(--type-infrastructure)",
    text: "text-type-infrastructure",
    bg: "bg-type-infrastructure",
    tint: "bg-type-infrastructure/12",
    border: "border-type-infrastructure/40",
    fill: "fill-type-infrastructure",
    stroke: "stroke-type-infrastructure",
  },
  policy: {
    label: "Policy",
    cssVar: "--type-policy",
    color: "var(--type-policy)",
    text: "text-type-policy",
    bg: "bg-type-policy",
    tint: "bg-type-policy/12",
    border: "border-type-policy/40",
    fill: "fill-type-policy",
    stroke: "stroke-type-policy",
  },
  indicator: {
    label: "Indicator",
    cssVar: "--type-indicator",
    color: "var(--type-indicator)",
    text: "text-type-indicator",
    bg: "bg-type-indicator",
    tint: "bg-type-indicator/12",
    border: "border-type-indicator/40",
    fill: "fill-type-indicator",
    stroke: "stroke-type-indicator",
  },
  // Stories are coloured by their impact; this is the fallback.
  story: { ...IMPACT_TONES.neutral, label: "Story" },
  forecast: { ...FORECAST_TONE, label: "Forecast" },
  user_entity: {
    label: "Your business",
    cssVar: "--type-user",
    color: "var(--type-user)",
    text: "text-type-user",
    bg: "bg-type-user",
    tint: "bg-type-user/12",
    border: "border-type-user/40",
    fill: "fill-type-user",
    stroke: "stroke-type-user",
  },
};

export function entityTypeTone(type: EntityType): Tone {
  return ENTITY_TYPE_TONES[type] ?? IMPACT_TONES.neutral;
}

// ---------------------------------------------------------------------------
// Causal link types
// ---------------------------------------------------------------------------

export type LineStyle = "solid" | "dashed" | "dotted";

export interface LinkTypeInfo {
  label: string;
  /** One short sentence for tooltips and legends. */
  description: string;
  line: LineStyle;
  /** SVG `stroke-dasharray` for a 2 px line (undefined = solid). */
  dasharray: string | undefined;
}

/** Facts, inferences and projections stay visibly apart: solid, dashed, dotted. */
export const LINK_TYPES: Record<LinkType, LinkTypeInfo> = {
  reported: {
    label: "Reported",
    description: "A source reports this link.",
    line: "solid",
    dasharray: undefined,
  },
  inferred: {
    label: "Inferred",
    description: "Our analysis infers this link; no source states it.",
    line: "dashed",
    dasharray: "6 4",
  },
  projected: {
    label: "Projected",
    description: "A possible next effect that hasn't happened yet.",
    line: "dotted",
    dasharray: "0.5 4.5",
  },
  conditional: {
    label: "Conditional",
    description: "Happens only if a crowd forecast resolves one way.",
    line: "dotted",
    dasharray: "0.5 4.5",
  },
};

// ---------------------------------------------------------------------------
// Horizon and direction
// ---------------------------------------------------------------------------

export const HORIZON_LABELS: Record<Horizon, { label: string; description: string }> = {
  now: { label: "Now", description: "Effects within days" },
  weeks: { label: "Weeks", description: "Effects within weeks" },
  months: { label: "Months", description: "Effects over months" },
};

export const DIRECTION_ARROWS: Record<Direction, string> = { up: "▲", down: "▼" };
export const DIRECTION_WORDS: Record<Direction, string> = { up: "rising", down: "falling" };

/**
 * The impact a KPI change carries: up on a "worse" indicator is a risk,
 * up on a "better" one is an opportunity, and the reverse when it falls.
 */
export function kpiChangeImpact(change: number | null, higherIs: Kpi["higher_is"]): Impact {
  if (change === null || change === 0 || higherIs === "neutral") return "neutral";
  const up = change > 0;
  if (higherIs === "worse") return up ? "risk" : "opportunity";
  return up ? "opportunity" : "risk";
}

// ---------------------------------------------------------------------------
// Forecasts
// ---------------------------------------------------------------------------

/** Accessible name for a forecast: "62% crowd forecast, up 8 points in 24 hours, thin market". */
export function describeForecast(probability: number, change24h?: number | null, thin?: boolean): string {
  const parts = [`${formatProbability(probability)} crowd forecast`];
  if (change24h !== undefined && change24h !== null) {
    const points = Math.round(change24h * 100);
    parts.push(
      points === 0
        ? "unchanged in 24 hours"
        : `${points > 0 ? "up" : "down"} ${Math.abs(points)} point${Math.abs(points) === 1 ? "" : "s"} in 24 hours`,
    );
  }
  if (thin) parts.push("thin market");
  return parts.join(", ");
}
