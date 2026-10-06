-- 0001: the knowledge graph core.
-- Everything is a node; relationships are typed edges. A few side tables
-- hold the typed details of stories, forecasts and indicators so queries
-- stay simple and fast.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Counts words the same way the Python validators do (split on whitespace).
create or replace function word_count(t text) returns integer
language sql immutable parallel safe set search_path = pg_catalog as $$
  select coalesce(array_length(regexp_split_to_array(btrim(t), '\s+'), 1), 0)
$$;

-- ---------------------------------------------------------------------------
-- Nodes: every entity, story and forecast.
-- ---------------------------------------------------------------------------
create table node (
    id          text primary key,                 -- permanent, readable: 'region:in-gj'
    type        text not null check (type in (
                  'region', 'organization', 'person', 'commodity', 'sector',
                  'infrastructure', 'policy', 'indicator', 'story', 'forecast',
                  'user_entity')),
    subtype     text,                              -- e.g. country / state / city; port / chokepoint
    name        text not null,
    aliases     text[] not null default '{}',
    summary     text,                              -- one line
    qid         text unique check (qid ~ '^Q[0-9]+$'),  -- Wikidata ID, when known
    props       jsonb not null default '{}',
    geom        geography(Geometry, 4326),         -- a point (label position) or a shape
    is_sample   boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    check (id ~ '^[a-z_]+:[a-z0-9][a-z0-9.-]*$')
);
create index node_type_idx on node (type, subtype);
create index node_geom_idx on node using gist (geom);
create index node_name_trgm_idx on node using gin (name gin_trgm_ops);
create index node_sample_idx on node (is_sample) where is_sample;

-- ---------------------------------------------------------------------------
-- Edges: structural, mention, forecast and sector links.
-- (Causal story-to-story links have their own table below.)
-- ---------------------------------------------------------------------------
create table edge (
    id          bigint generated always as identity primary key,
    src         text not null references node (id) on delete cascade,
    dst         text not null references node (id) on delete cascade,
    type        text not null check (type in (
                  -- structural
                  'located_in', 'part_of', 'owns', 'subsidiary_of', 'produces',
                  'exports_to', 'imports_from', 'depends_on', 'member_of', 'competes_with',
                  'in_sector',
                  -- story mentions an entity
                  'mentions',
                  -- forecast or indicator is about an entity; forecast relates to a story
                  'about', 'relates_to')),
    props       jsonb not null default '{}',       -- e.g. {"value_usd": 1.2e9, "year": 2025}
    valid_from  date,
    valid_to    date,
    is_sample   boolean not null default false,
    created_at  timestamptz not null default now(),
    check (src <> dst)
);
create unique index edge_unique_idx on edge (src, dst, type, (props ->> 'year')) nulls not distinct;
create index edge_dst_idx on edge (dst, type);
create index edge_src_idx on edge (src, type);

-- ---------------------------------------------------------------------------
-- Stories: a cluster of articles about one real-world event, or a projected
-- (possible future) impact that hasn't happened.
-- ---------------------------------------------------------------------------
create table story (
    node_id         text primary key references node (id) on delete cascade,
    kind            text not null default 'event' check (kind in ('event', 'projected')),
    headline        text not null check (word_count(headline) between 1 and 12),
    so_what         text not null check (word_count(so_what) between 1 and 20),
    event_type      text not null,
    impact          text not null check (impact in ('risk', 'opportunity', 'neutral')),
    direction       text check (direction in ('up', 'down')),
    magnitude       smallint check (magnitude between 1 and 5),
    horizon         text check (horizon in ('now', 'weeks', 'months')),
    confidence      real check (confidence between 0 and 1),
    importance      real not null default 0 check (importance between 0 and 100),
    sectors         text[] not null default '{}',
    primary_region  text references node (id),
    location        geography(Point, 4326),
    h3_cell         text,                             -- H3 resolution 7; parents give coarser bins
    actions         text[] not null default '{}' check (cardinality(actions) <= 3),
    first_seen      timestamptz,
    last_seen       timestamptz,
    mention_count   integer not null default 0,
    source_count    integer not null default 0,
    embedding       vector(384),                      -- filled by the Phase 2 pipeline
    check (kind = 'projected' or first_seen is not null)
);
create index story_first_seen_idx on story (first_seen desc);
create index story_location_idx on story using gist (location);
create index story_sectors_idx on story using gin (sectors);
create index story_region_idx on story (primary_region);

-- Articles: never the full text, only what we may keep.
create table article (
    id            bigint generated always as identity primary key,
    story_id      text references story (node_id) on delete set null,
    url           text unique,                        -- null only for sample data
    source_name   text not null,
    title         text not null,
    published_at  timestamptz,
    lang          text,
    snippet       text check (char_length(snippet) <= 300),
    is_sample     boolean not null default false,
    fetched_at    timestamptz not null default now(),
    check (url is not null or is_sample)
);
create index article_story_idx on article (story_id);

-- ---------------------------------------------------------------------------
-- Causal links between stories, with evidence.
-- ---------------------------------------------------------------------------
create table causal_link (
    id             bigint generated always as identity primary key,
    src_story      text not null references story (node_id) on delete cascade,
    dst_story      text not null references story (node_id) on delete cascade,
    link_type      text not null check (link_type in ('reported', 'inferred', 'projected', 'conditional')),
    mechanism      text not null check (word_count(mechanism) between 2 and 4),
    direction      text not null check (direction in ('up', 'down')),
    lag_days       integer check (lag_days >= 0),
    confidence     real not null check (confidence between 0 and 1),
    forecast_id    text references node (id) on delete cascade,
    outcome        text,                              -- e.g. 'YES' (conditional links only)
    method         text not null,                     -- 'source', 'llm', 'dependency', 'sample'
    model_version  text,
    is_sample      boolean not null default false,
    created_at     timestamptz not null default now(),
    check (src_story <> dst_story),
    check ((link_type = 'conditional') = (forecast_id is not null and outcome is not null))
);
create unique index causal_link_unique_idx
    on causal_link (src_story, dst_story, outcome) nulls not distinct;
create index causal_link_dst_idx on causal_link (dst_story);
create index causal_link_forecast_idx on causal_link (forecast_id) where forecast_id is not null;

create table evidence (
    id              bigint generated always as identity primary key,
    causal_link_id  bigint not null references causal_link (id) on delete cascade,
    source_name     text not null,
    url             text,                             -- null for sample evidence
    published_at    timestamptz,
    snippet         text not null check (char_length(snippet) <= 300),
    is_sample       boolean not null default false,
    check (url is not null or is_sample)
);
create index evidence_link_idx on evidence (causal_link_id);

-- ---------------------------------------------------------------------------
-- Forecasts: crowd questions and their probability history.
-- ---------------------------------------------------------------------------
create table forecast (
    node_id          text primary key references node (id) on delete cascade,
    provider         text not null,                   -- 'manifold', 'polymarket', 'metaculus', 'sample'
    provider_ref     text,                            -- the provider's own ID or slug
    question         text not null,                   -- full question as the provider words it
    short_title      text not null check (word_count(short_title) between 1 and 12),
    category         text not null check (category in (
                       'economy', 'finance', 'policy', 'politics', 'geopolitics',
                       'trade', 'tech', 'commodities', 'energy')),
    outcomes         text[] not null default '{YES,NO}',
    end_date         timestamptz,
    resolution_rule  text,
    url              text,
    is_real_money    boolean not null default false,
    volume_unit      text,                            -- 'USD', 'MANA', … (null for sample)
    status           text not null default 'open' check (status in ('open', 'closed', 'resolved')),
    resolved_outcome text,
    unique (provider, provider_ref)
);
create index forecast_end_idx on forecast (end_date);

create table forecast_snapshot (
    forecast_id  text not null references forecast (node_id) on delete cascade,
    ts           timestamptz not null,
    probability  real not null check (probability between 0 and 1),  -- P(YES) for binary questions
    volume       double precision,
    liquidity    double precision,
    primary key (forecast_id, ts)
);

-- ---------------------------------------------------------------------------
-- Indicators: KPI time series attached to a region or commodity.
-- ---------------------------------------------------------------------------
create table indicator_series (
    node_id      text primary key references node (id) on delete cascade,
    subject_id   text not null references node (id) on delete cascade,
    name         text not null,                       -- short label for a KPI tile
    unit         text not null,                       -- '%', 'USD/bbl', 'INR/litre', 'GW', …
    frequency    text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual')),
    higher_is    text not null default 'neutral' check (higher_is in ('better', 'worse', 'neutral')),
    source_name  text not null
);
create index indicator_subject_idx on indicator_series (subject_id);

create table indicator_point (
    series_id  text not null references indicator_series (node_id) on delete cascade,
    date       date not null,
    value      double precision not null,
    primary key (series_id, date)
);

-- ---------------------------------------------------------------------------
-- Sources and their attribution text (shown in the app).
-- ---------------------------------------------------------------------------
create table source (
    id           text primary key,                    -- 'natural-earth', 'gdelt', …
    name         text not null,
    homepage     text,
    licence      text,
    attribution  text not null
);

-- ---------------------------------------------------------------------------
-- Security: Supabase publishes every table in the public schema through its
-- REST API. Row-level security with no policies blocks that API completely;
-- our backend connects as the database owner, which is not affected.
-- ---------------------------------------------------------------------------
alter table node enable row level security;
alter table edge enable row level security;
alter table story enable row level security;
alter table article enable row level security;
alter table causal_link enable row level security;
alter table evidence enable row level security;
alter table forecast enable row level security;
alter table forecast_snapshot enable row level security;
alter table indicator_series enable row level security;
alter table indicator_point enable row level security;
alter table source enable row level security;
