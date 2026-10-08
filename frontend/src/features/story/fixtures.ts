/**
 * Example api.story / api.cascade answers for this feature's tests, modelled
 * on the sample "Asia–Europe container rates" storyline.
 */
import type {
  CascadeLink,
  CascadeResponse,
  ForecastSummary,
  RegionRef,
  StoryResponse,
  StorySummary,
} from "@/api/contract";

const NOW = Date.parse("2026-10-08T12:00:00Z");
export const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

export const SHANGHAI: RegionRef = { id: "region:cn-sh", name: "Shanghai", subtype: "state", country_id: "region:cn" };
export const NETHERLANDS: RegionRef = { id: "region:nl", name: "Netherlands", subtype: "country", country_id: "region:nl" };
export const EGYPT: RegionRef = { id: "region:eg", name: "Egypt", subtype: "country", country_id: "region:eg" };

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Importers face higher landed costs within days.",
    event_type: "price-move",
    impact: "risk",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.7,
    importance: 50,
    sectors: ["logistics-trade"],
    first_seen: iso(6),
    region: SHANGHAI,
    lon: 121.5,
    lat: 31.2,
    source_count: 4,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

export const FORECAST: ForecastSummary = {
  id: "forecast:suez-transits-recover",
  short_title: "Suez transits recover within six months",
  question: "Will weekly Suez Canal container transits return to their pre-disruption average within six months?",
  category: "trade",
  probability: 0.31,
  change_24h: -0.02,
  volume: 186_000,
  volume_unit: null,
  liquidity: 26_000,
  thin: false,
  end_date: iso(-24 * 180),
  updated_at: iso(1),
  provider: "sample",
  provider_name: "Sample",
  url: null,
  region: EGYPT,
  lon: 32.35,
  lat: 30.6,
  sparkline: [0.4, 0.35, 0.31],
  is_sample: true,
};

function link(partial: Partial<CascadeLink> & Pick<CascadeLink, "id" | "src" | "dst">): CascadeLink {
  return {
    link_type: "inferred",
    mechanism: "raises delivered costs",
    direction: "up",
    confidence: 0.6,
    lag_days: 7,
    forecast_id: null,
    outcome: null,
    evidence: [
      {
        source_name: "Sample evidence",
        url: null,
        published_at: null,
        snippet: "Sample evidence: carriers cited the Cape diversion when announcing surcharges.",
        is_sample: true,
      },
    ],
    ...partial,
  };
}

export const FOCUS_ID = "story:asia-europe-rates-jump";

export const CASCADE: CascadeResponse = {
  focus: FOCUS_ID,
  nodes: [
    { ...story({ id: "story:red-sea-attacks-reroute", headline: "Red Sea attacks push carriers around Africa", region: EGYPT }), depth: -1 },
    { ...story({ id: "story:brent-multi-month-high", headline: "Brent crude climbs to a multi-month high", sectors: ["energy"] }), depth: -1 },
    {
      ...story({ id: FOCUS_ID, headline: "Asia–Europe container rates jump as ships sail around Africa", importance: 75 }),
      depth: 0,
    },
    { ...story({ id: "story:rotterdam-congestion", headline: "Rotterdam berths bunch up as delayed ships arrive", region: NETHERLANDS, importance: 60 }), depth: 1 },
    { ...story({ id: "story:indian-exporters-margin-squeeze", headline: "Indian exporters report thinner margins on Europe orders", direction: "down", importance: 55 }), depth: 1 },
    {
      ...story({
        id: "story:freight-rates-ease-on-return",
        kind: "projected",
        headline: "Freight rates could ease if ships return to Suez",
        impact: "opportunity",
        direction: "down",
        first_seen: null,
        importance: 40,
      }),
      depth: 1,
    },
    {
      ...story({ id: "story:surcharges-persist", kind: "projected", headline: "Surcharges and long transits would persist", first_seen: null, importance: 35 }),
      depth: 1,
    },
    {
      ...story({ id: "story:europe-retail-restock-delays", kind: "projected", headline: "European retailers may face restock delays", first_seen: null, importance: 30 }),
      depth: 2,
    },
  ],
  links: [
    link({ id: 174, src: "story:red-sea-attacks-reroute", dst: FOCUS_ID, link_type: "reported", mechanism: "lengthens voyage times", confidence: 0.9 }),
    link({ id: 129, src: "story:brent-multi-month-high", dst: FOCUS_ID, mechanism: "adds bunker fuel costs", confidence: 0.45 }),
    link({ id: 130, src: "story:brent-multi-month-high", dst: "story:surcharges-persist", link_type: "projected", mechanism: "raises bunker fuel costs", confidence: 0.4 }),
    link({ id: 176, src: FOCUS_ID, dst: "story:rotterdam-congestion", mechanism: "bunches ship arrivals" }),
    link({ id: 177, src: FOCUS_ID, dst: "story:indian-exporters-margin-squeeze", link_type: "reported", direction: "down", confidence: 0.7 }),
    link({
      id: 201,
      src: FOCUS_ID,
      dst: "story:freight-rates-ease-on-return",
      link_type: "conditional",
      mechanism: "frees up ship capacity",
      confidence: 0.5,
      forecast_id: FORECAST.id,
      outcome: "YES",
      evidence: [],
    }),
    link({
      id: 202,
      src: FOCUS_ID,
      dst: "story:surcharges-persist",
      link_type: "conditional",
      mechanism: "keeps routes long",
      confidence: 0.55,
      forecast_id: FORECAST.id,
      outcome: "NO",
      evidence: [],
    }),
    link({ id: 180, src: "story:rotterdam-congestion", dst: "story:europe-retail-restock-delays", link_type: "projected", mechanism: "delays inbound cargo", confidence: 0.4 }),
    // A link to a story that isn't in view is ignored.
    link({ id: 999, src: FOCUS_ID, dst: "story:not-in-view" }),
  ],
  branches: [
    {
      forecast: FORECAST,
      outcomes: [
        { outcome: "NO", probability: 0.69, story_ids: ["story:surcharges-persist"] },
        { outcome: "YES", probability: 0.31, story_ids: ["story:freight-rates-ease-on-return"] },
      ],
    },
  ],
};

export const STORY: StoryResponse = {
  story: {
    ...story({
      id: FOCUS_ID,
      headline: "Asia–Europe container rates jump as ships sail around Africa",
      so_what: "Importers face higher landed costs; spot rates react within days.",
      magnitude: 4,
      confidence: 0.85,
      horizon: "now",
    }),
    actions: ["Lock in contract rates before renewals", "Compare air freight for urgent orders"],
    last_seen: iso(1),
    mention_count: 76,
    sources: [
      { source_name: "Sample Policy Digest", title: "Asia–Europe container rates jump", url: null, published_at: iso(5) },
      { source_name: "Example Freight Weekly", title: "Carriers add Cape surcharges", url: null, published_at: iso(4) },
    ],
    entities: [
      { id: "org:kestrel-lines", type: "organization", subtype: "company", name: "Kestrel Lines" },
      { id: "infra:port-of-rotterdam", type: "infrastructure", subtype: "port", name: "Port of Rotterdam" },
      { id: "region:nl", type: "region", subtype: "country", name: "Netherlands" },
    ],
  },
  forecasts: [FORECAST],
  causes: 2,
  effects: 4,
};

export const DRAFT: StoryResponse = {
  story: {
    ...story({
      id: "story:live-draft-port-strike",
      headline: "Dockworkers at Antwerp begin a 48-hour strike over pay talks, unions say",
      so_what: null,
      impact: "neutral",
      direction: null,
      magnitude: null,
      horizon: null,
      confidence: null,
      region: { id: "region:be", name: "Belgium", subtype: "country", country_id: "region:be" },
      analysed: false,
      is_sample: false,
    }),
    actions: [],
    last_seen: iso(0.1),
    mention_count: 6,
    sources: [
      {
        source_name: "Example Port News",
        title: "Dockworkers at Antwerp begin a 48-hour strike over pay talks",
        url: "https://example.com/antwerp-strike",
        published_at: iso(0.7),
      },
    ],
    entities: [],
  },
  forecasts: [],
  causes: 0,
  effects: 0,
};

export const EMPTY_CASCADE: CascadeResponse = {
  focus: DRAFT.story.id,
  nodes: [{ ...DRAFT.story, depth: 0 }],
  links: [],
  branches: [],
};
