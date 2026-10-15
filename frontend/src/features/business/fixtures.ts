/**
 * Example api.affects / api.cascade / api.entity / api.forecast answers for
 * My Business tests, modelled on the sample data (plus one live draft).
 */
import type {
  AffectsResponse,
  CascadeResponse,
  EntityResponse,
  ForecastResponse,
  ForecastSummary,
  Profile,
  StorySummary,
} from "@/api/contract";

export const NOW = Date.parse("2026-10-14T12:00:00Z");
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: `${partial.headline}: what it means.`,
    event_type: "disruption",
    impact: "risk",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.75,
    importance: 70,
    sectors: ["logistics-trade"],
    first_seen: hoursAgo(5),
    region: { id: "region:ye", name: "Yemen", subtype: "country", country_id: "region:ye" },
    lon: 45,
    lat: 15,
    source_count: 6,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

export function forecast(partial: Partial<ForecastSummary> & Pick<ForecastSummary, "id" | "short_title">): ForecastSummary {
  return {
    question: `${partial.short_title} (full question)`,
    category: "trade",
    probability: 0.4,
    change_24h: 0.02,
    volume: 52_000,
    volume_unit: "MANA",
    liquidity: 4_000,
    thin: false,
    end_date: hoursAgo(-24 * 30),
    updated_at: hoursAgo(0.5),
    provider: "manifold",
    provider_name: "Manifold",
    url: null,
    region: null,
    lon: null,
    lat: null,
    sparkline: [0.38, 0.4],
    is_sample: false,
    ...partial,
  };
}

export const PROFILE: Profile = {
  name: null,
  sectors: ["logistics-trade", "manufacturing"],
  locations: ["region:in-gj"],
  suppliers: ["region:cn"],
  markets: ["region:us"],
  inputs: ["commodity:crude-oil", "infra:bab-el-mandeb"],
  competitors: [],
  keywords: ["freight"],
};

export const RED_SEA = story({
  id: "story:red-sea-attacks",
  headline: "Attacks near Bab-el-Mandeb push container lines onto the Cape route",
  so_what: "Asia–Europe voyages lengthen, tightening ship capacity and raising freight costs.",
  first_seen: hoursAgo(3),
});

export const FREIGHT = story({
  id: "story:freight-rates-jump",
  headline: "Asia–Europe container rates jump as ships reroute",
  so_what: "Exporters face higher freight bills on Europe-bound orders.",
  event_type: "price-move",
  first_seen: hoursAgo(2),
  region: { id: "region:cn-sh.shanghai", name: "Shanghai", subtype: "city", country_id: "region:cn" },
});

export const RUPEE = story({
  id: "story:rupee-firms",
  headline: "Rupee firms as a softer dollar draws funds into India",
  so_what: "A firmer rupee trims import bills for manufacturers.",
  impact: "opportunity",
  sectors: ["finance", "manufacturing"],
  first_seen: hoursAgo(30),
  region: { id: "region:in-mh.mumbai", name: "Mumbai", subtype: "city", country_id: "region:in" },
});

/** Live, not analysed yet. */
export const DRAFT = story({
  id: "story:live-port-strike",
  headline: "Dockworkers at Mundra port begin a two-day strike",
  so_what: null,
  impact: "neutral",
  direction: null,
  horizon: null,
  confidence: null,
  analysed: false,
  is_sample: false,
  first_seen: hoursAgo(1),
  region: { id: "region:in-gj.kutch", name: "Kutch", subtype: "city", country_id: "region:in" },
});

export const OPEC = forecast({
  id: "forecast:opec-cuts",
  short_title: "Will OPEC+ extend its output cuts?",
  category: "energy",
  probability: 0.72,
  change_24h: 0.16,
});

export const AFFECTS: AffectsResponse = {
  items: [
    {
      story: RED_SEA,
      matched: [
        { id: "infra:bab-el-mandeb", type: "infrastructure", subtype: "strait", name: "Bab-el-Mandeb Strait" },
        { id: "sector:logistics-trade", type: "sector", subtype: null, name: "Logistics and trade" },
      ],
      path: [RED_SEA.id],
      relevance: 0.88,
      actions: ["Check contracts for war-risk surcharge clauses", "Add two weeks to Europe lead times"],
    },
    {
      story: FREIGHT,
      matched: [{ id: "infra:bab-el-mandeb", type: "infrastructure", subtype: "strait", name: "Bab-el-Mandeb Strait" }],
      path: [RED_SEA.id, FREIGHT.id],
      relevance: 0.74,
      actions: ["Lock in freight rates for Q1"],
    },
    {
      story: RUPEE,
      matched: [{ id: "sector:manufacturing", type: "sector", subtype: null, name: "Manufacturing" }],
      path: [RUPEE.id],
      relevance: 0.52,
      actions: ["Review currency hedge ratios"],
    },
    {
      story: DRAFT,
      matched: [{ id: "region:in-gj", type: "region", subtype: "state", name: "Gujarat" }],
      path: [DRAFT.id],
      relevance: 0.6,
      actions: ["Should not show for a draft"],
    },
  ],
  suggested_forecasts: [OPEC],
};

export const CASCADE: CascadeResponse = {
  focus: FREIGHT.id,
  nodes: [
    { ...RED_SEA, depth: -1 },
    { ...FREIGHT, depth: 0 },
  ],
  links: [
    {
      id: 11,
      src: RED_SEA.id,
      dst: FREIGHT.id,
      link_type: "inferred",
      mechanism: "longer shipping routes",
      direction: "up",
      confidence: 0.7,
      lag_days: 3,
      forecast_id: null,
      outcome: null,
      evidence: [],
    },
  ],
  branches: [],
};

export const INDIA_ENTITY: EntityResponse = {
  entity: {
    id: "region:in",
    type: "region",
    subtype: "country",
    name: "India",
    summary: null,
    qid: "Q668",
    aliases: [],
    facts: [],
    lon: 78,
    lat: 21,
    is_sample: false,
  },
  timeline: [DRAFT, RUPEE],
  backlinks: [],
  forecasts: [],
  indicators: [],
  graph: { nodes: [], links: [] },
};

export const OPEC_DETAIL: ForecastResponse = {
  forecast: { ...OPEC, history: [], outcomes: ["YES", "NO"], resolution_rule: null, entities: [], stories: [] },
  branches: [],
};
