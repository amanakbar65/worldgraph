/**
 * Example api.ask_context / api.brief data for this folder's tests, modelled
 * on the sample "fuel costs in India" storyline.
 */
import type {
  AskContextResponse,
  CascadeLink,
  ForecastSummary,
  RegionRef,
  StorySummary,
} from "@/api/contract";

export const NOW = Date.parse("2026-10-15T09:00:00Z");
export const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

export const INDIA: RegionRef = { id: "region:in", name: "India", subtype: "country", country_id: "region:in" };
export const LONDON: RegionRef = { id: "region:gb-lnd.london", name: "London", subtype: "city", country_id: "region:gb" };

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Fuel-heavy businesses face higher costs within weeks.",
    event_type: "price-move",
    impact: "risk",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.7,
    importance: 60,
    sectors: ["energy"],
    first_seen: iso(6),
    region: INDIA,
    lon: 77.2,
    lat: 28.6,
    source_count: 3,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

export type AskStoryFixture = AskContextResponse["stories"][number];

export function askStory(
  partial: Partial<AskStoryFixture> & Pick<AskStoryFixture, "id" | "headline">,
): AskStoryFixture {
  return {
    ...story(partial),
    sources: [
      { source_name: "Sample Wire", title: partial.headline, url: "https://example.com/a", published_at: iso(6) },
      { source_name: "Sample Wire", title: partial.headline, url: "https://example.com/b", published_at: iso(5) },
      { source_name: "Sample Daily", title: partial.headline, url: null, published_at: null },
    ],
    actions: ["Lock in fuel contracts early"],
    ...partial,
  };
}

export const BRENT = askStory({
  id: "story:brent-multi-month-high",
  headline: "Brent crude climbs to a multi-month high on tighter supply",
  region: LONDON,
  first_seen: iso(96),
});
export const JET_FUEL = askStory({
  id: "story:singapore-jet-fuel-climbs",
  headline: "Asian jet fuel prices climb, raising airline operating costs",
  first_seen: iso(48),
});
export const SURCHARGE = askStory({
  id: "story:indian-airlines-surcharges",
  headline: "Indian airlines could raise fuel surcharges on fares",
  kind: "projected",
  first_seen: null,
});
/** A live story the AI hasn't analysed yet: its so-what and actions must never reach the model. */
export const DRAFT = askStory({
  id: "story:live-diesel-mumbai",
  headline: "Diesel prices rise again in Mumbai as state oil firms revise rates",
  so_what: "Leaked text that must not be used",
  analysed: false,
  is_sample: false,
  actions: ["Should not be sent"],
  impact: "neutral",
  direction: null,
});

export function link(partial: Partial<CascadeLink> & Pick<CascadeLink, "id" | "src" | "dst">): CascadeLink {
  return {
    link_type: "inferred",
    mechanism: "lifts jet fuel prices",
    direction: "up",
    confidence: 0.853,
    lag_days: 1,
    forecast_id: null,
    outcome: null,
    evidence: [
      { source_name: "Sample evidence", url: null, published_at: null, snippet: "One sentence.", is_sample: true },
    ],
    ...partial,
  };
}

export const L_BRENT_JET = link({ id: 127, src: BRENT.id, dst: JET_FUEL.id, link_type: "reported" });
export const L_JET_SURCHARGE = link({
  id: 128,
  src: JET_FUEL.id,
  dst: SURCHARGE.id,
  link_type: "projected",
  mechanism: "pushes up fares",
  confidence: 0.45,
});
/** A link to a story outside the context: dropped before the AI sees it. */
export const L_OUTSIDE = link({ id: 129, src: BRENT.id, dst: "story:somewhere-else" });

export const OPEC_FORECAST: ForecastSummary = {
  id: "forecast:opec-extends-cuts",
  short_title: "OPEC+ extends output cuts into next year",
  question: "Will OPEC+ extend its output cuts into next year?",
  category: "energy",
  probability: 0.6234,
  change_24h: 0.05,
  volume: 52_340.6,
  volume_unit: "MANA",
  liquidity: 9_000,
  thin: false,
  end_date: iso(-24 * 60),
  updated_at: iso(1),
  provider: "manifold",
  provider_name: "Manifold",
  url: "https://manifold.markets/example",
  region: null,
  lon: null,
  lat: null,
  sparkline: [0.5, 0.55, 0.62],
  is_sample: false,
};

export const SAMPLE_FORECAST: ForecastSummary = {
  ...OPEC_FORECAST,
  id: "forecast:india-peak-power",
  short_title: "India's peak power demand above 270 GW",
  question: "Will India's peak power demand exceed 270 GW this season?",
  probability: 0.46,
  change_24h: 0.16,
  volume: 58_000,
  volume_unit: null,
  provider: "sample",
  provider_name: "Sample forecast",
  url: null,
  is_sample: true,
};

export const CONTEXT: AskContextResponse = {
  entities: [{ id: "commodity:crude-oil", type: "commodity", subtype: null, name: "Crude oil" }],
  stories: [BRENT, JET_FUEL, SURCHARGE, DRAFT],
  links: [L_BRENT_JET, L_JET_SURCHARGE, L_OUTSIDE],
  forecasts: [OPEC_FORECAST, SAMPLE_FORECAST],
};

export const EMPTY_CONTEXT: AskContextResponse = { entities: [], stories: [], links: [], forecasts: [] };
