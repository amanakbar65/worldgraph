/**
 * Example api.opportunities answers for this feature's tests, modelled on
 * the sample data (and one live draft, which has no analysis yet).
 */
import type { ForecastSummary, OpportunitiesResponse, Profile, StorySummary } from "@/api/contract";

import type { OpportunityItem } from "./opportunity-data";

export const NOW = Date.parse("2026-10-14T12:00:00Z");
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: `${partial.headline}, so what.`,
    event_type: "policy-signal",
    impact: "opportunity",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.8,
    importance: 70,
    sectors: ["manufacturing"],
    first_seen: hoursAgo(6),
    region: { id: "region:in", name: "India", subtype: "country", country_id: "region:in" },
    lon: 78,
    lat: 21,
    source_count: 8,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

export const RBI: ForecastSummary = {
  id: "forecast:rbi-repo-cut",
  short_title: "Will the RBI cut the repo rate at its next review?",
  question: "Will the Reserve Bank of India lower the repo rate at its next policy review?",
  category: "finance",
  probability: 0.29,
  change_24h: -0.12,
  volume: 88_000,
  volume_unit: "MANA",
  liquidity: 9_000,
  thin: false,
  end_date: hoursAgo(-24 * 20),
  updated_at: hoursAgo(0.2),
  provider: "manifold",
  provider_name: "Manifold",
  url: null,
  region: null,
  lon: null,
  lat: null,
  sparkline: [0.4, 0.35, 0.29],
  is_sample: false,
};

export const RUPEE: OpportunityItem = {
  story: story({
    id: "story:rupee-firms",
    headline: "Rupee firms as a softer dollar draws funds into India",
    so_what: "A firmer rupee trims India's oil and electronics import bills.",
    event_type: "price-move",
    sectors: ["finance", "manufacturing", "energy"],
    region: { id: "region:in-mh.mumbai", name: "Mumbai", subtype: "city", country_id: "region:in" },
    horizon: "now",
  }),
  why_now: "A firmer rupee trims India's oil and electronics import bills.",
  suits: ["Finance", "Manufacturing", "Energy"],
  forecast: RBI,
  momentum: 0.84,
  relevance: 0.77,
};

export const TRADE_DEAL: OpportunityItem = {
  story: story({
    id: "story:us-india-trade-deal",
    headline: "Officials signal a first-stage US–India trade deal is close",
    so_what: "Lower tariffs would restore Indian exporters' price edge.",
    sectors: ["logistics-trade", "manufacturing"],
    region: { id: "region:in-dl.new-delhi", name: "New Delhi", subtype: "city", country_id: "region:in" },
  }),
  why_now: "Lower tariffs would restore Indian exporters' price edge.",
  suits: ["Logistics and Trade", "Manufacturing", "Apparel and textiles"],
  forecast: null,
  momentum: 0.9,
  relevance: 0.67,
};

export const APPAREL: OpportunityItem = {
  story: story({
    id: "story:apparel-orders",
    kind: "projected",
    headline: "Indian apparel exporters could quickly win back US orders",
    so_what: "Garment makers in Tiruppur could refill order books within weeks.",
    event_type: "projected-impact",
    sectors: ["manufacturing", "consumer"],
    first_seen: null,
    confidence: 0.55,
  }),
  why_now: "Garment makers in Tiruppur could refill order books within weeks.",
  suits: ["Manufacturing", "Consumer", "Apparel and textiles"],
  forecast: null,
  momentum: 0.81,
  relevance: 0.39,
};

/** A live story straight from the news pipeline: no analysis yet. */
export const DRAFT: OpportunityItem = {
  story: story({
    id: "story:live-draft-solar",
    headline: "State announces rooftop solar subsidy top-up for small firms",
    so_what: null,
    impact: "opportunity",
    direction: null,
    magnitude: null,
    horizon: null,
    confidence: null,
    sectors: ["energy"],
    analysed: false,
    is_sample: false,
  }),
  why_now: "State announces rooftop solar subsidy top-up for small firms",
  suits: ["Energy"],
  forecast: null,
  momentum: 0.95,
  relevance: 0.3,
};

export const ITEMS: OpportunityItem[] = [RUPEE, TRADE_DEAL, APPAREL, DRAFT];
export const RESPONSE: OpportunitiesResponse = { items: ITEMS };

export const PROFILE: Profile = {
  name: null,
  sectors: ["manufacturing", "logistics-trade"],
  locations: ["region:in-gj"],
  suppliers: ["region:cn"],
  markets: ["region:us"],
  inputs: ["commodity:cotton"],
  competitors: [],
  keywords: ["tariffs"],
};
