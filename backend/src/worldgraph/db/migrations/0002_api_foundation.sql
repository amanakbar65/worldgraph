-- 0002: regions as a hierarchy, AI-analysis state on stories, forecast
-- providers with country gating, and the `api` schema's shared building
-- blocks (helpers and card views used by every api.* function).

-- ---------------------------------------------------------------------------
-- Regions: typed details and the hierarchy (country → state → city).
-- ---------------------------------------------------------------------------
create table region (
    node_id     text primary key references node (id) on delete cascade,
    level       text not null check (level in ('bloc', 'country', 'state', 'city')),
    iso2        text,                                   -- countries (and 'EU' for the bloc)
    code        text,                                   -- ISO 3166-2 for states
    parent_id   text references node (id),
    country_id  text references node (id),              -- the country itself for countries
    population  bigint,
    continent   text,
    subregion   text,
    capital     boolean not null default false
);
create index region_parent_idx on region (parent_id);
create index region_country_idx on region (country_id, level);

-- ---------------------------------------------------------------------------
-- Stories: analysis state. Live stories arrive as rules-based drafts
-- ('pending') and become 'done' once AI analysis writes the 12-word
-- headline, the so-what, actions and links.
-- ---------------------------------------------------------------------------
alter table story
    add column analysis_status text not null default 'done'
        check (analysis_status in ('pending', 'done', 'skipped')),
    add column analysed_at timestamptz,
    add column analysis_engine text,                    -- 'sample' | 'artifact' | 'api'
    add column analysis_model text,
    add column country_id text references node (id),
    add column admin1_id text references node (id);

alter table story drop constraint story_headline_check;
alter table story drop constraint story_so_what_check;
alter table story alter column so_what drop not null;
alter table story add constraint story_headline_words
    check (word_count(headline) between 1 and case when analysis_status = 'done' then 12 else 40 end);
alter table story add constraint story_so_what_words
    check (so_what is null or word_count(so_what) between 1 and 20);
alter table story add constraint story_done_is_complete
    check (analysis_status <> 'done' or so_what is not null);

create index story_country_idx on story (country_id);
create index story_admin1_idx on story (admin1_id);
create index story_pending_idx on story (importance desc) where analysis_status = 'pending';

-- ---------------------------------------------------------------------------
-- Forecast providers. Real-money providers are off by default and hidden
-- from viewers in blocked countries, or whose country is unknown.
-- ---------------------------------------------------------------------------
create table forecast_provider (
    id                 text primary key,
    name               text not null,
    homepage           text,
    real_money         boolean not null,
    enabled            boolean not null default false,
    blocked_countries  text[] not null default '{}',
    link_allowed       boolean not null default true,
    thin_volume        double precision not null default 0,   -- below this: tagged "thin market"
    thin_liquidity     double precision not null default 0,
    hide_volume        double precision not null default 0,   -- below this: hidden entirely
    attribution        text not null
);

insert into forecast_provider
    (id, name, homepage, real_money, enabled, blocked_countries, link_allowed,
     thin_volume, thin_liquidity, hide_volume, attribution)
values
    ('sample', 'Sample forecast', null, false, true, '{}', false,
     5000, 1000, 0, 'Sample data: an invented question, not a real market'),
    ('manifold', 'Manifold', 'https://manifold.markets', false, true, '{}', true,
     5000, 500, 1000, 'Crowd forecast from Manifold (play money)'),
    ('metaculus', 'Metaculus', 'https://www.metaculus.com', false, false, '{}', true,
     0, 0, 0, 'Community forecast from Metaculus'),
    ('polymarket', 'Polymarket', 'https://polymarket.com', true, false, '{IN}', true,
     50000, 10000, 10000, 'Market odds from Polymarket');

alter table forecast
    add constraint forecast_provider_fk foreign key (provider) references forecast_provider (id);

-- ---------------------------------------------------------------------------
-- Sources: attribution shown in the app.
-- ---------------------------------------------------------------------------
insert into source (id, name, homepage, licence, attribution) values
    ('natural-earth', 'Natural Earth', 'https://www.naturalearthdata.com', 'Public domain',
     'Borders and places: Natural Earth'),
    ('sample', 'WorldGraph sample data', null, 'Invented for demonstration',
     'Sample stories and forecasts are invented and labelled as samples')
on conflict (id) do nothing;

alter table region enable row level security;
alter table forecast_provider enable row level security;

-- ---------------------------------------------------------------------------
-- The api schema: every screen calls api.<name>(args jsonb) returns jsonb.
-- Helpers start with an underscore and are not part of the contract.
-- ---------------------------------------------------------------------------
create schema if not exists api;

-- Include sample rows? Explicit `sample` wins; otherwise only while there is
-- no live (non-sample) story yet.
create or replace function api._use_sample(args jsonb) returns boolean
language sql stable set search_path = public, extensions as $$
    select coalesce(
        (args ->> 'sample')::boolean,
        not exists (select 1 from story s join node n on n.id = s.node_id where not n.is_sample)
    )
$$;

-- The viewer's country, set only by the server (never by the browser).
create or replace function api._viewer_country(args jsonb) returns text
language sql immutable as $$
    select upper(nullif(args -> '_viewer' ->> 'country', ''))
$$;

-- May this provider's forecasts be shown to this viewer? Real-money
-- providers need a known viewer country that is not blocked (fail closed).
create or replace function api._provider_visible(p_provider text, p_viewer text) returns boolean
language sql stable set search_path = public, extensions as $$
    select exists (
        select 1 from forecast_provider fp
        where fp.id = p_provider
          and fp.enabled
          and (not fp.real_money
               or (p_viewer is not null and not (p_viewer = any (fp.blocked_countries))))
    )
$$;

-- Window length.
create or replace function api._window(args jsonb) returns interval
language sql immutable as $$
    select case coalesce(args ->> 'window', '7d')
        when '24h' then interval '24 hours'
        when '30d' then interval '30 days'
        when 'all' then interval '100 years'
        else interval '7 days'
    end
$$;

-- Text array from a jsonb array argument (null when absent or empty).
create or replace function api._text_array(v jsonb) returns text[]
language sql immutable as $$
    select case when jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0
                then array(select jsonb_array_elements_text(v)) end
$$;

-- {id, name, subtype, country_id} for a region node.
create or replace function api._region_ref(p_id text) returns jsonb
language sql stable set search_path = public, extensions as $$
    select jsonb_build_object(
        'id', n.id, 'name', n.name, 'subtype', coalesce(r.level, n.subtype, 'region'),
        'country_id', r.country_id)
    from node n left join region r on r.node_id = n.id
    where n.id = p_id
$$;

-- {id, type, subtype, name} for any node.
create or replace function api._entity_ref(p_id text) returns jsonb
language sql stable set search_path = public, extensions as $$
    select jsonb_build_object('id', n.id, 'type', n.type, 'subtype', n.subtype, 'name', n.name)
    from node n where n.id = p_id
$$;

-- Story cards: the StorySummary shape, ready to embed.
create or replace view api.story_card as
select
    s.node_id as id,
    n.is_sample,
    s.kind,
    s.first_seen,
    s.importance,
    s.impact,
    s.sectors,
    s.country_id,
    s.admin1_id,
    s.primary_region,
    s.location,
    s.analysis_status,
    jsonb_build_object(
        'id', s.node_id,
        'kind', s.kind,
        'headline', s.headline,
        'so_what', s.so_what,
        'event_type', s.event_type,
        'impact', s.impact,
        'direction', s.direction,
        'magnitude', s.magnitude,
        'horizon', s.horizon,
        'confidence', round(s.confidence::numeric, 2),
        'importance', round(s.importance::numeric, 1),
        'sectors', to_jsonb(s.sectors),
        'first_seen', s.first_seen,
        'region', case when s.primary_region is not null then api._region_ref(s.primary_region) end,
        'lon', round(st_x(s.location::geometry)::numeric, 4),
        'lat', round(st_y(s.location::geometry)::numeric, 4),
        'source_count', s.source_count,
        'analysed', s.analysis_status = 'done',
        'is_sample', n.is_sample
    ) as card
from story s
join node n on n.id = s.node_id;

-- Probability at or before a moment (latest snapshot not after it).
create or replace function api._prob_at(p_forecast text, p_ts timestamptz) returns real
language sql stable set search_path = public, extensions as $$
    select probability from forecast_snapshot
    where forecast_id = p_forecast and ts <= p_ts
    order by ts desc limit 1
$$;

-- Up to 30 evenly spaced probabilities across the last 30 days, oldest first.
create or replace function api._sparkline(p_forecast text) returns jsonb
language sql stable set search_path = public, extensions as $$
    with bounds as (
        select min(ts) as first_ts, max(ts) as last_ts
        from forecast_snapshot where forecast_id = p_forecast
    ),
    steps as (
        select greatest(b.first_ts, b.last_ts - interval '30 days')
               + (b.last_ts - greatest(b.first_ts, b.last_ts - interval '30 days')) * (i / 29.0) as t
        from bounds b, generate_series(0, 29) as i
        where b.last_ts is not null
    )
    select coalesce(jsonb_agg(round(api._prob_at(p_forecast, t)::numeric, 3) order by t)
                    filter (where api._prob_at(p_forecast, t) is not null), '[]'::jsonb)
    from steps
$$;

-- Forecast cards: the ForecastSummary shape (visibility is filtered by callers
-- with api._provider_visible).
create or replace view api.forecast_card as
with latest as (
    select distinct on (forecast_id) forecast_id, ts, probability, volume, liquidity
    from forecast_snapshot
    order by forecast_id, ts desc
)
select
    f.node_id as id,
    f.provider,
    f.category,
    f.end_date,
    f.status,
    n.is_sample,
    n.geom,
    l.probability,
    (l.probability - api._prob_at(f.node_id, l.ts - interval '24 hours')) as change_24h,
    (coalesce(l.volume, 0) < fp.thin_volume or coalesce(l.liquidity, 0) < fp.thin_liquidity) as thin,
    coalesce(l.volume, 0) < fp.hide_volume as hidden,
    region_edge.dst as region_id,
    jsonb_build_object(
        'id', f.node_id,
        'short_title', f.short_title,
        'question', f.question,
        'category', f.category,
        'probability', round(l.probability::numeric, 3),
        'change_24h', round((l.probability - api._prob_at(f.node_id, l.ts - interval '24 hours'))::numeric, 3),
        'volume', l.volume,
        'volume_unit', f.volume_unit,
        'liquidity', l.liquidity,
        'thin', (coalesce(l.volume, 0) < fp.thin_volume or coalesce(l.liquidity, 0) < fp.thin_liquidity),
        'end_date', f.end_date,
        'updated_at', l.ts,
        'provider', f.provider,
        'provider_name', fp.name,
        'url', case when fp.link_allowed then f.url end,
        'region', case when region_edge.dst is not null then api._region_ref(region_edge.dst) end,
        'lon', round(st_x(n.geom::geometry)::numeric, 4),
        'lat', round(st_y(n.geom::geometry)::numeric, 4),
        'sparkline', api._sparkline(f.node_id),
        'is_sample', n.is_sample
    ) as card
from forecast f
join node n on n.id = f.node_id
join forecast_provider fp on fp.id = f.provider
join latest l on l.forecast_id = f.node_id
left join lateral (
    select e.dst from edge e
    join node rn on rn.id = e.dst and rn.type = 'region'
    where e.src = f.node_id and e.type = 'about'
    order by e.id limit 1
) region_edge on true;
