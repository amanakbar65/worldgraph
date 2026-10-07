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
  volume_unit: z.string().nullable(), // "USD", "MANA", null for sample
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

export const GraphLink = z.object({
  source: Id,
  target: Id,
  type: z.string(), // edge type (located_in, mentions…) or causal link type
  causal: z.boolean(),
  confidence: Prob.nullable(),
  created_at: Iso.nullable(),
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
    last_ingest_at: Iso.nullable(),
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
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/**
 * api.globe({window, sectors?, sample?})
 * Hex heat is computed in the browser from `events` (h3-js), at a
 * resolution that suits the zoom level.
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
    }),
  ),
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
  timeline: z.array(StorySummary), // newest first, ≤ 20
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

/** api.graph({types?, sectors?, regions?, window?, min_confidence?, limit?, sample?}) */
export const GraphResponse = GraphData.extend({ truncated: z.boolean() });
export type GraphResponse = z.infer<typeof GraphResponse>;

/** api.local_graph({id, depth: 1..3, limit?}) */
export const LocalGraphResponse = GraphData.extend({ focus: Id, truncated: z.boolean() });
export type LocalGraphResponse = z.infer<typeof LocalGraphResponse>;

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
 * is no live data yet" (the SQL helper api._use_sample decides).
 */
export interface RpcArgs {
  meta: Record<string, never>;
  globe: { window: TimeWindow; sectors?: SectorId[]; sample?: boolean };
  top: { window: TimeWindow; sectors?: SectorId[]; sample?: boolean };
  region: { id: string; window: TimeWindow; sample?: boolean };
  story: { id: string };
  cascade: { id: string; depth?: number };
  entity: { id: string };
  graph: {
    types?: EntityType[];
    sectors?: SectorId[];
    regions?: string[];
    window?: TimeWindow | "all";
    min_confidence?: number;
    limit?: number;
    sample?: boolean;
  };
  local_graph: { id: string; depth: 1 | 2 | 3; limit?: number };
  forecasts: {
    sectors?: SectorId[];
    regions?: string[];
    categories?: ForecastCategory[];
    sort?: "relevance" | "moved" | "ending" | "volume";
    include_thin?: boolean;
    profile?: Profile;
    sample?: boolean;
  };
  forecast: { id: string };
  search: { q: string; types?: EntityType[]; limit?: number };
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
