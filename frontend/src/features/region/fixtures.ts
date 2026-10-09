/**
 * Example api.region / api.compare / api.search answers for this feature's
 * tests, modelled on the sample data (India, Gujarat, the United States).
 */
import type {
  CompareResponse,
  ForecastSummary,
  GraphData,
  Kpi,
  RegionRef,
  RegionResponse,
  SearchResponse,
  SectorPulse,
  StorySummary,
} from "@/api/contract";
import { SECTOR_IDS } from "@/api/contract";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

export const INDIA: RegionRef = { id: "region:in", name: "India", subtype: "country", country_id: "region:in" };
export const GUJARAT: RegionRef = { id: "region:in-gj", name: "Gujarat", subtype: "state", country_id: "region:in" };
export const AHMEDABAD: RegionRef = {
  id: "region:in-gj.ahmedabad",
  name: "Ahmedabad",
  subtype: "city",
  country_id: "region:in",
};
export const USA: RegionRef = { id: "region:us", name: "United States of America", subtype: "country", country_id: "region:us" };

export function kpi(partial: Partial<Kpi> & Pick<Kpi, "id" | "name">): Kpi {
  return {
    unit: "%",
    latest: 3.4,
    previous: 3.1,
    change: 0.3,
    as_of: "2026-09-30",
    higher_is: "worse",
    series: [3.0, 3.1, 3.2, 3.1, 3.4].map((v, i) => ({ d: `2026-0${5 + i}-01`, v })),
    source_name: "Sample statistics office",
    is_sample: true,
    ...partial,
  };
}

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Exporters gain wider market access within months.",
    event_type: "policy-signal",
    impact: "opportunity",
    direction: "up",
    magnitude: 3,
    horizon: "months",
    confidence: 0.7,
    importance: 60,
    sectors: ["logistics-trade"],
    first_seen: iso(13),
    region: { id: "region:in-dl.new-delhi", name: "New Delhi", subtype: "city", country_id: "region:in" },
    lon: 77.2,
    lat: 28.6,
    source_count: 3,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

export function forecast(partial: Partial<ForecastSummary> & Pick<ForecastSummary, "id" | "short_title">): ForecastSummary {
  return {
    question: `${partial.short_title}?`,
    category: "economy",
    probability: 0.29,
    change_24h: -0.12,
    volume: 88_000,
    volume_unit: "MANA",
    liquidity: 12_000,
    thin: false,
    end_date: new Date(NOW + 34 * 86_400_000).toISOString(),
    updated_at: iso(0.2),
    provider: "manifold",
    provider_name: "Manifold",
    url: null,
    region: INDIA,
    lon: 78,
    lat: 22,
    sparkline: [0.4, 0.35, 0.29],
    is_sample: false,
    ...partial,
  };
}

export function pulse(overrides: Partial<Record<(typeof SECTOR_IDS)[number], Partial<SectorPulse>>> = {}): SectorPulse[] {
  return SECTOR_IDS.map((sector) => ({ sector, impact: "neutral", direction: null, count: 0, score: 0, ...overrides[sector] }));
}

const INDIA_GRAPH: GraphData = {
  nodes: [
    { id: "region:in", type: "region", subtype: "country", name: "India", degree: 9, impact: null, created_at: null, is_sample: false },
    { id: "region:in-gj", type: "region", subtype: "state", name: "Gujarat", degree: 3, impact: null, created_at: null, is_sample: false },
    { id: "org:adani-ports", type: "organization", subtype: null, name: "Adani Ports and SEZ", degree: 4, impact: null, created_at: null, is_sample: false },
    { id: "commodity:rice", type: "commodity", subtype: null, name: "Rice", degree: 3, impact: null, created_at: null, is_sample: false },
    { id: "forecast:rbi-cut", type: "forecast", subtype: null, name: "Will the RBI cut the repo rate?", degree: 2, impact: null, created_at: null, is_sample: true },
    { id: "story:trade-deal", type: "story", subtype: "event", name: "US–India trade deal is close", degree: 2, impact: "opportunity", created_at: iso(13), is_sample: true },
    { id: "story:rice-curbs", type: "story", subtype: "event", name: "India signals rice export curbs", degree: 2, impact: "risk", created_at: iso(48), is_sample: true },
  ],
  links: [
    { source: "region:in-gj", target: "region:in", type: "part_of", causal: false, confidence: null, created_at: null },
    { source: "org:adani-ports", target: "region:in", type: "located_in", causal: false, confidence: null, created_at: null },
    { source: "region:in", target: "commodity:rice", type: "produces", causal: false, confidence: null, created_at: null },
    { source: "forecast:rbi-cut", target: "region:in", type: "about", causal: false, confidence: null, created_at: null },
    { source: "story:trade-deal", target: "region:in", type: "located_in", causal: false, confidence: null, created_at: null },
    { source: "story:rice-curbs", target: "commodity:rice", type: "mentions", causal: false, confidence: null, created_at: null },
    { source: "story:trade-deal", target: "story:rice-curbs", type: "inferred", causal: true, confidence: 0.55, created_at: null },
  ],
};

export const REGION_INDIA: RegionResponse = {
  region: { id: "region:in", name: "India", subtype: "country", qid: "Q668", lon: 79.36, lat: 22.69, population: null, breadcrumb: [] },
  kpis: [
    kpi({ id: "indicator:in-cpi", name: "Inflation" }),
    kpi({ id: "indicator:in-policy-rate", name: "Policy rate", latest: 5.25, previous: 5.26, change: -0.01, higher_is: "neutral" }),
    kpi({ id: "indicator:in-fx", name: "Indian rupee per USD", unit: "INR per USD", latest: 88.4, previous: 88.79, change: -0.39 }),
    kpi({ id: "indicator:in-power-demand", name: "Peak power demand", unit: "GW", latest: 252, previous: 250, change: 2, higher_is: "neutral" }),
  ],
  kpi_scope: "region:in",
  sector_pulse: pulse({
    energy: { impact: "opportunity", direction: "up", count: 7, score: 0.53 },
    "agri-food": { impact: "risk", direction: "up", count: 3, score: -0.42 },
    finance: { impact: "risk", direction: "down", count: 2, score: -0.01 },
    tech: { direction: "down" },
  }),
  stories: [
    story({ id: "story:trade-deal", headline: "Officials signal a first-stage US–India trade deal is close" }),
    story({ id: "story:rice-curbs", headline: "India signals possible curbs on rice exports", impact: "risk", direction: "up", event_type: "policy-signal" }),
    story({
      id: "story:port-draft",
      headline: "Mundra port handles record container volumes in September",
      so_what: null,
      impact: "neutral",
      direction: null,
      analysed: false,
      is_sample: false,
    }),
    ...[4, 5, 6].map((i) => story({ id: `story:extra-${i}`, headline: `Extra story number ${i} about Indian markets` })),
  ],
  decisions: [
    forecast({ id: "forecast:rbi-cut", short_title: "RBI cuts the repo rate at its next review" }),
    forecast({ id: "forecast:power-270", short_title: "Peak power demand above 270 GW this season", probability: 0.46, change_24h: 0.16 }),
  ],
  children: [
    { id: "region:in-dl", name: "Delhi", subtype: "state", lon: 77.1, lat: 28.6, count: 5, risk: 3, opportunity: 2, neutral: 0, score: -0.2 },
    { id: "region:in-gj", name: "Gujarat", subtype: "state", lon: 71.3, lat: 22.75, count: 4, risk: 0, opportunity: 4, neutral: 0, score: 1 },
    ...["Kerala", "Goa", "Assam", "Bihar", "Punjab"].map((name) => ({
      id: `region:in-${name.slice(0, 2).toLowerCase()}`,
      name,
      subtype: "state",
      lon: null,
      lat: null,
      count: 0,
      risk: 0,
      opportunity: 0,
      neutral: 0,
      score: 0,
    })),
  ],
  graph: INDIA_GRAPH,
};

/** A city whose KPIs fall back to its country's. */
export const REGION_AHMEDABAD: RegionResponse = {
  ...REGION_INDIA,
  region: {
    id: "region:in-gj.ahmedabad",
    name: "Ahmedabad",
    subtype: "city",
    qid: "Q1070",
    lon: 72.58,
    lat: 23.03,
    population: 5_375_000,
    breadcrumb: [INDIA, GUJARAT],
  },
  kpi_scope: "region:in",
  stories: [],
  decisions: [],
  children: [],
  graph: { nodes: [], links: [] },
};

export const COMPARE: CompareResponse = {
  regions: [
    {
      region: INDIA,
      kpis: REGION_INDIA.kpis,
      sector_pulse: REGION_INDIA.sector_pulse,
      counts: { risk: 5, opportunity: 11, neutral: 1 },
    },
    {
      region: USA,
      kpis: [
        kpi({ id: "indicator:us-cpi", name: "Inflation", latest: 2.8, change: -0.1 }),
        kpi({ id: "indicator:us-policy-rate", name: "Policy rate", latest: 3.75, change: -0.01, higher_is: "neutral" }),
        kpi({ id: "indicator:us-diesel", name: "Diesel price", unit: "USD/gallon", latest: 3.89, change: 0.03 }),
      ],
      sector_pulse: pulse({ energy: { count: 0, direction: "down" }, tech: { impact: "opportunity", count: 2, score: 0.8, direction: "up" } }),
      counts: { risk: 2, opportunity: 9, neutral: 1 },
    },
    {
      region: GUJARAT,
      kpis: [
        kpi({ id: "indicator:in-gj-industrial-power", name: "Industrial power price", unit: "INR/kWh", latest: 8, change: 0.03 }),
        kpi({ id: "indicator:in-gj-power-demand", name: "Peak power demand", unit: "GW", latest: 25.1, change: 0.3, higher_is: "neutral" }),
      ],
      sector_pulse: pulse({ energy: { impact: "opportunity", count: 2, score: 1, direction: "up" } }),
      counts: { risk: 0, opportunity: 4, neutral: 0 },
    },
  ],
};

export const SEARCH: SearchResponse = {
  results: [
    { id: "region:de", type: "region", subtype: "country", name: "Germany", context: "Country · Western Europe", score: 0.95 },
    { id: "region:in", type: "region", subtype: "country", name: "India", context: "Country · South Asia", score: 0.6 },
    { id: "region:br-mg", type: "region", subtype: "state", name: "Minas Gerais", context: "State · Brazil", score: 0.5 },
  ],
};
