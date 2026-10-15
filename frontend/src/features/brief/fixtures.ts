/** An example api.brief answer for this folder's tests. */
import type { BriefResponse, CascadeResponse, Profile } from "@/api/contract";
import { DRAFT, INDIA, NOW, OPEC_FORECAST, SAMPLE_FORECAST, iso, story } from "@/features/ask/fixtures";

export { NOW };

export const RISK = story({ id: "story:opec-extends-cuts", headline: "OPEC+ delegates signal output cuts will be extended" });
export const RISK_2 = story({
  id: "story:arabica-record",
  headline: "Arabica futures climb toward their record as Brazil trims its crop",
  sectors: ["agri-food"],
});
export const OPPORTUNITY = story({
  id: "story:us-india-trade-deal",
  headline: "Officials signal a first-stage US–India trade deal is close",
  so_what: "Lower tariffs would restore Indian exporters' price edge.",
  impact: "opportunity",
  sectors: ["logistics-trade"],
});
export const FOCUS = story({
  id: "story:asia-europe-rates",
  headline: "Asia–Europe container rates jump as ships sail around Africa",
  sectors: ["logistics-trade"],
  first_seen: iso(30),
});
export { DRAFT, INDIA, OPEC_FORECAST, SAMPLE_FORECAST };

export const BRIEF: BriefResponse = {
  generated_at: new Date(NOW).toISOString(),
  cards: [
    { kind: "top_risks", stories: [RISK, RISK_2] },
    { kind: "top_opportunities", stories: [OPPORTUNITY] },
    { kind: "biggest_movers", stories: [DRAFT, RISK] },
    { kind: "odds_moved", forecasts: [OPEC_FORECAST, SAMPLE_FORECAST] },
    { kind: "cascade_to_watch", focus: FOCUS, effects: 6 },
    { kind: "region_spotlight", region: INDIA, stories: [OPPORTUNITY], score: 0.4 },
  ],
};

export const EMPTY_BRIEF: BriefResponse = {
  generated_at: new Date(NOW).toISOString(),
  cards: [
    { kind: "top_risks", stories: [] },
    { kind: "top_opportunities", stories: [] },
    { kind: "biggest_movers", stories: [] },
    { kind: "odds_moved", forecasts: [] },
    { kind: "cascade_to_watch", focus: null, effects: 0 },
    { kind: "region_spotlight", region: null, stories: [], score: 0 },
  ],
};

export const EFFECT = story({
  id: "story:indian-engineering-margins",
  headline: "Indian engineering exporters report thinner margins on Europe orders",
});

export const CASCADE: CascadeResponse = {
  focus: FOCUS.id,
  nodes: [
    { ...FOCUS, depth: 0 },
    { ...EFFECT, depth: 1 },
  ],
  links: [
    {
      id: 7,
      src: FOCUS.id,
      dst: EFFECT.id,
      link_type: "inferred",
      mechanism: "raises delivered costs",
      direction: "up",
      confidence: 0.7,
      lag_days: 14,
      forecast_id: null,
      outcome: null,
      evidence: [],
    },
  ],
  branches: [],
};

export const PROFILE: Profile = {
  name: "Rao Textiles",
  sectors: ["manufacturing"],
  locations: ["region:in-gj"],
  inputs: ["commodity:cotton"],
  suppliers: [],
  markets: ["region:de"],
  competitors: [],
  keywords: [],
};
