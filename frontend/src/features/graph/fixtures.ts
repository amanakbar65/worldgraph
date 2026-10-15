/** Test data for the graph and entity pages (shaped like the api's answers). */
import type {
  EntityResponse,
  ForecastSummary,
  GraphLink,
  GraphNode,
  GraphResponse,
  HistoryPoint,
  Kpi,
  LocalGraphResponse,
  StorySummary,
} from "@/api/contract";

export const NOW = Date.parse("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

export function node(partial: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "name">): GraphNode {
  return { subtype: null, degree: 1, impact: null, created_at: null, is_sample: true, ...partial };
}

export function link(source: string, target: string, type = "mentions", extra: Partial<GraphLink> = {}): GraphLink {
  const causal = ["reported", "inferred", "projected", "conditional"].includes(type);
  return { source, target, type, causal, confidence: causal ? 0.7 : null, created_at: null, ...extra };
}

/** A small world: India, oil, a port, two stories (one causes the other), a forecast. */
export const GRAPH: GraphResponse = {
  nodes: [
    node({ id: "region:in", type: "region", subtype: "country", name: "India", degree: 5, created_at: hoursAgo(2000) }),
    node({ id: "commodity:crude-oil", type: "commodity", name: "Crude oil", degree: 4, created_at: hoursAgo(2000) }),
    node({ id: "infra:mundra-port", type: "infrastructure", subtype: "port", name: "Mundra Port", degree: 2 }),
    node({
      id: "story:red-sea-attacks",
      type: "story",
      subtype: "event",
      name: "Red Sea attacks push shipping onto longer routes",
      degree: 3,
      impact: "risk",
      created_at: hoursAgo(72),
    }),
    node({
      id: "story:freight-rates-rise",
      type: "story",
      subtype: "event",
      name: "Freight rates to Europe climb",
      degree: 3,
      impact: "opportunity",
      created_at: hoursAgo(24),
    }),
    node({
      id: "forecast:opec-cut",
      type: "forecast",
      name: "Will OPEC+ extend its output cuts?",
      degree: 2,
      created_at: hoursAgo(500),
    }),
  ],
  links: [
    link("story:red-sea-attacks", "region:in"),
    link("story:red-sea-attacks", "commodity:crude-oil"),
    link("story:freight-rates-rise", "region:in"),
    link("story:freight-rates-rise", "infra:mundra-port"),
    link("infra:mundra-port", "region:in", "located_in"),
    link("story:red-sea-attacks", "story:freight-rates-rise", "inferred", { confidence: 0.62 }),
    link("forecast:opec-cut", "commodity:crude-oil", "about"),
    link("forecast:opec-cut", "region:in", "about"),
  ],
  truncated: false,
};

export const LOCAL: LocalGraphResponse = {
  focus: "commodity:crude-oil",
  nodes: GRAPH.nodes,
  links: GRAPH.links,
  truncated: false,
};

export function story(partial: Partial<StorySummary> & Pick<StorySummary, "id" | "headline">): StorySummary {
  return {
    kind: "event",
    so_what: "Shipping costs rise for importers.",
    event_type: "supply-chain",
    impact: "risk",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.7,
    importance: 60,
    sectors: ["energy"],
    first_seen: hoursAgo(5),
    region: { id: "region:in", name: "India", subtype: "country", country_id: "region:in" },
    lon: 72.8,
    lat: 19,
    source_count: 3,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

const HISTORY: HistoryPoint[] = [
  { ts: "2026-08-16T00:00:00Z", p: 0.48 },
  { ts: "2026-09-16T00:00:00Z", p: 0.55 },
  { ts: "2026-10-15T00:00:00Z", p: 0.72 },
];

export const FORECAST: ForecastSummary & { history: HistoryPoint[] } = {
  id: "forecast:opec-cut",
  short_title: "OPEC+ extends output cuts",
  question: "Will OPEC+ extend its output cuts at the next meeting?",
  category: "commodities",
  probability: 0.72,
  change_24h: 0.16,
  volume: 412_000,
  volume_unit: "MANA",
  liquidity: 1000,
  thin: false,
  end_date: "2026-11-07T00:00:00Z",
  updated_at: hoursAgo(1),
  provider: "sample",
  provider_name: "Sample forecast",
  url: null,
  region: null,
  lon: null,
  lat: null,
  sparkline: [0.48, 0.55, 0.72],
  is_sample: true,
  history: HISTORY,
};

export const BRENT: Kpi = {
  id: "indicator:brent-crude",
  name: "Brent crude",
  unit: "USD/bbl",
  latest: 78.2,
  previous: 76.6,
  change: 1.6,
  as_of: "2026-10-15",
  higher_is: "worse",
  series: [
    { d: "2026-10-13", v: 76.1 },
    { d: "2026-10-14", v: 76.6 },
    { d: "2026-10-15", v: 78.2 },
  ],
  source_name: "Sample series",
  is_sample: true,
};

export const CRUDE: EntityResponse = {
  entity: {
    id: "commodity:crude-oil",
    type: "commodity",
    subtype: null,
    name: "Crude oil",
    summary: "Unrefined petroleum; priced mainly off the Brent and WTI benchmarks.",
    qid: null,
    aliases: ["Brent", "WTI", "oil"],
    facts: [
      { label: "Type", value: "Commodity" },
      { label: "HS code", value: "2709" },
      { label: "Produced in", value: "India, Saudi Arabia" },
      { label: "Sectors", value: "Energy" },
    ],
    lon: null,
    lat: null,
    is_sample: true,
  },
  timeline: [
    story({ id: "story:red-sea-attacks", headline: "Red Sea attacks push shipping onto longer routes" }),
    story({
      id: "story:refinery-outage-draft",
      headline: "Refinery outage reported at Jamnagar complex",
      so_what: null,
      analysed: false,
      impact: "neutral",
      direction: null,
      confidence: null,
    }),
  ],
  backlinks: [
    { id: "forecast:opec-cut", type: "forecast", name: "Will OPEC+ extend its output cuts?", edge_type: "about" },
    { id: "indicator:brent-crude", type: "indicator", name: "Brent crude", edge_type: "about" },
    { id: "region:in", type: "region", name: "India", edge_type: "produces" },
    { id: "region:sa", type: "region", name: "Saudi Arabia", edge_type: "produces" },
    { id: "org:ongc", type: "organization", name: "ONGC", edge_type: "produces" },
  ],
  forecasts: [FORECAST],
  indicators: [BRENT],
  graph: {
    nodes: [
      node({ id: "commodity:crude-oil", type: "commodity", name: "Crude oil", degree: 4 }),
      node({ id: "region:in", type: "region", subtype: "country", name: "India", degree: 5 }),
      node({ id: "region:sa", type: "region", subtype: "country", name: "Saudi Arabia", degree: 3 }),
      node({ id: "sector:energy", type: "sector", name: "Energy", degree: 9 }),
      node({ id: "story:red-sea-attacks", type: "story", name: "Red Sea attacks", impact: "risk", degree: 2 }),
    ],
    links: [
      link("region:in", "commodity:crude-oil", "produces"),
      link("region:sa", "commodity:crude-oil", "produces"),
      link("commodity:crude-oil", "sector:energy", "in_sector"),
      link("story:red-sea-attacks", "commodity:crude-oil"),
    ],
  },
};

/** An indicator's page: it measures the UAE, and its own figure comes from the UAE's page. */
export const UAE_CPI: EntityResponse = {
  entity: {
    id: "indicator:ae-cpi",
    type: "indicator",
    subtype: "monthly",
    name: "Inflation",
    summary: null,
    qid: null,
    aliases: [],
    facts: [{ label: "Type", value: "Indicator · Monthly" }],
    lon: null,
    lat: null,
    is_sample: true,
  },
  timeline: [],
  backlinks: [],
  forecasts: [],
  indicators: [],
  graph: {
    nodes: [
      node({ id: "indicator:ae-cpi", type: "indicator", name: "Inflation" }),
      node({ id: "region:ae", type: "region", subtype: "country", name: "United Arab Emirates" }),
    ],
    links: [link("indicator:ae-cpi", "region:ae", "about")],
  },
};

export const UAE: EntityResponse = {
  ...UAE_CPI,
  entity: { ...UAE_CPI.entity, id: "region:ae", type: "region", subtype: "country", name: "United Arab Emirates", facts: [] },
  indicators: [{ ...BRENT, id: "indicator:ae-cpi", name: "Inflation", unit: "%", latest: 2.2, previous: 2.1, change: 0.1 }],
};
