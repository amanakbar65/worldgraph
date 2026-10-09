/** Small, contract-shaped answers for the globe's tests. */
import type { ForecastSummary, GlobeResponse, MetaResponse, StorySummary, TopResponse } from "@/api/contract";

const HOUR = 3_600_000;
/** Now, to the minute (the globe's "new in the last hour" clock ticks by the minute). */
export const NOW = Math.floor(Date.now() / 60_000) * 60_000;
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

export const FORECAST: ForecastSummary = {
  id: "forecast:suez-transits-recover",
  short_title: "Suez transits recover within six months",
  question: "Will Suez Canal transits recover to 2023 levels within six months?",
  category: "trade",
  probability: 0.34,
  change_24h: -0.08,
  volume: 12_400,
  volume_unit: "MANA",
  liquidity: 900,
  thin: false,
  end_date: "2027-04-01T00:00:00Z",
  updated_at: ago(1),
  provider: "sample",
  provider_name: "Sample forecast",
  url: null,
  region: { id: "region:eg", name: "Egypt", subtype: "country", country_id: "region:eg" },
  lon: 32.3,
  lat: 30.6,
  sparkline: [0.4, 0.38, 0.34],
  is_sample: true,
};

export const GLOBE: GlobeResponse = {
  window: "7d",
  events: [
    {
      id: "story:red-sea-attacks",
      lon: 43.3,
      lat: 12.6,
      impact: "risk",
      importance: 92,
      magnitude: 4,
      sectors: ["logistics-trade"],
      first_seen: ago(30),
      headline: "Attacks near Bab-el-Mandeb push container lines onto the Cape route",
      country_id: "region:ye",
    },
    {
      id: "story:india-solar-auction",
      lon: 72.8,
      lat: 19.1,
      impact: "opportunity",
      importance: 64,
      magnitude: 3,
      sectors: ["energy"],
      first_seen: ago(0.5),
      headline: "India's solar auction clears at a record low tariff",
      country_id: "region:in",
    },
    {
      id: "story:rotterdam-rates",
      lon: 4.5,
      lat: 51.9,
      impact: "risk",
      importance: 71,
      magnitude: 3,
      sectors: ["logistics-trade"],
      first_seen: ago(20),
      headline: "Container rates jump on Asia to Europe lanes",
      country_id: "region:nl",
    },
  ],
  arcs: [
    {
      id: 7,
      src_story: "story:red-sea-attacks",
      dst_story: "story:rotterdam-rates",
      src: [43.3, 12.6],
      dst: [4.5, 51.9],
      src_country: "region:ye",
      dst_country: "region:nl",
      link_type: "inferred",
      confidence: 0.72,
      impact: "risk",
    },
  ],
  forecasts: [FORECAST],
  countries: [
    { id: "region:ye", count: 1, risk: 1, opportunity: 0, neutral: 0, score: -1 },
    { id: "region:in", count: 1, risk: 0, opportunity: 1, neutral: 0, score: 1 },
    { id: "region:nl", count: 1, risk: 1, opportunity: 0, neutral: 0, score: -1 },
  ],
};

function story(overrides: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Importers face longer voyages and higher landed costs.",
    event_type: "conflict",
    impact: "risk",
    direction: "up",
    magnitude: 4,
    horizon: "weeks",
    confidence: 0.8,
    importance: 90,
    sectors: ["logistics-trade"],
    first_seen: ago(30),
    region: { id: "region:ye", name: "Yemen", subtype: "country", country_id: "region:ye" },
    lon: 43.3,
    lat: 12.6,
    source_count: 3,
    analysed: true,
    is_sample: true,
    ...overrides,
  };
}

export const TOP: TopResponse = {
  stories: [
    story({
      id: "story:red-sea-attacks",
      headline: "Attacks near Bab-el-Mandeb push container lines onto the Cape route",
    }),
    story({
      id: "story:india-solar-auction",
      headline: "India's solar auction clears at a record low tariff",
      impact: "opportunity",
      region: { id: "region:in", name: "India", subtype: "country", country_id: "region:in" },
      lon: 72.8,
      lat: 19.1,
    }),
  ],
  movers: [FORECAST],
};

/** Live data: one analysed story and one draft from the news pipeline. */
export const TOP_LIVE: TopResponse = {
  stories: [
    story({
      id: "story:live-port-strike",
      headline: "Port workers in Antwerp vote to strike next week",
      is_sample: false,
    }),
    story({
      id: "story:live-draft",
      headline: "Copper smelter halts output after power cut - Reuters",
      so_what: null,
      analysed: false,
      direction: null,
      horizon: null,
      confidence: null,
      is_sample: false,
    }),
  ],
  movers: [],
};

export const META: MetaResponse = {
  generated_at: ago(0),
  data: {
    live_stories: 0,
    sample_stories: 230,
    forecasts: 31,
    entities: 480,
    last_ingest_at: null,
    showing_sample: true,
  },
  sectors: [],
  sources: [],
};
