/**
 * Example api.forecasts / api.forecast answers for this feature's tests,
 * modelled on the sample data and on a live Manifold market.
 */
import type { ForecastResponse, ForecastSummary, StorySummary } from "@/api/contract";

export const NOW = Date.parse("2026-10-14T12:00:00Z");
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
export const daysAhead = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

export function forecast(partial: Partial<ForecastSummary> & Pick<ForecastSummary, "id" | "short_title">): ForecastSummary {
  return {
    question: `${partial.short_title} (full question)`,
    category: "economy",
    probability: 0.5,
    change_24h: 0,
    volume: 50_000,
    volume_unit: null,
    liquidity: 8_000,
    thin: false,
    end_date: daysAhead(20),
    updated_at: hoursAgo(0.2),
    provider: "sample",
    provider_name: "Sample forecast",
    url: null,
    region: null,
    lon: null,
    lat: null,
    sparkline: [0.45, 0.46, 0.48, 0.5],
    is_sample: true,
    ...partial,
  };
}

export const OPEC = forecast({
  id: "forecast:opec-plus-extends-cuts",
  short_title: "OPEC+ extends its output cuts at the next meeting?",
  category: "energy",
  probability: 0.72,
  change_24h: 0.16,
  volume: 412_000,
  end_date: daysAhead(23),
});

export const FED = forecast({
  id: "forecast:fed-cut-next-meeting",
  short_title: "Will the Fed cut rates at its next meeting?",
  question: "Will the US Federal Reserve lower its federal funds target range at its next scheduled policy meeting?",
  category: "finance",
  probability: 0.63,
  change_24h: 0.13,
  volume: 412_000,
  liquidity: 58_000,
  end_date: daysAhead(23),
});

export const RICE = forecast({
  id: "forecast:india-rice-export-curbs",
  short_title: "Will India restrict non-basmati rice exports within three months?",
  category: "trade",
  probability: 0.37,
  change_24h: -0.04,
  volume: 27_000,
  end_date: daysAhead(90),
});

/** A live play-money market with a link to its page. */
export const ECB = forecast({
  id: "forecast:mf-ecb-cut-december",
  short_title: "ECB cuts rates in December?",
  question: "Will the European Central Bank cut its deposit facility rate at its December 2026 meeting?",
  category: "finance",
  probability: 0.35,
  change_24h: -0.14,
  volume: 48_000,
  volume_unit: "MANA",
  liquidity: 2_400,
  end_date: daysAhead(58),
  provider: "manifold",
  provider_name: "Manifold",
  url: "https://manifold.markets/example/ecb-cuts-in-december",
  is_sample: false,
});

/** Low volume: hidden unless thin markets are included. */
export const DUBLIN = forecast({
  id: "forecast:dublin-datacentre-connections",
  short_title: "Dublin grid accepts new data centres within a year?",
  category: "energy",
  probability: 0.19,
  change_24h: -0.3,
  volume: 3_400,
  liquidity: 620,
  thin: true,
  end_date: daysAhead(365),
});

export const LIST: ForecastSummary[] = [OPEC, FED, RICE, ECB, DUBLIN];

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Dollar borrowers could pay less within months.",
    event_type: "policy-signal",
    impact: "opportunity",
    direction: "up",
    magnitude: 3,
    horizon: "months",
    confidence: 0.7,
    importance: 60,
    sectors: ["finance"],
    first_seen: hoursAgo(9),
    region: { id: "region:us.new-york", name: "New York", subtype: "city", country_id: "region:us" },
    lon: -74,
    lat: 40.7,
    source_count: 3,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

type Effect = ForecastResponse["branches"][number]["effects"][number];

export function effect(
  partial: Partial<Effect> & Pick<Effect, "id" | "headline" | "mechanism" | "confidence">,
): Effect {
  return {
    ...story({ kind: "projected", first_seen: null, ...partial }),
    from_story: "story:fed-signals-cut",
    mechanism: partial.mechanism,
    confidence: partial.confidence,
  };
}

export function detail(
  base: ForecastSummary = FED,
  extra: Partial<ForecastResponse["forecast"]> = {},
  branches: ForecastResponse["branches"] = FED_BRANCHES,
): ForecastResponse {
  return {
    forecast: {
      ...base,
      history: [
        { ts: hoursAgo(72), p: 0.5, volume: 300_000 },
        { ts: hoursAgo(48), p: 0.52, volume: 350_000 },
        { ts: hoursAgo(24), p: 0.5, volume: 380_000 },
        { ts: hoursAgo(0.2), p: base.probability, volume: base.volume },
      ],
      outcomes: ["YES", "NO"],
      resolution_rule: "Resolves YES if the Federal Reserve announces a lower target range at its next meeting.",
      entities: [
        { id: "region:us", type: "region", subtype: "country", name: "United States of America" },
        { id: "organization:federal-reserve", type: "organization", subtype: "central-bank", name: "Federal Reserve" },
      ],
      stories: [
        story({ id: "story:treasury-yields-fall", headline: "Short-term Treasury yields fall as investors price a Fed cut" }),
        story({
          id: "story:live-payrolls-draft",
          headline: "US payrolls report shows slower hiring in September",
          so_what: null,
          impact: "neutral",
          direction: null,
          magnitude: null,
          horizon: null,
          confidence: null,
          analysed: false,
          is_sample: false,
        }),
      ],
      ...extra,
    },
    branches,
  };
}

export const FED_BRANCHES: ForecastResponse["branches"] = [
  {
    outcome: "YES",
    probability: 0.63,
    effects: [
      effect({
        id: "story:fed-cut-eases-em-debt",
        headline: "A Fed cut would ease dollar-debt costs for emerging-market firms",
        mechanism: "cheapens dollar funding",
        confidence: 0.55,
      }),
    ],
  },
  {
    outcome: "NO",
    probability: 0.37,
    effects: [
      effect({
        id: "story:fed-hold-revives-dollar",
        headline: "A Fed hold would revive the dollar and squeeze importers",
        mechanism: "revives dollar strength",
        confidence: 0.5,
        impact: "risk",
      }),
    ],
  },
];
