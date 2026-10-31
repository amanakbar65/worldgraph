/**
 * The API contract: one schema per `api.<name>(args jsonb) returns jsonb`
 * function in Postgres. Every way of running the app (Artifact via the
 * Supabase connector, Netlify, local dev) calls the same functions and gets
 * these shapes back.
 *
 * Rules
 * - Every key is always present; "no value" is `null`, never a missing key.
 * - Timestamps are ISO 8601 strings in UTC; dates are YYYY-MM-DD.
 * - Probabilities and confidences are 0..1; importance is 0..100.
 * - Unknown ids make the function raise an error whose message starts with
 *   "Not found" (the client shows a "no longer available" state).
 * - `npm run contracts` exports these to /contracts/*.json for the Python
 *   tests, which check every SQL function against them. Change both together.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export const SECTOR_IDS = [
  "energy",
  "agri-food",
  "manufacturing",
  "logistics-trade",
  "finance",
  "tech",
  "health",
  "real-estate",
  "consumer",
] as const;
export const SectorId = z.enum(SECTOR_IDS);
export type SectorId = z.infer<typeof SectorId>;

export const ENTITY_TYPES = [
  "region",
  "organization",
  "person",
  "commodity",
  "sector",
  "infrastructure",
  "policy",
  "indicator",
  "story",
  "forecast",
  "user_entity",
] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const Impact = z.enum(["risk", "opportunity", "neutral"]);
export type Impact = z.infer<typeof Impact>;
export const Direction = z.enum(["up", "down"]);
export type Direction = z.infer<typeof Direction>;
export const Horizon = z.enum(["now", "weeks", "months"]);
export type Horizon = z.infer<typeof Horizon>;
export const LinkType = z.enum(["reported", "inferred", "projected", "conditional"]);
export type LinkType = z.infer<typeof LinkType>;
export const TimeWindow = z.enum(["24h", "7d", "30d"]);
export type TimeWindow = z.infer<typeof TimeWindow>;
export const ForecastCategory = z.enum([
  "economy",
  "finance",
  "policy",
  "politics",
  "geopolitics",
  "trade",
  "tech",
  "commodities",
  "energy",
]);
export type ForecastCategory = z.infer<typeof ForecastCategory>;

const Iso = z.string(); // ISO 8601 timestamp
const Id = z.string().regex(/^[a-z_]+:[a-z0-9][a-z0-9.-]*$/);
const Prob = z.number().min(0).max(1);
const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const RegionRef = z.object({
  id: Id,
  name: z.string(),
  subtype: z.string(), // country | state | city
  country_id: Id.nullable(),
});
export type RegionRef = z.infer<typeof RegionRef>;

export const EntityRef = z.object({
  id: Id,
  type: EntityType,
  subtype: z.string().nullable(),
  name: z.string(),
});
export type EntityRef = z.infer<typeof EntityRef>;

export const StorySummary = z.object({
  id: Id,
  kind: z.enum(["event", "projected"]),
  headline: z.string(),
  so_what: z.string().nullable(), // null until analysed
  event_type: z.string(),
  impact: Impact,
  direction: Direction.nullable(),
  magnitude: z.number().int().min(1).max(5).nullable(),
  horizon: Horizon.nullable(),
  confidence: Prob.nullable(),
  importance: z.number().min(0).max(100),
  sectors: z.array(SectorId),
  first_seen: Iso.nullable(), // null for projected stories
  region: RegionRef.nullable(),
  lon: Lon.nullable(),
  lat: Lat.nullable(),
  source_count: z.number().int().min(0),
  analysed: z.boolean(), // AI analysis done (or sample)
  is_sample: z.boolean(),
});
export type StorySummary = z.infer<typeof StorySummary>;

export const HistoryPoint = z.object({ ts: Iso, p: Prob });
export type HistoryPoint = z.infer<typeof HistoryPoint>;

export const ForecastSummary = z.object({
  id: Id,
  short_title: z.string(), // ≤ 12 words
  question: z.string(),
  category: ForecastCategory,
  probability: Prob, // P(YES), latest snapshot
  change_24h: z.number().min(-1).max(1).nullable(), // in probability units (0.08 = ▲ 8 points)
  volume: z.number().min(0).nullable(),
  volume_unit: z.string().nullable(), // "USD", "MANA", "sample credits" (invented); null when not reported
  liquidity: z.number().min(0).nullable(),
  thin: z.boolean(), // below the liquidity/volume threshold
  end_date: Iso.nullable(),
  updated_at: Iso.nullable(), // last snapshot time
  provider: z.string(), // "manifold" | "polymarket" | "sample" …
  provider_name: z.string(), // display name for attribution
  url: z.string().nullable(), // null when linking is not allowed or sample
  region: RegionRef.nullable(),
  lon: Lon.nullable(),
  lat: Lat.nullable(),
  sparkline: z.array(Prob), // ≤ 30 evenly spaced points, oldest first
  is_sample: z.boolean(),
});
export type ForecastSummary = z.infer<typeof ForecastSummary>;

export const KpiPoint = z.object({ d: z.string(), v: z.number() });
export const Kpi = z.object({
  id: Id, // indicator node id
  name: z.string(), // short label, e.g. "Inflation"
  unit: z.string(), // "%", "USD/bbl", "INR/litre", "GW" …
  latest: z.number(),
  previous: z.number().nullable(),
  change: z.number().nullable(), // latest − previous, in unit
  as_of: z.string(), // date of latest point
  higher_is: z.enum(["better", "worse", "neutral"]),
  series: z.array(KpiPoint), // ≤ 60 points, oldest first
  source_name: z.string(),
  is_sample: z.boolean(),
});
export type Kpi = z.infer<typeof Kpi>;

export const SectorPulse = z.object({
  sector: SectorId,
  impact: Impact, // dominant impact in the window
  direction: Direction.nullable(), // momentum vs the previous window
  count: z.number().int().min(0),
  score: z.number(), // −1 (all risk) … +1 (all opportunity)
});
export type SectorPulse = z.infer<typeof SectorPulse>;

export const GraphNode = z.object({
  id: Id,
  type: EntityType,
  subtype: z.string().nullable(),
  name: z.string(),
  degree: z.number().int().min(0),
  impact: Impact.nullable(), // stories only
  created_at: Iso.nullable(), // for the time-lapse
  is_sample: z.boolean(),
});
export type GraphNode = z.infer<typeof GraphNode>;

/** +1: the effect moves the same way as the cause (▲ same way); −1: the opposite way (▼). */
export const Polarity = z.union([z.literal(1), z.literal(-1)]);
export type Polarity = z.infer<typeof Polarity>;

export const GraphLink = z.object({
  source: Id,
  target: Id,
  type: z.string(), // edge type (located_in, mentions…) or causal link type
  causal: z.boolean(),
  confidence: Prob.nullable(),
  created_at: Iso.nullable(),
  // Since 0022 (api.graph, api.local_graph and the graphs in api.entity
  // always send these; api.region's own graph doesn't yet, and an older
  // database doesn't either, so they are optional here):
  id: z.number().int().optional(), // edge id, or causal_link id when `causal`
  relation: z.string().optional(), // relation key (schema.relations[].key): the edge type, or "drives"
  polarity: Polarity.nullable().optional(), // causal links; null when unknown or not causal
  strength: Prob.nullable().optional(), // causal links: own strength, else confidence; null otherwise
  delayed: z.boolean().nullable().optional(), // causal links: lag_days > 0; null when unknown
  // Since 0023 (kg.provenance; false while it is off). Edge links also carry
  // the edge's own confidence in `confidence` when it has one.
  weak: z.boolean().optional(), // show the "?" badge: confidence < 0.5, or a causal link with no evidence
});
export type GraphLink = z.infer<typeof GraphLink>;

export const GraphData = z.object({ nodes: z.array(GraphNode), links: z.array(GraphLink) });
export type GraphData = z.infer<typeof GraphData>;

export const Evidence = z.object({
  source_name: z.string(),
  url: z.string().nullable(),
  published_at: Iso.nullable(),
  snippet: z.string(),
  is_sample: z.boolean(),
});
export type Evidence = z.infer<typeof Evidence>;

export const CascadeLink = z.object({
  id: z.number().int(),
  src: Id,
  dst: Id,
  link_type: LinkType,
  mechanism: z.string(), // 2–4 words
  direction: Direction,
  confidence: Prob,
  lag_days: z.number().int().nullable(),
  forecast_id: Id.nullable(), // conditional links only
  outcome: z.string().nullable(), // "YES" | "NO" for conditional links
  evidence: z.array(Evidence),
  // Since 0022 (api.cascade sends them; api.ask_context doesn't yet):
  relation: z.string().optional(), // "drives"
  polarity: Polarity.nullable().optional(),
  strength: Prob.optional(), // own strength, else confidence
  delayed: z.boolean().nullable().optional(), // lag_days > 0
  weak: z.boolean().optional(), // since 0023: confidence < 0.5 or no evidence ("?" badge; kg.provenance)
});
export type CascadeLink = z.infer<typeof CascadeLink>;

export const SourceRef = z.object({
  source_name: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  published_at: Iso.nullable(),
});
export type SourceRef = z.infer<typeof SourceRef>;

// ---------------------------------------------------------------------------
// Knowledge graph schema (migrations 0021–0022). The single source is
// backend/src/worldgraph/schema/types.yaml: node types with their typed
// properties, and named relations with readable labels both ways.
// ---------------------------------------------------------------------------

export const PROPERTY_KINDS = ["text", "number", "date", "choice", "url", "place", "entity"] as const;
export const PropertyKind = z.enum(PROPERTY_KINDS);
export type PropertyKind = z.infer<typeof PropertyKind>;

/**
 * One property of a node type (api.schema). Values: text and url are
 * strings; number a number; date "YYYY", "YYYY-MM" or "YYYY-MM-DD"; choice
 * one of `choices` by key; place a region id; entity a node id (of
 * `entity_types` when given). `multiple`: a list of these.
 */
export const PropertyDef = z.object({
  key: z.string(),
  label: z.string(),
  kind: PropertyKind,
  required: z.boolean(),
  derived: z.boolean(), // read-only: worked out from a side table (regions, sectors, stories, forecasts)
  multiple: z.boolean(),
  choices: z.array(z.object({ key: z.string(), label: z.string() })).nullable(), // choice only
  unit: z.string().nullable(), // a fixed unit, e.g. "%"
  unit_key: z.string().nullable(), // the property holding the unit (capacity → capacity_unit)
  entity_types: z.array(EntityType).nullable(), // entity only; null = any type
  pattern: z.string().nullable(), // text only: a regular expression
  min: z.number().nullable(),
  max: z.number().nullable(),
  description: z.string().nullable(),
});
export type PropertyDef = z.infer<typeof PropertyDef>;

const PropertyScalar = z.union([z.string(), z.number()]);
export const PropertyRaw = z.union([PropertyScalar, z.array(PropertyScalar)]);
export type PropertyRaw = z.infer<typeof PropertyRaw>;

/** A node a place or entity property names (a tappable chip). */
export const EntityLink = z.object({ id: Id, name: z.string(), type: EntityType });
export type EntityLink = z.infer<typeof EntityLink>;

/** A property with its value, ready to show as a key-fact chip (api.entity). */
export const PropertyValue = z.object({
  key: z.string(),
  label: z.string(),
  kind: PropertyKind,
  value: PropertyRaw, // as stored (a list when the property is multiple)
  display: z.string(), // "Dubai", "1,200,000 TEU", "Mar 2024", "Logistics and Trade, Energy"
  unit: z.string().nullable(), // numbers only
  derived: z.boolean(), // read-only, worked out from a side table
  entity: EntityLink.nullable(), // single place or entity values: the node it names
  entities: z.array(EntityLink).nullable(), // multiple place or entity values
});
export type PropertyValue = z.infer<typeof PropertyValue>;

/** Direction of a connection, from the entity's side; "both" for symmetric relations. */
export const RelationDirection = z.enum(["out", "in", "both"]);
export type RelationDirection = z.infer<typeof RelationDirection>;

/** An entity's links of one relation, read from its side: "Owned by", "Supplies"… */
export const ConnectionGroup = z.object({
  relation: z.string(), // relation key
  label: z.string(), // label for out (and both), inverse_label for in
  direction: RelationDirection,
  causal: z.boolean(),
  count: z.number().int().min(0), // the whole group; items holds at most 12
  items: z.array(
    z.object({
      id: Id,
      name: z.string(), // headline for stories
      type: EntityType,
      subtype: z.string().nullable(),
      is_sample: z.boolean(),
      confidence: Prob.nullable(), // when the link has one
      // Since 0023: the edge behind this item (api.provenance target "edge"),
      // and whether to show the "?" badge (confidence < 0.5; kg.provenance).
      edge_id: z.number().int().optional(),
      weak: z.boolean().optional(),
    }),
  ), // newest stories first, then the most populous places, then by name
});
export type ConnectionGroup = z.infer<typeof ConnectionGroup>;

/** A property filter for api.graph and api.local_graph (exactly one type selected). */
export const PropertyFilter = z.object({
  prop: z.string(),
  // eq: equals (text ignores case; lists: any item); in: one of a list;
  // gte / lte: numbers and dates; contains: text substring, or a list item.
  op: z.enum(["eq", "in", "gte", "lte", "contains"]),
  value: PropertyRaw,
});
export type PropertyFilter = z.infer<typeof PropertyFilter>;

// ---------------------------------------------------------------------------
// Per-function responses
// ---------------------------------------------------------------------------

/** api.meta({}) */
export const MetaResponse = z.object({
  generated_at: Iso,
  data: z.object({
    live_stories: z.number().int(),
    sample_stories: z.number().int(),
    forecasts: z.number().int(),
    entities: z.number().int(),
    last_ingest_at: Iso.nullable(), // when the last news run finished (else the newest live story)
    showing_sample: z.boolean(), // true while there is no live data yet
  }),
  sectors: z.array(z.object({ id: SectorId, name: z.string(), icon: z.string() })),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      attribution: z.string(),
      homepage: z.string().nullable(),
    }),
  ),
  viewer_country: z.string().nullable().optional(), // website only: set by the RPC endpoint from the host's geo data
  // Feature flags {key: on} since 0021 (lib/flags.ts useFlag; a missing key is off).
  // Optional: the committed snapshot and older databases don't have them.
  flags: z.record(z.string(), z.boolean()).optional(),
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/**
 * api.globe({window, sectors?, sample?})
 * The activity heat is drawn in the browser (features/globe/model.ts,
 * layers.ts): zoomed out, each country is shaded by its `countries` count,
 * coloured by the balance of risk and opportunity; zoomed in, a soft GPU
 * glow of `events` (weighted by importance) fades in where news clusters.
 */
export const GlobeResponse = z.object({
  window: TimeWindow,
  events: z.array(
    z.object({
      id: Id,
      lon: Lon,
      lat: Lat,
      impact: Impact,
      importance: z.number(),
      magnitude: z.number().int().nullable(),
      sectors: z.array(SectorId),
      first_seen: Iso,
      headline: z.string(),
      country_id: Id.nullable(),
      // AI analysis done (or sample); false marks a draft from the news
      // pipeline. api.globe always sends it (optional here until the
      // globe's test fixtures carry it).
      analysed: z.boolean().optional(),
      // Since 0020 (optional for older fixtures): sample label and the Top 5 row fields.
      is_sample: z.boolean().optional(),
      event_type: z.string().optional(),
      direction: Direction.nullable().optional(),
      region: RegionRef.nullable().optional(),
    }),
  ),
  // True when `events` holds only the 1,500 most important events of the
  // window; `countries` always counts every event. api.globe always sends
  // it (optional here until the globe's test fixtures carry it).
  truncated: z.boolean().optional(),
  arcs: z.array(
    z.object({
      id: z.number().int(), // causal_link id
      src_story: Id,
      dst_story: Id,
      src: z.tuple([Lon, Lat]),
      dst: z.tuple([Lon, Lat]),
      src_country: Id,
      dst_country: Id,
      link_type: LinkType,
      confidence: Prob,
      impact: Impact, // impact of the destination story
    }),
  ),
  forecasts: z.array(ForecastSummary), // only those with a location
  countries: z.array(
    z.object({
      id: Id,
      count: z.number().int(),
      risk: z.number().int(),
      opportunity: z.number().int(),
      neutral: z.number().int(),
      score: z.number(), // −1 … +1
    }),
  ),
});
export type GlobeResponse = z.infer<typeof GlobeResponse>;

/** api.top({window, sectors?, sample?}) — "Top 5 now" */
export const TopResponse = z.object({
  stories: z.array(StorySummary), // ≤ 5, by importance with recency boost
  movers: z.array(ForecastSummary), // ≤ 3, biggest |change_24h|, not thin
});
export type TopResponse = z.infer<typeof TopResponse>;

/** api.region({id, window, sample?}) */
export const RegionResponse = z.object({
  region: z.object({
    id: Id,
    name: z.string(),
    subtype: z.string(),
    qid: z.string().nullable(),
    lon: Lon.nullable(),
    lat: Lat.nullable(),
    population: z.number().nullable(),
    breadcrumb: z.array(RegionRef), // world → country → state (excluding self)
  }),
  kpis: z.array(Kpi), // ≤ 4; falls back to the parent country's when the region has none
  kpi_scope: Id.nullable(), // region whose KPIs are shown
  sector_pulse: z.array(SectorPulse), // all 9 sectors, fixed order
  stories: z.array(StorySummary), // ≤ 10, by importance
  decisions: z.array(ForecastSummary), // upcoming, by end date
  children: z.array(
    z.object({
      id: Id,
      name: z.string(),
      subtype: z.string(),
      lon: Lon.nullable(),
      lat: Lat.nullable(),
      count: z.number().int(),
      risk: z.number().int(),
      opportunity: z.number().int(),
      neutral: z.number().int(),
      score: z.number(),
    }),
  ),
  graph: GraphData, // local graph, depth 1
});
export type RegionResponse = z.infer<typeof RegionResponse>;

/** api.story({id}) */
export const StoryResponse = z.object({
  story: StorySummary.extend({
    actions: z.array(z.string()), // ≤ 3, each ≤ 8 words
    last_seen: Iso.nullable(),
    mention_count: z.number().int(),
    sources: z.array(SourceRef),
    entities: z.array(EntityRef),
  }),
  forecasts: z.array(ForecastSummary), // "what the crowd expects next"
  causes: z.number().int(), // counts, for the card's cascade button
  effects: z.number().int(),
});
export type StoryResponse = z.infer<typeof StoryResponse>;

/** api.cascade({id, depth?}) — depth 1–3 each way, default 2 */
export const CascadeResponse = z.object({
  focus: Id,
  nodes: z.array(
    StorySummary.extend({
      depth: z.number().int(), // < 0 causes, 0 focus, > 0 effects
    }),
  ),
  links: z.array(CascadeLink),
  branches: z.array(
    z.object({
      forecast: ForecastSummary,
      outcomes: z.array(
        z.object({
          outcome: z.string(), // "YES" | "NO"
          probability: Prob,
          story_ids: z.array(Id), // effects that happen only on this outcome
        }),
      ),
    }),
  ),
});
export type CascadeResponse = z.infer<typeof CascadeResponse>;

/** api.entity({id}) — any node type except story (stories use api.story) */
export const EntityResponse = z.object({
  entity: z.object({
    id: Id,
    type: EntityType,
    subtype: z.string().nullable(),
    name: z.string(),
    summary: z.string().nullable(),
    qid: z.string().nullable(),
    aliases: z.array(z.string()),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    lon: Lon.nullable(),
    lat: Lat.nullable(),
    is_sample: z.boolean(),
  }),
  // Since 0022 (optional here so an older database still parses):
  // typed properties in the type's order, only those with a value (empty while kg.properties is off) …
  properties: z.array(PropertyValue).optional(),
  // … and every link grouped by relation, biggest group first (empty while kg.relations is off).
  connections: z.array(ConnectionGroup).optional(),
  timeline: z.array(StorySummary), // newest first, ≤ 20
  /** @deprecated Use `connections` (kept for one release). */
  backlinks: z.array(
    z.object({
      id: Id,
      type: EntityType,
      name: z.string(),
      edge_type: z.string(),
    }),
  ),
  forecasts: z.array(ForecastSummary.extend({ history: z.array(HistoryPoint) })),
  indicators: z.array(Kpi),
  graph: GraphData, // depth 1
});
export type EntityResponse = z.infer<typeof EntityResponse>;

/**
 * api.graph({types?, sectors?, regions?, window?, min_confidence?, limit?,
 *            where?, relations?, direction?, sample?})
 * `where` needs exactly one type in `types` (else the error "where needs
 * one type"); `relations` keeps only those links. `direction` needs a
 * focus, so here it is only checked (see local_graph).
 */
export const GraphResponse = GraphData.extend({ truncated: z.boolean() });
export type GraphResponse = z.infer<typeof GraphResponse>;

/**
 * api.local_graph({id, depth: 1..3, limit?, types?, where?, relations?, direction?, sample?})
 * `relations` and `direction` (relative to the focus: out = links leaving
 * it, in = links arriving; symmetric relations count both ways) limit the
 * links the neighbourhood follows. `types` and `where` (one type) keep only
 * matching nodes, plus the focus.
 */
export const LocalGraphResponse = GraphData.extend({ focus: Id, truncated: z.boolean() });
export type LocalGraphResponse = z.infer<typeof LocalGraphResponse>;

/**
 * "As of" (migration 0024, kg.history): api.graph_as_of({at, ...graph args})
 * and api.local_graph_as_of({at, ...local_graph args}) return the graph as
 * WorldGraph knew it at `at` (links outside their valid dates left out),
 * live data only (sample data has no history). `at`: a time, or a date
 * (YYYY-MM-DD: the end of that day, UTC); a future time means now. Before
 * `history_starts` the call fails with "History starts on <d Mon yyyy>".
 */
const AsOf = { as_of: Iso, history_starts: Iso };
export const GraphAsOfResponse = GraphResponse.extend(AsOf);
export type GraphAsOfResponse = z.infer<typeof GraphAsOfResponse>;
export const LocalGraphAsOfResponse = LocalGraphResponse.extend(AsOf);
export type LocalGraphAsOfResponse = z.infer<typeof LocalGraphAsOfResponse>;

/** api.forecasts({sectors?, regions?, categories?, sort?, include_thin?, profile?, sample?}) */
export const ForecastsResponse = z.object({ forecasts: z.array(ForecastSummary) });
export type ForecastsResponse = z.infer<typeof ForecastsResponse>;

/** api.forecast({id}) */
export const ForecastResponse = z.object({
  forecast: ForecastSummary.extend({
    history: z.array(HistoryPoint.extend({ volume: z.number().nullable() })),
    outcomes: z.array(z.string()),
    resolution_rule: z.string().nullable(),
    entities: z.array(EntityRef),
    stories: z.array(StorySummary), // related stories
  }),
  branches: z.array(
    z.object({
      outcome: z.string(),
      probability: Prob,
      effects: z.array(StorySummary.extend({ mechanism: z.string(), confidence: Prob, from_story: Id })),
    }),
  ),
});
export type ForecastResponse = z.infer<typeof ForecastResponse>;

/** api.search({q, types?, limit?}) */
export const SearchResponse = z.object({
  results: z.array(
    EntityRef.extend({
      context: z.string().nullable(), // e.g. "State · India", "Story · 3h ago"
      score: z.number(),
    }),
  ),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** A business profile, held by the client and sent with requests that use it. */
export const Profile = z.object({
  name: z.string().nullable(),
  sectors: z.array(SectorId),
  locations: z.array(Id), // region ids where you operate
  inputs: z.array(Id), // commodity ids you buy
  suppliers: z.array(Id), // region ids you source from
  markets: z.array(Id), // region ids you sell to
  competitors: z.array(Id), // organization ids
  keywords: z.array(z.string()),
});
export type Profile = z.infer<typeof Profile>;

/** api.affects({profile, window?}) */
export const AffectsResponse = z.object({
  items: z.array(
    z.object({
      story: StorySummary,
      matched: z.array(EntityRef), // which of your nodes it reaches
      path: z.array(Id), // story ids from the origin to this story
      relevance: Prob,
      actions: z.array(z.string()),
    }),
  ),
  suggested_forecasts: z.array(ForecastSummary),
});
export type AffectsResponse = z.infer<typeof AffectsResponse>;

/** api.opportunities({sectors?, regions?, profile?, window?}) */
export const OpportunitiesResponse = z.object({
  items: z.array(
    z.object({
      story: StorySummary,
      why_now: z.string(),
      suits: z.array(z.string()), // who it suits: sector names, entity names
      forecast: ForecastSummary.nullable(),
      momentum: Prob, // 0..1 x-axis of the radar
      relevance: Prob, // 0..1 y-axis (to the profile, or general when none)
    }),
  ),
});
export type OpportunitiesResponse = z.infer<typeof OpportunitiesResponse>;

/** api.compare({ids: 2..3 region ids, window?}) */
export const CompareResponse = z.object({
  regions: z.array(
    z.object({
      region: RegionRef,
      kpis: z.array(Kpi),
      sector_pulse: z.array(SectorPulse),
      counts: z.object({
        risk: z.number().int(),
        opportunity: z.number().int(),
        neutral: z.number().int(),
      }),
    }),
  ),
});
export type CompareResponse = z.infer<typeof CompareResponse>;

/** api.brief({profile?}) — six cards, in this order */
export const BriefCard = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("top_risks"), stories: z.array(StorySummary) }),
  z.object({ kind: z.literal("top_opportunities"), stories: z.array(StorySummary) }),
  z.object({ kind: z.literal("biggest_movers"), stories: z.array(StorySummary) }),
  z.object({ kind: z.literal("odds_moved"), forecasts: z.array(ForecastSummary) }),
  z.object({
    kind: z.literal("cascade_to_watch"),
    focus: StorySummary.nullable(),
    effects: z.number().int(),
  }),
  z.object({
    kind: z.literal("region_spotlight"),
    region: RegionRef.nullable(),
    stories: z.array(StorySummary),
    score: z.number(),
  }),
]);
export type BriefCard = z.infer<typeof BriefCard>;
export const BriefResponse = z.object({ generated_at: Iso, cards: z.array(BriefCard) });
export type BriefResponse = z.infer<typeof BriefResponse>;

/** api.ask_context({q, limit?}) — retrieval for Ask; the model answers only from this */
export const AskContextResponse = z.object({
  entities: z.array(EntityRef),
  stories: z.array(StorySummary.extend({ sources: z.array(SourceRef), actions: z.array(z.string()) })),
  links: z.array(CascadeLink),
  forecasts: z.array(ForecastSummary),
});
export type AskContextResponse = z.infer<typeof AskContextResponse>;

/** api.pending_analysis({limit?}) — stories waiting for AI analysis */
export const PendingAnalysisResponse = z.object({
  items: z.array(
    z.object({
      id: Id,
      titles: z.array(z.string()), // source headlines, ≤ 8
      snippets: z.array(z.string()), // one-sentence snippets, ≤ 5
      sources: z.array(z.string()),
      first_seen: Iso,
      region: RegionRef.nullable(),
      event_type: z.string(),
      sectors: z.array(SectorId), // rules-based guess
      entities: z.array(EntityRef), // entities already linked
      candidates: z.array(StorySummary), // earlier related stories (possible causes)
    }),
  ),
  total_pending: z.number().int(),
});
export type PendingAnalysisResponse = z.infer<typeof PendingAnalysisResponse>;

/** api.save_analysis({engine, model, items}) — writes AI results; returns what was saved */
export const SaveAnalysisResponse = z.object({
  saved: z.number().int(),
  skipped: z.number().int(), // stories marked as not business news
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
  links_saved: z.number().int(),
});
export type SaveAnalysisResponse = z.infer<typeof SaveAnalysisResponse>;

/**
 * api.schema({sample?}) — both registries with live counts (0022). The
 * schema map (kg.schema_map) uses by_pair; property definitions are empty
 * while kg.properties is off.
 */
export const SchemaResponse = z.object({
  types: z.array(
    z.object({
      key: EntityType,
      label: z.string(), // "Organisation"
      plural: z.string(), // "Organisations"
      icon: z.string(), // a lucide icon name
      tone: z.string(), // a CSS token in styles/tokens.css: colour = var(--<tone>)
      description: z.string(),
      count: z.number().int().min(0), // nodes of this type (sample ones only with sample data on)
      // In display order. Since 0025 each also has `coverage` (kg.schema_map):
      // the share of this type's nodes with a value (0–1; null for derived ones).
      properties: z.array(PropertyDef.extend({ coverage: Prob.nullable().optional() })),
      // Since 0025 (kg.schema_map; [] while off): the type's biggest relations,
      // read from its side ("In sector", "Owned by"), at most 6, biggest first.
      links: z
        .array(
          z.object({
            relation: z.string(),
            label: z.string(),
            direction: RelationDirection,
            count: z.number().int().min(0),
          }),
        )
        .optional(),
    }),
  ), // in display order
  relations: z.array(
    z.object({
      key: z.string(), // edge.type; "drives" is the causal relation
      label: z.string(), // read from the source: "Owns"
      inverse_label: z.string(), // read from the target: "Owned by"
      icon: z.string(), // a lucide icon name
      causal: z.boolean(), // carries polarity and strength
      symmetric: z.boolean(), // reads the same both ways
      src_types: z.array(EntityType), // allowed source types ([] = any)
      dst_types: z.array(EntityType), // allowed target types ([] = any)
      description: z.string(),
      count: z.number().int().min(0), // links (edges, plus causal links for drives); since 0025 only links shown in the graph (valid today, both ends visible)
      by_pair: z.array(
        z.object({ src_type: EntityType, dst_type: EntityType, count: z.number().int().min(0) }),
      ), // biggest first; [] while kg.schema_map is off
    }),
  ),
});
export type SchemaResponse = z.infer<typeof SchemaResponse>;

// ---------------------------------------------------------------------------
// Provenance (migration 0023, kg.provenance): "Why is this here?"
// ---------------------------------------------------------------------------

export const PROVENANCE_KINDS = [
  "reported",
  "inferred",
  "projected",
  "conditional",
  "user",
  "ai_suggested",
] as const;
export const ProvenanceKind = z.enum(PROVENANCE_KINDS);
export type ProvenanceKind = z.infer<typeof ProvenanceKind>;

/** One thing to cite: an article, an evidence snippet, a provider or the source dataset. */
export const ProvenanceSource = z.object({
  name: z.string(), // outlet, provider or dataset: "Reuters", "Natural Earth"
  url: z.string().nullable(), // null for sample data and sources without a page
  snippet: z.string().nullable(), // at most one sentence
  published_at: Iso.nullable(),
  title: z.string().nullable(), // the article headline (or forecast question), when there is one
});
export type ProvenanceSource = z.infer<typeof ProvenanceSource>;

/**
 * api.provenance({target, id}): where a node, an edge (graph link with
 * causal false, or a connection's edge_id) or a causal link (causal true,
 * cascade and globe arcs) comes from.
 */
export const ProvenanceResponse = z.object({
  target: z.enum(["node", "edge", "link"]),
  id: z.union([Id, z.number().int()]), // node id, or the edge / causal link id
  title: z.string(), // "DP World operates Jebel Ali Port"; "Cause → effect" for causal links
  sources: z.array(ProvenanceSource), // most specific first; [] means nothing to cite (weak)
  source: z
    .object({ id: z.string(), name: z.string(), url: z.string().nullable(), attribution: z.string() })
    .nullable(), // the source row it came from (null for causal links: see sources)
  confidence: Prob.nullable(),
  kind: ProvenanceKind, // causal links: their link_type
  added_by: z.string(), // plain words: "News pipeline · AI analysis · 22 Oct"
  created_by: z.string(), // raw: "pipeline:news", "ai:<model>", "curated", "gazetteer", "sample"…
  created_at: Iso,
  updated_at: Iso,
  is_sample: z.boolean(),
  weak: z.boolean(), // confidence < 0.5, or nothing to cite: show the "?" badge
});
export type ProvenanceResponse = z.infer<typeof ProvenanceResponse>;

// ---------------------------------------------------------------------------
// The function table
// ---------------------------------------------------------------------------

export const RESPONSES = {
  meta: MetaResponse,
  globe: GlobeResponse,
  top: TopResponse,
  region: RegionResponse,
  story: StoryResponse,
  cascade: CascadeResponse,
  entity: EntityResponse,
  graph: GraphResponse,
  local_graph: LocalGraphResponse,
  graph_as_of: GraphAsOfResponse,
  local_graph_as_of: LocalGraphAsOfResponse,
  forecasts: ForecastsResponse,
  forecast: ForecastResponse,
  search: SearchResponse,
  affects: AffectsResponse,
  opportunities: OpportunitiesResponse,
  compare: CompareResponse,
  brief: BriefResponse,
  ask_context: AskContextResponse,
  pending_analysis: PendingAnalysisResponse,
  save_analysis: SaveAnalysisResponse,
  schema: SchemaResponse,
  provenance: ProvenanceResponse,
} as const;

export type RpcName = keyof typeof RESPONSES;
export type RpcResponse<N extends RpcName> = z.infer<(typeof RESPONSES)[N]>;
export const RPC_NAMES = Object.keys(RESPONSES) as RpcName[];

/** Functions that change data. Only these may run with write access. */
export const WRITE_RPCS: ReadonlySet<RpcName> = new Set(["save_analysis"]);

// ---------------------------------------------------------------------------
// Arguments (the jsonb each function receives)
// ---------------------------------------------------------------------------

/**
 * `sample`: include sample data. Omitted means "include it only while there
 * is no live data yet" (the SQL helper api._use_sample decides). useRpc
 * fills it in from the Sample data setting when a screen leaves it out.
 *
 * `worldview`: "india" names and places regions as India's official view
 * does (search and region; migration 0018). useRpc sets it whenever the
 * viewer sees India's borders.
 */
export type Worldview = "india";

export interface RpcArgs {
  meta: Record<string, never>;
  globe: { window: TimeWindow; sectors?: SectorId[]; sample?: boolean };
  top: { window: TimeWindow; sectors?: SectorId[]; sample?: boolean };
  region: { id: string; window: TimeWindow; sample?: boolean; worldview?: Worldview };
  story: { id: string; sample?: boolean };
  cascade: { id: string; depth?: number; sample?: boolean };
  entity: { id: string; sample?: boolean };
  graph: {
    types?: EntityType[];
    sectors?: SectorId[];
    regions?: string[];
    window?: TimeWindow | "all";
    min_confidence?: number;
    limit?: number;
    /** Property conditions, all of which must hold; needs exactly one type in `types`. */
    where?: PropertyFilter[];
    /** Relation keys: only these links. */
    relations?: string[];
    /** Needs a focus: accepted, but only local_graph uses it. */
    direction?: RelationDirection;
    sample?: boolean;
  };
  local_graph: {
    id: string;
    depth: 1 | 2 | 3;
    limit?: number;
    /** Keep only nodes of these types (and the focus). */
    types?: EntityType[];
    /** Property conditions; needs exactly one type in `types`. */
    where?: PropertyFilter[];
    /** Relation keys: follow only these links. */
    relations?: string[];
    /** Relative to the focus: out = links leaving it, in = links arriving. */
    direction?: RelationDirection;
    sample?: boolean;
  };
  /** The graph as it was at `at` (see GraphAsOfResponse). */
  graph_as_of: RpcArgs["graph"] & { at: string };
  local_graph_as_of: RpcArgs["local_graph"] & { at: string };
  forecasts: {
    sectors?: SectorId[];
    regions?: string[];
    categories?: ForecastCategory[];
    sort?: "relevance" | "moved" | "ending" | "volume";
    include_thin?: boolean;
    profile?: Profile;
    sample?: boolean;
  };
  forecast: { id: string; sample?: boolean };
  search: { q: string; types?: EntityType[]; limit?: number; sample?: boolean; worldview?: Worldview };
  affects: { profile: Profile; window?: TimeWindow; sample?: boolean };
  opportunities: {
    sectors?: SectorId[];
    regions?: string[];
    profile?: Profile;
    window?: TimeWindow;
    sample?: boolean;
  };
  compare: { ids: string[]; window?: TimeWindow; sample?: boolean };
  brief: { profile?: Profile; sample?: boolean };
  ask_context: { q: string; limit?: number; sample?: boolean };
  pending_analysis: { limit?: number };
  schema: { sample?: boolean };
  /** "Why is this here?" (kg.provenance). id: a node id, or an edge / causal link id. */
  provenance: { target: "node" | "edge" | "link"; id: string | number };
  save_analysis: {
    engine: "artifact" | "api";
    model: string;
    items: AnalysisItem[];
    /** Pending stories the AI judged not to be business news (hidden from the app). */
    skipped?: { id: string; reason: string }[];
  };
}

// ---------------------------------------------------------------------------
// AI analysis output (validated before api.save_analysis; SQL checks again)
// ---------------------------------------------------------------------------

const words = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .refine((s) => {
      const n = s.split(/\s+/).filter(Boolean).length;
      return n >= min && n <= max;
    }, `must be ${min}–${max} words`);

export const AnalysisLink = z.object({
  from: Id, // an earlier story (one of the candidates) that caused this one
  link_type: z.enum(["reported", "inferred"]),
  mechanism: words(4, 2),
  direction: Direction,
  confidence: Prob,
  evidence: z.string().max(300), // one sentence
});
export type AnalysisLink = z.infer<typeof AnalysisLink>;

export const AnalysisItem = z.object({
  id: Id,
  headline: words(12),
  so_what: words(20),
  event_type: z.string().min(2).max(40),
  impact: Impact,
  direction: Direction,
  magnitude: z.number().int().min(1).max(5),
  horizon: Horizon,
  confidence: Prob,
  sectors: z.array(SectorId).min(1).max(3),
  actions: z.array(words(8)).max(3),
  entities: z.array(Id).max(12), // existing entity ids the story is about
  links: z.array(AnalysisLink).max(4),
});
export type AnalysisItem = z.infer<typeof AnalysisItem>;
