-- 0008: tables for the live pipeline (GitHub Actions, every 15 minutes).

-- Story embeddings come from paraphrase-multilingual-mpnet-base-v2 (768
-- dimensions). Only recent stories keep an embedding (for clustering).
alter table story alter column embedding type vector(768);
create index story_embedding_idx on story using hnsw (embedding vector_cosine_ops)
    where embedding is not null;
alter table story add column props jsonb not null default '{}';  -- pipeline bookkeeping

create index article_published_idx on article (published_at);
create index story_last_seen_idx on story (last_seen desc);

-- Cursors and small state shared between runs (last GDELT file, feed ETags…).
create table pipeline_state (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);

-- One row per pipeline run.
create table ingest_run (
    id           bigint generated always as identity primary key,
    job          text not null,                          -- 'news' | 'forecasts' | 'analysis' | 'prune'
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    ok           boolean,
    stats        jsonb not null default '{}',
    error        text
);
create index ingest_run_job_idx on ingest_run (job, started_at desc);

-- Every Claude API call made by the website's AI job (cost control).
create table llm_usage (
    id             bigint generated always as identity primary key,
    at             timestamptz not null default now(),
    engine         text not null,                        -- 'api'
    model          text not null,
    purpose        text not null,                        -- 'analysis' | 'cascade' | 'ask'
    input_tokens   integer not null default 0,
    output_tokens  integer not null default 0,
    cost_usd       numeric(10, 5) not null default 0
);
create index llm_usage_at_idx on llm_usage (at desc);

-- Forecast titles shortened by rule (to be rewritten by AI analysis).
alter table forecast add column short_title_auto boolean not null default false;
alter table forecast add column props jsonb not null default '{}';

alter table pipeline_state enable row level security;
alter table ingest_run enable row level security;
alter table llm_usage enable row level security;

insert into source (id, name, homepage, licence, attribution) values
    ('gdelt', 'GDELT Project', 'https://www.gdeltproject.org', 'Free for any use with citation',
     'News signals: The GDELT Project'),
    ('usgs', 'USGS Earthquake Hazards Program', 'https://earthquake.usgs.gov', 'US public domain',
     'Earthquakes: U.S. Geological Survey'),
    ('gdacs', 'GDACS', 'https://www.gdacs.org', 'Free with attribution',
     'Disaster alerts: GDACS (European Commission and United Nations)'),
    ('manifold', 'Manifold', 'https://manifold.markets', 'Public API',
     'Crowd forecasts: Manifold (play money)')
on conflict (id) do update set name = excluded.name, homepage = excluded.homepage,
    licence = excluded.licence, attribution = excluded.attribution;
