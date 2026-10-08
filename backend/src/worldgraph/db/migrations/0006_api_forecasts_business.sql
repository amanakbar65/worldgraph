-- 0006: api functions for forecasts, the business layer and the AI hand-off.
--
--   api.forecasts         the forecasts view: filters, sorts, profile relevance
--   api.forecast          one forecast: history, entities, related stories, If YES / If NO
--   api.affects           the "Affects you" feed for a business profile
--   api.opportunities     opportunity cards and the momentum × relevance radar
--   api.ask_context       retrieval for Ask (the model answers only from this)
--   api.pending_analysis  stories waiting for AI analysis, with candidate causes
--   api.save_analysis     writes AI analysis results (the only write function)
--
-- It also rebuilds api.forecast_card: the latest snapshot is now found per
-- forecast through the primary key (a LATERAL "order by ts desc limit 1")
-- instead of a DISTINCT ON over every snapshot, because live forecasts add a
-- snapshot every hour, and the sparkline is computed inline (one index probe
-- per point instead of two function calls). Columns, order and output are
-- unchanged.
--
-- Shared rules
-- - Sample rows appear only when api._use_sample(args) is true; live rows
--   always do. Stories marked 'skipped' (not business news) never appear.
--   Pending stories (rules-based drafts) appear like any other story; their
--   card says analysed = false.
-- - A forecast appears in a list only when it is open, not hidden for low
--   volume, its provider is visible to the viewer's country (fails closed for
--   real-money providers) and the sample rule allows it. Conditional causal
--   links whose forecast isn't shown are not followed.
-- - Arguments are read with ->>, -> and jsonb_array_elements_text, limits are
--   clamped with least/greatest, and nothing builds SQL text from them.
-- - Live data grows to tens of thousands of stories, so the queries start
--   from the small side (profile nodes, entities, words, a page of story ids)
--   and reach stories through indexes instead of scanning the window.
-- - No function-level SET of extension settings (Supabase refuses them):
--   trigram matching uses pg_trgm's default threshold (0.3).
--
-- Private helpers use the prefix api._c_ (group c).

-- ---------------------------------------------------------------------------
-- Forecast cards (same columns and output as 0002, faster "latest").
-- ---------------------------------------------------------------------------
create or replace view api.forecast_card as
select
    f.node_id as id,
    f.provider,
    f.category,
    f.end_date,
    f.status,
    n.is_sample,
    n.geom,
    l.probability,
    (l.probability - p24.probability) as change_24h,
    (coalesce(l.volume, 0) < fp.thin_volume or coalesce(l.liquidity, 0) < fp.thin_liquidity) as thin,
    coalesce(l.volume, 0) < fp.hide_volume as hidden,
    region_edge.dst as region_id,
    jsonb_build_object(
        'id', f.node_id,
        'short_title', f.short_title,
        'question', f.question,
        'category', f.category,
        'probability', round(l.probability::numeric, 3),
        'change_24h', round((l.probability - p24.probability)::numeric, 3),
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
        -- The same points as api._sparkline(f.node_id), computed inline (it
        -- runs only when the card is read): 30 evenly spaced moments across
        -- the last 30 days of snapshots, the latest probability at or before each.
        'sparkline', (
            select coalesce(jsonb_agg(round(pt.probability::numeric, 3) order by st.t)
                            filter (where pt.probability is not null), '[]'::jsonb)
            from (
                select greatest(b.first_ts, l.ts - interval '30 days')
                       + (l.ts - greatest(b.first_ts, l.ts - interval '30 days')) * (g.i / 29.0) as t
                from (select min(fs.ts) as first_ts from forecast_snapshot fs
                      where fs.forecast_id = f.node_id) b
                cross join generate_series(0, 29) as g(i)
            ) st
            left join lateral (
                select fs.probability from forecast_snapshot fs
                where fs.forecast_id = f.node_id and fs.ts <= st.t
                order by fs.ts desc
                limit 1
            ) pt on true),
        'is_sample', n.is_sample
    ) as card
from forecast f
join node n on n.id = f.node_id
join forecast_provider fp on fp.id = f.provider
cross join lateral (
    -- the latest snapshot (primary key: forecast_id, ts)
    select fs.ts, fs.probability, fs.volume, fs.liquidity
    from forecast_snapshot fs
    where fs.forecast_id = f.node_id
    order by fs.ts desc
    limit 1
) l
left join lateral (
    -- the probability 24 hours before it (same as api._prob_at)
    select fs.probability
    from forecast_snapshot fs
    where fs.forecast_id = f.node_id and fs.ts <= l.ts - interval '24 hours'
    order by fs.ts desc
    limit 1
) p24 on true
left join lateral (
    select e.dst from edge e
    join node rn on rn.id = e.dst and rn.type = 'region'
    where e.src = f.node_id and e.type = 'about'
    order by e.id limit 1
) region_edge on true;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Ask: entity names (stories and forecasts are matched separately).
create index if not exists node_name_trgm_entity_c_idx on node using gin (name gin_trgm_ops)
    where type not in ('story', 'forecast');
-- Ask: words in a story's headline and so-what (English stemming: "rates" → rate).
create index if not exists story_text_fts_c_idx on story
    using gin (to_tsvector('english'::regconfig, headline || ' ' || coalesce(so_what, '')));
-- Business profile keywords (ILIKE '%keyword%').
create index if not exists story_headline_trgm_c_idx on story using gin (headline gin_trgm_ops);
create index if not exists story_so_what_trgm_c_idx on story using gin (so_what gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

-- An integer argument clamped to [p_min, p_max]. Numbers and numeric strings
-- are rounded; anything else gives the default.
create or replace function api._c_int(v jsonb, p_default integer, p_min integer, p_max integer)
returns integer
language sql immutable set search_path = pg_catalog as $$
    select greatest(p_min, least(p_max, case
        when jsonb_typeof(v) = 'number'
            then round(greatest(-1000000, least(1000000, (v #>> '{}')::numeric)))::integer
        when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]{1,6}(\.[0-9]+)?$'
            then round(btrim(v #>> '{}')::numeric)::integer
        else p_default
    end))
$$;

-- The window length: 24h, 7d or 30d, else the default.
create or replace function api._c_window(args jsonb, p_default text) returns interval
language sql immutable set search_path = pg_catalog as $$
    select api._window(jsonb_build_object('window',
        case when args ->> 'window' in ('24h', '7d', '30d') then args ->> 'window' else p_default end))
$$;

-- The nine sector ids.
create or replace function api._c_sectors() returns text[]
language sql immutable set search_path = pg_catalog as $$
    select array['energy', 'agri-food', 'manufacturing', 'logistics-trade', 'finance',
                 'tech', 'health', 'real-estate', 'consumer']
$$;

-- Sectors a forecast category speaks to (policy and politics: none).
create or replace function api._c_category_sectors(p_category text) returns text[]
language sql immutable set search_path = pg_catalog as $$
    select case p_category
        when 'economy' then array['finance']
        when 'finance' then array['finance']
        when 'trade' then array['logistics-trade']
        when 'energy' then array['energy']
        when 'commodities' then array['agri-food', 'manufacturing', 'energy']
        when 'tech' then array['tech']
        else '{}'::text[]
    end
$$;

-- Common words that carry no meaning for retrieval.
create or replace function api._c_stop_words() returns text[]
language sql immutable set search_path = pg_catalog as $$
    select array[
        'the', 'and', 'for', 'with', 'what', 'which', 'who', 'whom', 'whose', 'how', 'why', 'when',
        'where', 'will', 'would', 'could', 'should', 'shall', 'can', 'may', 'might', 'must',
        'does', 'did', 'doing', 'done', 'are', 'was', 'were', 'has', 'have', 'had', 'having',
        'been', 'being', 'this', 'that', 'these', 'those', 'there', 'their', 'theirs', 'they',
        'them', 'then', 'than', 'from', 'into', 'onto', 'about', 'over', 'under', 'above', 'below',
        'after', 'before', 'between', 'through', 'during', 'out', 'off', 'per', 'via', 'our',
        'ours', 'your', 'yours', 'you', 'its', 'his', 'her', 'hers', 'him', 'she', 'not', 'nor',
        'but', 'any', 'all', 'some', 'more', 'most', 'much', 'many', 'very', 'also', 'just',
        'only', 'other', 'such', 'each', 'both', 'few', 'own', 'same', 'too', 'now', 'here', 'yet',
        'again', 'still', 'even', 'ever', 'get', 'got', 'gets', 'let', 'lets', 'tell', 'show',
        'give', 'explain', 'know', 'think', 'mean', 'means', 'happen', 'happens', 'happening',
        'happened', 'going', 'latest', 'news', 'today', 'week', 'month', 'year', 'next', 'last',
        'like', 'want', 'need', 'please', 'thing', 'things', 'anything', 'something', 'whats',
        'doesn', 'don', 'isn', 'aren', 'wasn', 'won', 'cannot', 'affect', 'affects', 'affected',
        'impact', 'impacts', 'business', 'businesses', 'company', 'companies'
    ]
$$;

-- A case-insensitive whole-word pattern for a query word (letters and digits
-- only, so it holds no regex syntax), also matching its singular and plural:
-- "rates" → \m(rates|rate)(s|es)?\M, "taxes" → \m(taxes|taxe|tax)(s|es)?\M.
create or replace function api._c_word_regex(p_word text) returns text
language sql immutable set search_path = pg_catalog as $$
    select '\m(' || p_word
           || case when char_length(p_word) > 3 and p_word ~ '[^s]s$' then '|' || left(p_word, -1) else '' end
           || case when char_length(p_word) > 4 and p_word ~ '(s|x|z|ch|sh)es$' then '|' || left(p_word, -2) else '' end
           || ')(s|es)?\M'
$$;

-- ForecastSummary cards for these ids, in the given order.
create or replace function api._c_cards(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(fc.card order by array_position(p_ids, fc.id)), '[]'::jsonb)
    from api.forecast_card fc
    where fc.id = any(p_ids)
$$;

-- ForecastSummary cards keyed by id ({} when none): each card built once.
create or replace function api._c_card_map(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_object_agg(fc.id, fc.card), '{}'::jsonb)
    from api.forecast_card fc
    where fc.id = any(p_ids)
$$;

-- EntityRefs in the given order.
create or replace function api._c_entity_refs_ordered(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'subtype', n.subtype, 'name', n.name)
                              order by i.ord), '[]'::jsonb)
    from unnest(p_ids) with ordinality as i(id, ord)
    join node n on n.id = i.id
$$;

-- StorySummary cards for these ids, in the given order.
create or replace function api._c_story_cards(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(sc.card order by i.ord), '[]'::jsonb)
    from unnest(p_ids) with ordinality as i(id, ord)
    join api.story_card sc on sc.id = i.id
$$;

-- Forecasts that may be listed for this viewer: open, not hidden, provider
-- visible to the viewer's country (checked once per provider), sample only
-- when allowed. Cards are not built here (each card computes a sparkline),
-- only the ranking columns.
create or replace function api._c_forecast_pool(p_viewer text, p_sample boolean)
returns table (
    id text, category text, end_date timestamptz, change_24h real, thin boolean,
    volume double precision
)
language sql stable set search_path = public, extensions as $$
    with providers as materialized (
        select fp.id from forecast_provider fp where api._provider_visible(fp.id, p_viewer)
    )
    select fc.id, fc.category, fc.end_date, fc.change_24h, fc.thin,
           (select fs.volume from forecast_snapshot fs
            where fs.forecast_id = fc.id order by fs.ts desc limit 1)
    from api.forecast_card fc
    join providers p on p.id = fc.provider
    where fc.status = 'open'
      and not fc.hidden
      and (p_sample or not fc.is_sample)
$$;

-- ---------------------------------------------------------------------------
-- Business profile helpers
-- ---------------------------------------------------------------------------

-- The profile's nodes with their weights: inputs 1.0, locations 0.9,
-- suppliers 0.85, markets 0.8, competitors 0.7, sectors 0.35 (as sector:<id>).
-- Unknown ids are dropped; a node listed twice keeps its highest weight.
create or replace function api._c_profile_nodes(p_profile jsonb)
returns table (node_id text, weight numeric)
language sql stable set search_path = public, extensions as $$
    with lists(key, weight, is_sector) as (
        values ('inputs', 1.0, false), ('locations', 0.9, false), ('suppliers', 0.85, false),
               ('markets', 0.8, false), ('competitors', 0.7, false), ('sectors', 0.35, true)
    ),
    raw as (
        select case when l.is_sector then 'sector:' || regexp_replace(btrim(x.v), '^sector:', '')
                    else btrim(x.v) end as node_id,
               l.weight, l.is_sector
        from lists l
        cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(p_profile -> l.key) = 'array' then p_profile -> l.key else '[]'::jsonb end
        ) with ordinality as x(v, ord)
        where x.ord <= 50
    )
    select r.node_id, max(r.weight)::numeric
    from raw r
    join node n on n.id = r.node_id
    where n.type not in ('story', 'forecast', 'user_entity', 'indicator')
      and (n.type = 'sector') = r.is_sector
    group by r.node_id
$$;

-- Regions that count for the profile's region nodes, by scope:
--   self     the profile region itself
--   country  the country of a profile state or city
--   member   a member country of a profile bloc
--   bloc     a bloc a profile country (or its state or city) belongs to
create or replace function api._c_profile_places(p_profile jsonb)
returns table (region_id text, profile_node text, weight numeric, scope text)
language sql stable set search_path = public, extensions as $$
    with pr as (
        select pn.node_id, pn.weight, r.level, r.country_id
        from api._c_profile_nodes(p_profile) pn
        join region r on r.node_id = pn.node_id
    )
    select pr.node_id, pr.node_id, pr.weight, 'self' from pr
    union all
    select pr.country_id, pr.node_id, pr.weight, 'country' from pr
    where pr.level in ('state', 'city') and pr.country_id is not null and pr.country_id <> pr.node_id
    union all
    select m.src, pr.node_id, pr.weight, 'member' from pr
    join edge m on m.dst = pr.node_id and m.type = 'member_of'
    where pr.level = 'bloc'
    union all
    select m.dst, pr.node_id, pr.weight, 'bloc' from pr
    join edge m on m.src = pr.country_id and m.type = 'member_of'
    where pr.level in ('country', 'state', 'city')
$$;

-- The profile's keywords as ILIKE patterns ('%' || keyword || '%', with the
-- LIKE wildcards in the keyword escaped). At most 20, each 2–60 characters.
create or replace function api._c_keyword_patterns(p_profile jsonb) returns text[]
language sql immutable set search_path = pg_catalog as $$
    select coalesce(array_agg(distinct
               '%' || replace(replace(replace(t.k, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}')
    from (
        select lower(btrim(x.v)) as k
        from jsonb_array_elements_text(
            case when jsonb_typeof(p_profile -> 'keywords') = 'array' then p_profile -> 'keywords'
                 else '[]'::jsonb end
        ) with ordinality as x(v, ord)
        where x.ord <= 20
    ) t
    where char_length(t.k) between 2 and 60
$$;

-- Does the profile hold anything to match on?
create or replace function api._c_profile_present(p_profile jsonb) returns boolean
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_typeof(p_profile) = 'object'
                    and (exists (select 1 from api._c_profile_nodes(p_profile))
                         or cardinality(api._c_keyword_patterns(p_profile)) > 0), false)
$$;

-- Direct profile matches: stories that touch the profile, with the best
-- reason weight, the profile nodes that matched and the relevance
--   weight × (0.5 + 0.5 × confidence) × (0.5 + importance / 200), clamped to 0..1
-- (unknown confidence counts as 0.5). Reasons and weights:
--   the story mentions a profile node (inputs 1.0, locations 0.9, suppliers
--     0.85, markets 0.8, competitors 0.7, sector nodes 0.35)
--   it is located in a profile region (country_id, admin1_id or
--     primary_region), in a member country of a profile bloc, or in the
--     country of a profile state or city (full weight for a national story,
--     × 0.75 when it sits in another state of that country)
--   it mentions the country of a profile state or city, a member of a profile
--     bloc or a bloc a profile country belongs to (× 0.75)
--   sector overlap (0.35) and a keyword in the headline or so-what (0.5)
-- Stories: events first seen since p_since, plus projected stories when
-- p_projected, with impact p_impact when given; never skipped ones; sample
-- ones only when p_sample.
-- Each reason starts from the profile side and reaches stories through an
-- index, so the cost follows the number of matches, not the window.
create or replace function api._c_profile_matches(
    p_profile jsonb, p_since timestamptz, p_sample boolean, p_projected boolean, p_impact text default null)
returns table (
    story_id text, weight numeric, matched text[], confidence real, importance real, relevance numeric
)
language plpgsql stable set search_path = public, extensions
rows 500
as $$
#variable_conflict use_column
declare
    v_nodes text[];
    v_weights numeric[];
    v_place_ids text[];
    v_place_nodes text[];
    v_place_weights numeric[];
    v_place_scopes text[];
    v_sectors text[];
    v_patterns text[] := api._c_keyword_patterns(p_profile);
begin
    select coalesce(array_agg(pn.node_id), '{}'), coalesce(array_agg(pn.weight), '{}')
      into v_nodes, v_weights
    from api._c_profile_nodes(p_profile) pn;
    if cardinality(v_nodes) = 0 and cardinality(v_patterns) = 0 then
        return;
    end if;
    select coalesce(array_agg(pl.region_id), '{}'), coalesce(array_agg(pl.profile_node), '{}'),
           coalesce(array_agg(pl.weight), '{}'), coalesce(array_agg(pl.scope), '{}')
      into v_place_ids, v_place_nodes, v_place_weights, v_place_scopes
    from api._c_profile_places(p_profile) pl;
    v_sectors := array(select substr(x.id, 8) from unnest(v_nodes) as x(id) where x.id like 'sector:%');

    -- Every reason reads the story row it reaches (one index probe) and keeps
    -- only stories in scope: events since p_since (or projected ones when
    -- p_projected), not skipped, with the wanted impact.
    return query
    with places(region_id, node_id, weight, scope) as (
        select * from unnest(v_place_ids, v_place_nodes, v_place_weights, v_place_scopes)
    ),
    hits(story_id, weight, matched, confidence, importance) as (
        -- mentions a profile node
        select s.node_id, p.weight, p.node_id, s.confidence, s.importance
        from unnest(v_nodes, v_weights) as p(node_id, weight)
        join edge e on e.dst = p.node_id and e.type = 'mentions'
        join story s on s.node_id = e.src
        where ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
        union all
        -- located in a profile region, a member of a profile bloc, or the
        -- country of a profile state or city
        select s.node_id,
               pl.weight * case when pl.scope = 'country' and s.admin1_id is not null then 0.75 else 1.0 end,
               pl.node_id, s.confidence, s.importance
        from places pl
        join story s on s.country_id = pl.region_id
        where pl.scope in ('self', 'country', 'member')
          and ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
        union all
        select s.node_id, pl.weight, pl.node_id, s.confidence, s.importance
        from places pl
        join story s on s.admin1_id = pl.region_id or s.primary_region = pl.region_id
        where pl.scope = 'self'
          and ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
        union all
        -- mentions the country of a profile state or city, a member of a
        -- profile bloc, or a bloc a profile country belongs to
        select s.node_id, pl.weight * 0.75, pl.node_id, s.confidence, s.importance
        from places pl
        join edge e on e.dst = pl.region_id and e.type = 'mentions'
        join story s on s.node_id = e.src
        where pl.scope in ('country', 'member', 'bloc')
          and ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
        union all
        -- sector overlap (weak)
        select s.node_id, 0.35, 'sector:' || x.sector, s.confidence, s.importance
        from story s
        cross join lateral unnest(s.sectors) as x(sector)
        where s.sectors && v_sectors
          and x.sector = any(v_sectors)
          and ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
        union all
        -- a keyword in the headline or so-what
        select s.node_id, 0.5, null::text, s.confidence, s.importance
        from unnest(v_patterns) as k(pat)
        join story s on s.headline ilike k.pat or s.so_what ilike k.pat
        where ((s.kind = 'event' and s.first_seen >= p_since) or (p_projected and s.kind = 'projected'))
          and s.analysis_status <> 'skipped' and (p_impact is null or s.impact = p_impact)
    ),
    best as (
        -- matched may repeat a node (callers turn it into EntityRefs by id)
        select h.story_id,
               least(1, max(h.weight)) as weight,
               coalesce(array_agg(h.matched) filter (where h.matched is not null), '{}') as matched,
               max(h.confidence) as confidence,
               max(h.importance) as importance
        from hits h
        group by h.story_id
    )
    select b.story_id, b.weight, b.matched, b.confidence, b.importance,
           round(greatest(0, least(1,
               b.weight * (0.5 + 0.5 * coalesce(b.confidence, 0.5)::numeric)
               * (0.5 + b.importance::numeric / 200))), 3)
    from best b
    where p_sample or b.story_id not in (select n.id from node n where n.is_sample);
end
$$;

-- EntityRefs for node ids, ordered by type (regions first) then name.
create or replace function api._c_entity_refs(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'subtype', n.subtype, 'name', n.name)
                              order by case n.type when 'region' then 0 when 'organization' then 1
                                                   when 'commodity' then 2 when 'infrastructure' then 3
                                                   when 'policy' then 4 when 'sector' then 6 else 5 end,
                                       n.name, n.id), '[]'::jsonb)
    from node n
    where n.id = any(p_ids)
$$;

-- ---------------------------------------------------------------------------
-- api.forecasts({sectors?, regions?, categories?, sort?, include_thin?,
--                profile?, sample?}) → ForecastsResponse (at most 100)
-- ---------------------------------------------------------------------------
create or replace function api.forecasts(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_regions text[] := api._text_array(args -> 'regions');
    v_categories text[] := api._text_array(args -> 'categories');
    v_sort text := case when args ->> 'sort' in ('relevance', 'moved', 'ending', 'volume')
                        then args ->> 'sort' else 'relevance' end;
    v_thin boolean := case when jsonb_typeof(args -> 'include_thin') = 'boolean'
                           then (args ->> 'include_thin')::boolean else true end;
    v_profile jsonb := case when jsonb_typeof(args -> 'profile') = 'object' then args -> 'profile' end;
    v_scope text[];
    v_sector_nodes text[];
    v_ids text[];
begin
    -- Regions: the region, its country, everything inside it, members of a bloc.
    if v_regions is not null then
        select coalesce(array_agg(distinct x.id), '{}') into v_scope
        from (
            select unnest(v_regions) as id
            union all
            select r.country_id from region r where r.node_id = any(v_regions)
            union all
            select r.node_id from region r where r.country_id = any(v_regions)
            union all
            select r.node_id from region r where r.parent_id = any(v_regions)
            union all
            select m.src from edge m where m.type = 'member_of' and m.dst = any(v_regions)
        ) x
        where x.id is not null;
    end if;
    if v_sectors is not null then
        v_sector_nodes := array(select 'sector:' || s from unnest(v_sectors) as s);
    end if;

    with pool as materialized (
        select p.*
        from api._c_forecast_pool(v_viewer, v_sample) p
        where (v_categories is null or p.category = any(v_categories))
          and (v_thin or not p.thin)
          and (v_scope is null or exists (
                  select 1 from edge e
                  where e.src = p.id and e.type = 'about' and e.dst = any(v_scope)))
          and (v_sectors is null
               or api._c_category_sectors(p.category) && v_sectors
               or exists (
                  select 1 from edge e
                  where e.src = p.id and e.type = 'about' and e.dst = any(v_sector_nodes)))
    ),
    pn as materialized (
        select * from api._c_profile_nodes(v_profile)
    ),
    pl as materialized (
        select * from api._c_profile_places(v_profile) where scope <> 'self'
    ),
    match as (
        select x.id, max(x.w) as w
        from (
            -- about a profile node
            select p.id, pn.weight as w
            from pool p
            join edge e on e.src = p.id and e.type = 'about'
            join pn on pn.node_id = e.dst
            union all
            -- about the country of a profile state or city, a member of a
            -- profile bloc, or a bloc a profile country belongs to
            select p.id, pl.weight * case when pl.scope = 'bloc' then 0.75 else 1.0 end
            from pool p
            join edge e on e.src = p.id and e.type = 'about'
            join pl on pl.region_id = e.dst
            union all
            -- the category speaks to a profile sector
            select p.id, 0.35
            from pool p
            where api._c_category_sectors(p.category)
                  && array(select substr(pn.node_id, 8) from pn where pn.node_id like 'sector:%')
            union all
            -- a keyword in the title or question
            select p.id, 0.5
            from pool p
            join forecast f on f.node_id = p.id
            join unnest(api._c_keyword_patterns(v_profile)) as k(pat)
              on f.short_title ilike k.pat or f.question ilike k.pat
        ) x
        group by x.id
    ),
    ranked as (
        select p.id, p.end_date, p.change_24h, p.volume,
               0.5 * least(1, coalesce(m.w, 0))
               + 0.3 * least(1, abs(coalesce(p.change_24h, 0))::numeric * 5)
               + 0.2 * least(1, log(1 + greatest(coalesce(p.volume, 0), 0)::numeric) / 6) as score
        from pool p
        left join match m on m.id = p.id
    )
    select array_agg(r.id order by r.ord) into v_ids
    from (
        select rk.id,
               row_number() over (order by
                   case when v_sort = 'relevance' then rk.score end desc nulls last,
                   case when v_sort = 'moved' then abs(rk.change_24h) end desc nulls last,
                   case when v_sort = 'ending' then rk.end_date end asc nulls last,
                   case when v_sort = 'volume' then rk.volume end desc nulls last,
                   rk.volume desc nulls last,
                   rk.id) as ord
        from ranked rk
    ) r
    where r.ord <= 100;

    return jsonb_build_object('forecasts', api._c_cards(coalesce(v_ids, '{}')));
end
$$;

-- ---------------------------------------------------------------------------
-- api.forecast({id}) → ForecastResponse
-- The focus forecast must exist, pass the viewer's legal gating and the
-- volume floor; a sample or closed forecast stays reachable by id.
-- ---------------------------------------------------------------------------
create or replace function api.forecast(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_viewer text := api._viewer_country(args);
    v_card jsonb;
    v_provider text;
    v_hidden boolean;
    v_is_sample boolean;
    v_sample boolean;
    v_p numeric;
    v_outcomes text[];
    v_rule text;
    v_history jsonb;
    v_entities jsonb;
    v_story_ids text[];
    v_branches jsonb;
begin
    select fc.card, fc.provider, fc.hidden, fc.is_sample
      into v_card, v_provider, v_hidden, v_is_sample
    from api.forecast_card fc
    where fc.id = v_id;
    if v_card is null or v_hidden or not api._provider_visible(v_provider, v_viewer) then
        raise exception 'Not found: %', v_id;
    end if;
    v_sample := v_is_sample or api._use_sample(args);
    v_p := (v_card ->> 'probability')::numeric;
    select f.outcomes, f.resolution_rule into v_outcomes, v_rule from forecast f where f.node_id = v_id;

    -- History: every snapshot, or 240 evenly spaced ones (first and last kept).
    -- Row k (0-based) of n is kept when it is round(i·(n−1)/239) for some i.
    with s as (
        select fs.ts, fs.probability, fs.volume,
               row_number() over (order by fs.ts) - 1 as k,
               count(*) over () as n
        from forecast_snapshot fs
        where fs.forecast_id = v_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'ts', s.ts, 'p', round(s.probability::numeric, 3), 'volume', s.volume)
           order by s.ts), '[]'::jsonb)
    into v_history
    from s
    where s.n <= 240
       or round(round(s.k * 239.0 / nullif(s.n - 1, 0)) * (s.n - 1) / 239.0) = s.k;

    -- Entities the forecast is about.
    select api._c_entity_refs(coalesce(array_agg(distinct n.id), '{}')) into v_entities
    from edge e
    join node n on n.id = e.dst
    where e.src = v_id and e.type = 'about'
      and n.type not in ('story', 'forecast', 'user_entity')
      and (v_sample or not n.is_sample);

    -- Related stories: relates_to first, then events about the same entities
    -- (mentioning them or located in them), most entities shared, then importance.
    with about as (
        select n.id
        from edge e
        join node n on n.id = e.dst
        where e.src = v_id and e.type = 'about'
          and n.type not in ('sector', 'story', 'forecast', 'user_entity', 'indicator')
    ),
    rel as (
        select e.dst as id, 0 as grp, null::text as about
        from edge e where e.src = v_id and e.type = 'relates_to'
    ),
    men as (
        select e.src as id, 1 as grp, a.id as about
        from about a join edge e on e.dst = a.id and e.type = 'mentions'
        union all
        select s.node_id, 1, a.id from about a join story s on s.country_id = a.id
        union all
        select s.node_id, 1, a.id from about a join story s on s.admin1_id = a.id
        union all
        select s.node_id, 1, a.id from about a join story s on s.primary_region = a.id
    ),
    cand as (
        select c.id, min(c.grp) as grp, count(distinct c.about) as hits
        from (select * from rel union all select * from men) c
        group by c.id
    )
    select array_agg(t.id order by t.grp, t.hits desc, t.importance desc, t.id) into v_story_ids
    from (
        select c.id, c.grp, c.hits, s.importance
        from cand c
        join story s on s.node_id = c.id
        join node n on n.id = c.id
        where s.analysis_status <> 'skipped'
          and (v_sample or not n.is_sample)
          and (c.grp = 0 or s.kind = 'event')
        order by c.grp, c.hits desc, s.importance desc, c.id
        limit 8
    ) t;

    -- If YES / If NO: conditional links that hang on this forecast.
    with eff as (
        select upper(cl.outcome) as outcome, cl.id as link_id, cl.src_story, cl.mechanism,
               cl.confidence, sc.card, sc.importance, sc.id as story_id
        from causal_link cl
        join api.story_card sc on sc.id = cl.dst_story
        join story src on src.node_id = cl.src_story
        join node srcn on srcn.id = cl.src_story
        where cl.forecast_id = v_id
          and cl.link_type = 'conditional'
          and upper(cl.outcome) in ('YES', 'NO')
          and sc.analysis_status <> 'skipped'
          and src.analysis_status <> 'skipped'
          and (v_sample or (not sc.is_sample and not srcn.is_sample))
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'outcome', b.outcome,
               'probability', case b.outcome when 'YES' then round(v_p, 3) else round(1 - v_p, 3) end,
               'effects', b.effects)
           order by case b.outcome when 'YES' then 0 else 1 end), '[]'::jsonb)
    into v_branches
    from (
        select e.outcome,
               jsonb_agg(e.card || jsonb_build_object(
                             'mechanism', e.mechanism,
                             'confidence', round(e.confidence::numeric, 3),
                             'from_story', e.src_story)
                         order by e.confidence desc, e.importance desc, e.story_id, e.link_id) as effects
        from eff e
        group by e.outcome
    ) b;

    return jsonb_build_object(
        'forecast', v_card || jsonb_build_object(
            'history', v_history,
            'outcomes', to_jsonb(coalesce(v_outcomes, '{}')),
            'resolution_rule', v_rule,
            'entities', v_entities,
            'stories', api._c_story_cards(coalesce(v_story_ids, '{}'))),
        'branches', v_branches);
end
$$;

-- ---------------------------------------------------------------------------
-- api.affects({profile, window?, sample?}) → AffectsResponse
-- Direct matches (events in the window) and stories up to two causal hops
-- downstream of them, at most 30, by relevance. Downstream relevance is the
-- origin's weight × (0.5 + 0.5 × chain confidence) × 0.85 per hop ×
-- (0.5 + importance / 200), where the chain confidence is the origin's
-- confidence times each link's.
-- ---------------------------------------------------------------------------
create or replace function api.affects(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_profile jsonb := case when jsonb_typeof(args -> 'profile') = 'object' then args -> 'profile' end;
    v_since timestamptz := now() - api._c_window(args, '7d');
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_items jsonb;
    v_targets text[];
    v_forecasts jsonb;
    v_pool_ids text[];
    v_pool_change real[];
    v_pool_volume double precision[];
begin
    if not api._c_profile_present(v_profile) then
        return jsonb_build_object('items', '[]'::jsonb, 'suggested_forecasts', '[]'::jsonb);
    end if;

    -- Forecasts this viewer may see (for conditional links and suggestions).
    select coalesce(array_agg(p.id), '{}'), coalesce(array_agg(p.change_24h), '{}'),
           coalesce(array_agg(p.volume), '{}')
      into v_pool_ids, v_pool_change, v_pool_volume
    from api._c_forecast_pool(v_viewer, v_sample) p;

    with direct as materialized (
        select pm.story_id as id, pm.weight, pm.matched, pm.confidence, pm.importance, pm.relevance
        from api._c_profile_matches(v_profile, v_since, v_sample, false) pm
    ),
    hop1 as materialized (
        select cl.dst_story as id, array[d.id, cl.dst_story] as path, d.weight, d.matched,
               coalesce(d.confidence, 0.5)::numeric * cl.confidence::numeric as conf
        from direct d
        join causal_link cl on cl.src_story = d.id
        join story s on s.node_id = cl.dst_story
        join node n on n.id = cl.dst_story
        where s.analysis_status <> 'skipped'
          and (v_sample or not n.is_sample)
          and (cl.forecast_id is null or cl.forecast_id = any(v_pool_ids))
    ),
    hop2 as (
        select cl.dst_story as id, h.path || cl.dst_story as path, h.weight, h.matched,
               h.conf * cl.confidence::numeric as conf
        from hop1 h
        join causal_link cl on cl.src_story = h.id
        join story s on s.node_id = cl.dst_story
        join node n on n.id = cl.dst_story
        where cl.dst_story <> all(h.path)
          and s.analysis_status <> 'skipped'
          and (v_sample or not n.is_sample)
          and (cl.forecast_id is null or cl.forecast_id = any(v_pool_ids))
    ),
    -- The best path to each downstream story (shortest, then by id, on ties).
    down as (
        select distinct on (x.id) x.*
        from (
            select h.id, h.path, h.matched, s.importance,
                   round(greatest(0, least(1, h.weight * (0.5 + 0.5 * h.conf)
                                              * power(0.85::numeric, cardinality(h.path) - 1)
                                              * (0.5 + s.importance::numeric / 200))), 3) as relevance
            from (select * from hop1 union all select * from hop2) h
            join story s on s.node_id = h.id
        ) x
        order by x.id, x.relevance desc, cardinality(x.path), x.path
    ),
    -- One row per story: the direct match unless a downstream path scores higher.
    best as (
        select coalesce(d.id, w.id) as id,
               case when w.id is null or d.relevance >= w.relevance then array[d.id] else w.path end as path,
               case when w.id is null or d.relevance >= w.relevance then d.matched else w.matched end as matched,
               greatest(d.relevance, w.relevance) as relevance,
               coalesce(d.importance, w.importance) as importance
        from direct d
        full join down w on w.id = d.id
    ),
    top as (
        select b.*
        from best b
        order by b.relevance desc, b.importance desc, b.id
        limit 30
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'story', c.card,
               'matched', api._c_entity_refs(t.matched),
               'path', to_jsonb(t.path),
               'relevance', t.relevance,
               'actions', to_jsonb(s.actions))
           order by t.relevance desc, t.importance desc, t.id), '[]'::jsonb)
    into v_items
    from top t
    join story s on s.node_id = t.id
    join api.story_card c on c.id = t.id;

    -- Suggested forecasts: about a profile node or the country of a profile
    -- state or city; the biggest 24-hour moves first, then volume.
    select coalesce(array_agg(distinct x.id), '{}') into v_targets
    from (
        select pn.node_id as id from api._c_profile_nodes(v_profile) pn
        union all
        select pl.region_id from api._c_profile_places(v_profile) pl where pl.scope = 'country'
    ) x;

    select api._c_cards(coalesce(array_agg(p.id order by p.ord), '{}')) into v_forecasts
    from (
        select p.id,
               row_number() over (order by abs(p.change_24h) desc nulls last, p.volume desc nulls last, p.id) as ord
        from unnest(v_pool_ids, v_pool_change, v_pool_volume) as p(id, change_24h, volume)
        where exists (
            select 1 from edge e
            where e.src = p.id and e.type = 'about' and e.dst = any(v_targets))
    ) p
    where p.ord <= 6;

    return jsonb_build_object('items', v_items, 'suggested_forecasts', v_forecasts);
end
$$;

-- ---------------------------------------------------------------------------
-- api.opportunities helpers
-- ---------------------------------------------------------------------------

-- Who an opportunity suits: sector names first, then the organisations and
-- commodities it mentions. At most three.
create or replace function api._c_suits(p_story text, p_sample boolean) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(t.name order by t.grp, t.ord, t.name), '[]'::jsonb)
    from (
        select x.name, min(x.grp) as grp, min(x.ord) as ord
        from (
            select coalesce(n.name, initcap(replace(sec.id, '-', ' '))) as name, 0 as grp, sec.ord
            from story s
            cross join lateral unnest(s.sectors) with ordinality as sec(id, ord)
            left join node n on n.id = 'sector:' || sec.id
            where s.node_id = p_story
            union all
            select n.name, case n.type when 'organization' then 1 else 2 end, 0
            from edge e
            join node n on n.id = e.dst
            where e.src = p_story and e.type = 'mentions'
              and n.type in ('organization', 'commodity')
              and (p_sample or not n.is_sample)
        ) x
        group by x.name
        order by min(x.grp), min(x.ord), x.name
        limit 3
    ) t
$$;

-- The best related forecast for each story, among p_visible: one its
-- conditional links hang on or that relates to it, else one about the
-- entities it mentions or its country (most shared, then the biggest volume).
-- Stories without one are left out. The joins start from the stories (a page
-- of at most 40), never from the forecasts' about edges.
create or replace function api._c_best_forecasts(p_stories text[], p_visible text[])
returns table (story_id text, forecast_id text)
language sql stable set search_path = public, extensions as $$
    with st as materialized (
        select distinct x.id from unnest(p_stories) as x(id)
    ),
    vis as materialized (
        select distinct x.id from unnest(p_visible) as x(id)
    ),
    subjects as materialized (
        -- what each story is about: the entities it mentions (not sectors) and its country
        select st.id as story_id, m.dst as about
        from st
        join edge m on m.src = st.id and m.type = 'mentions'
        join node mn on mn.id = m.dst
        where mn.type not in ('sector', 'story', 'forecast', 'user_entity', 'indicator')
        union
        select st.id, s.country_id
        from st
        join story s on s.node_id = st.id
        where s.country_id is not null
    ),
    cand as (
        select cl.dst_story as story_id, cl.forecast_id as fid, 0 as grp, null::text as about
        from st
        join causal_link cl on cl.dst_story = st.id
        where cl.forecast_id is not null
        union all
        select e.dst, e.src, 0, null
        from st
        join edge e on e.dst = st.id and e.type = 'relates_to'
        union all
        select sj.story_id, e.src, 1, sj.about
        from subjects sj
        join edge e on e.dst = sj.about and e.type = 'about'
    ),
    per as (
        select c.story_id, c.fid, min(c.grp) as grp, count(distinct c.about) as hits
        from cand c
        join vis on vis.id = c.fid
        group by c.story_id, c.fid
    )
    select distinct on (p.story_id) p.story_id, p.fid
    from per p
    left join lateral (
        select fs.volume from forecast_snapshot fs
        where fs.forecast_id = p.fid
        order by fs.ts desc
        limit 1
    ) v on true
    order by p.story_id, p.grp, p.hits desc, v.volume desc nulls last, p.fid
$$;

-- ---------------------------------------------------------------------------
-- api.opportunities({sectors?, regions?, profile?, window?, sample?})
-- → OpportunitiesResponse: opportunity events in the window and the projected
-- opportunities that events in the window lead to, at most 40, by
-- 0.6 × relevance + 0.4 × momentum.
--   momentum   0.6 × exp(−age_hours / 72) + 0.4 × min(1, sources / 20); a
--              projected story uses its leading event's age and half its
--              sources (the best leading event when there are several)
--   relevance  the direct profile match (as in api.affects), or
--              importance / 100 without a profile
-- ---------------------------------------------------------------------------
create or replace function api.opportunities(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_profile jsonb := case when jsonb_typeof(args -> 'profile') = 'object' then args -> 'profile' end;
    v_has_profile boolean;
    v_since timestamptz := now() - api._c_window(args, '30d');
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_regions text[] := api._text_array(args -> 'regions');
    v_scope text[];
    v_visible text[];
    v_ids text[];
    v_momentum numeric[];
    v_relevance numeric[];
    v_best jsonb;
    v_cards jsonb;
    v_items jsonb;
begin
    v_has_profile := api._c_profile_present(v_profile);
    -- Regions: the region itself, plus member countries of a bloc.
    if v_regions is not null then
        v_scope := v_regions || array(
            select m.src from edge m where m.type = 'member_of' and m.dst = any(v_regions));
    end if;
    -- Forecasts this viewer may see.
    select coalesce(array_agg(p.id), '{}') into v_visible
    from api._c_forecast_pool(v_viewer, v_sample) p;

    with cand as (
        -- opportunity events: their own age and coverage
        select s.node_id as id,
               0.6 * exp(-greatest(extract(epoch from now() - s.first_seen)::float8, 0) / 3600 / 72)
               + 0.4 * least(1, s.source_count / 20.0::float8) as momentum
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.impact = 'opportunity'
          and s.first_seen >= v_since
          and s.analysis_status <> 'skipped'
          and (v_sample or not n.is_sample)
        union all
        -- projected opportunities: the leading event's age, half its coverage
        select p.node_id,
               max(0.6 * exp(-greatest(extract(epoch from now() - src.first_seen)::float8, 0) / 3600 / 72)
                   + 0.4 * least(1, src.source_count * 0.5 / 20.0::float8))
        from story p
        join node pn on pn.id = p.node_id
        join causal_link cl on cl.dst_story = p.node_id
        join story src on src.node_id = cl.src_story
        join node srcn on srcn.id = cl.src_story
        where p.kind = 'projected'
          and p.impact = 'opportunity'
          and p.analysis_status <> 'skipped'
          and (v_sample or not pn.is_sample)
          and src.kind = 'event'
          and src.first_seen >= v_since
          and src.analysis_status <> 'skipped'
          and (v_sample or not srcn.is_sample)
          and (cl.forecast_id is null or cl.forecast_id = any(v_visible))
        group by p.node_id
    ),
    filtered as materialized (
        select c.id, c.momentum, s.importance
        from cand c
        join story s on s.node_id = c.id
        where (v_sectors is null or s.sectors && v_sectors)
          and (v_scope is null
               or s.country_id = any(v_scope)
               or s.admin1_id = any(v_scope)
               or s.primary_region = any(v_scope)
               or exists (select 1 from edge e
                          where e.src = c.id and e.type = 'mentions' and e.dst = any(v_scope)))
    ),
    prof as (
        select pm.story_id, pm.relevance
        from api._c_profile_matches(case when v_has_profile then v_profile end, v_since, v_sample, true,
                                    'opportunity') pm
    ),
    scored as (
        select f.id,
               round(least(1, greatest(0, f.momentum))::numeric, 3) as momentum,
               case when v_has_profile then coalesce(p.relevance, 0)
                    else round(least(1, greatest(0, f.importance::numeric / 100)), 3) end as relevance,
               f.importance
        from filtered f
        left join prof p on p.story_id = f.id
    )
    select array_agg(t.id order by t.rank desc, t.importance desc, t.id),
           array_agg(t.momentum order by t.rank desc, t.importance desc, t.id),
           array_agg(t.relevance order by t.rank desc, t.importance desc, t.id)
      into v_ids, v_momentum, v_relevance
    from (
        select sc.*, sc.relevance * 0.6 + sc.momentum * 0.4 as rank
        from scored sc
        order by sc.relevance * 0.6 + sc.momentum * 0.4 desc, sc.importance desc, sc.id
        limit 40
    ) t;
    v_ids := coalesce(v_ids, '{}');

    -- The best related forecast per story; each card is built once.
    select coalesce(jsonb_object_agg(b.story_id, b.forecast_id), '{}'::jsonb) into v_best
    from api._c_best_forecasts(v_ids, v_visible) b;
    v_cards := api._c_card_map(array(select distinct x.value from jsonb_each_text(v_best) as x));

    select coalesce(jsonb_agg(jsonb_build_object(
               'story', c.card,
               'why_now', coalesce(s.so_what,
                                   (select a.snippet from article a
                                    where a.story_id = s.node_id and a.snippet is not null
                                    order by a.published_at desc nulls last, a.id desc limit 1),
                                   s.headline),
               'suits', api._c_suits(i.id, v_sample),
               'forecast', v_cards -> (v_best ->> i.id),
               'momentum', i.momentum,
               'relevance', i.relevance)
           order by i.ord), '[]'::jsonb)
    into v_items
    from unnest(v_ids, coalesce(v_momentum, '{}'), coalesce(v_relevance, '{}'))
         with ordinality as i(id, momentum, relevance, ord)
    join story s on s.node_id = i.id
    join api.story_card c on c.id = i.id;

    return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------
-- api.ask_context({q, limit?, sample?}) → AskContextResponse
-- Words: at least three characters (with a letter), lowercase, no stop
-- words, at most 12. Entities match a word by name or alias; stories mention
-- those entities, sit in those regions, or use the words in their headline or
-- so-what (full-text, English stemming); they rank by the number of words
-- they match + importance / 100.
-- ---------------------------------------------------------------------------
create or replace function api.ask_context(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_qn text := btrim(regexp_replace(lower(left(coalesce(args ->> 'q', ''), 500)), '[^[:alnum:]]+', ' ', 'g'));
    v_limit integer := api._c_int(args -> 'limit', 12, 1, 25);
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_words text[];
    v_res text[];
    v_queries tsquery[];
    v_ent_ids text[];
    v_ent_words text[];
    v_story_ids text[];
    v_stories jsonb;
    v_links jsonb;
    v_forecasts jsonb;
    v_pool_ids text[];
    v_pool_volume double precision[];
begin
    select coalesce(array_agg(t.w order by t.pos), '{}') into v_words
    from (
        select x.w, min(x.pos) as pos
        from regexp_split_to_table(v_qn, ' ') with ordinality as x(w, pos)
        where char_length(x.w) >= 3
          and x.w ~ '[[:alpha:]]'
          and x.w <> all(api._c_stop_words())
        group by x.w
        order by min(x.pos)
        limit 12
    ) t;
    if cardinality(v_words) = 0 then
        return jsonb_build_object('entities', '[]'::jsonb, 'stories', '[]'::jsonb,
                                  'links', '[]'::jsonb, 'forecasts', '[]'::jsonb);
    end if;
    -- Per word: a whole-word pattern (singular and plural) for names and
    -- titles, and a full-text query (null for English stop words).
    select array_agg(api._c_word_regex(w.w) order by w.ord),
           array_agg(case when length(to_tsvector('english'::regconfig, w.w)) > 0
                          then plainto_tsquery('english'::regconfig, w.w) end order by w.ord)
      into v_res, v_queries
    from unnest(v_words) with ordinality as w(w, ord);

    -- Forecasts this viewer may see.
    select coalesce(array_agg(p.id), '{}'), coalesce(array_agg(p.volume), '{}')
      into v_pool_ids, v_pool_volume
    from api._c_forecast_pool(v_viewer, v_sample) p;

    -- Entities: names or aliases that match a word, scored per (entity, word):
    --   1.0  the name equals the word, or a multi-word name appears in the question
    --   0.9  the word is the name plus a short ending ("indian" → India)
    --   0.8  the name's first word is the word ("crude" → Crude oil)
    --   0.6  the name contains the word ("oil" → Palm oil)
    --   0.4–0.7  the name starts with the word (four letters or more)
    --   similarity × 0.7  trigram similarity (candidates from pg_trgm's 0.3,
    --        kept from 0.4: below that they are mostly unrelated place names)
    -- For each word only the matches close to its best one are kept (within
    -- 0.2), so "red sea" keeps Red Sea and drops Redbridge. Each entity
    -- remembers the words it matched.
    with words as (
        select * from unnest(v_words, v_res) as w(w, re)
    ),
    labels as (
        select n.id, n.name as label
        from words w
        join node n on n.type not in ('story', 'forecast')
                   and (n.name ilike w.w || '%' or n.name % w.w or n.name ~* w.re)
        union
        select n.id, a.alias
        from node n
        cross join lateral unnest(n.aliases) as a(alias)
        where n.aliases <> '{}'
          and n.type not in ('story', 'forecast')
          and exists (select 1 from words w
                      where a.alias ilike w.w || '%' or a.alias % w.w or a.alias ~* w.re)
    ),
    norm as (
        select l.id, btrim(regexp_replace(lower(l.label), '[^[:alnum:]]+', ' ', 'g')) as label
        from labels l
        join node n on n.id = l.id
        where n.type not in ('story', 'forecast', 'user_entity', 'indicator')
          and (v_sample or not n.is_sample)
    ),
    pairs as (
        select nm.id, w.w,
               case
                   when nm.label = w.w then 1.0
                   when position(' ' in nm.label) > 0
                        and strpos(' ' || v_qn || ' ', ' ' || nm.label || ' ') > 0
                        and strpos(' ' || nm.label || ' ', ' ' || w.w || ' ') > 0 then 1.0
                   when char_length(nm.label) >= 4 and starts_with(w.w, nm.label)
                        and char_length(w.w) - char_length(nm.label) <= 3 then 0.9
                   when starts_with(nm.label, w.w || ' ') then 0.8
                   when strpos(' ' || nm.label || ' ', ' ' || w.w || ' ') > 0 then 0.6
                   when char_length(w.w) >= 4 and starts_with(nm.label, w.w)
                       then round(0.4 + 0.3 * char_length(w.w)::numeric
                                        / char_length(split_part(nm.label, ' ', 1)), 3)
                   when similarity(nm.label, w.w) >= 0.4
                       then round(similarity(nm.label, w.w)::numeric * 0.7, 3)
                   else 0
               end as score
        from norm nm
        cross join words w
    ),
    kept as (
        select p.id, p.w, p.score
        from (
            select p.*, max(p.score) over (partition by p.w) as best
            from pairs p
            where p.score > 0
        ) p
        where p.score > p.best - 0.2
    ),
    ranked as (
        select k.id, max(k.score) as score, array_agg(distinct k.w) as words
        from kept k
        group by k.id
    ),
    picked as (
        select r.id, r.words,
               row_number() over (order by r.score desc,
                                  case when rg.level = 'country' then 0
                                       when n.type in ('commodity', 'organization', 'infrastructure', 'policy') then 1
                                       when rg.level = 'bloc' then 1
                                       when n.type = 'sector' then 2
                                       when rg.level = 'state' then 3
                                       else 4 end,
                                  length(n.name), n.id) as ord
        from ranked r
        join node n on n.id = r.id
        left join region rg on rg.node_id = n.id
    )
    select coalesce(array_agg(p.id order by p.ord), '{}'),
           coalesce(array_agg(array_to_string(p.words, ' ') order by p.ord), '{}')
      into v_ent_ids, v_ent_words
    from picked p
    where p.ord <= 8;

    -- Stories: hits per (story, word), ranked by words matched + importance / 100.
    -- Each hit carries the story's ranking columns, so only the page of
    -- winners is looked up again. Sample stories are excluded through the
    -- small set of sample ids.
    with ent as (
        select * from unnest(v_ent_ids, v_ent_words) as e(id, words)
    ),
    ent_hits(story_id, ent_id, importance, first_seen, status) as (
        select s.node_id, e.dst, s.importance, s.first_seen, s.analysis_status
        from edge e
        join story s on s.node_id = e.src
        where e.dst = any(v_ent_ids) and e.type = 'mentions'
        union all
        select s.node_id, s.country_id, s.importance, s.first_seen, s.analysis_status
        from story s where s.country_id = any(v_ent_ids)
        union all
        select s.node_id, s.admin1_id, s.importance, s.first_seen, s.analysis_status
        from story s where s.admin1_id = any(v_ent_ids)
        union all
        select s.node_id, s.primary_region, s.importance, s.first_seen, s.analysis_status
        from story s where s.primary_region = any(v_ent_ids)
    ),
    hits(story_id, w, importance, first_seen) as (
        select h.story_id, unnest(string_to_array(en.words, ' ')), h.importance, h.first_seen
        from ent_hits h
        join ent en on en.id = h.ent_id
        where h.status <> 'skipped'
        union all
        select s.node_id, w.w, s.importance, s.first_seen
        from unnest(v_words, v_queries) as w(w, q)
        join story s
          on to_tsvector('english'::regconfig, s.headline || ' ' || coalesce(s.so_what, '')) @@ w.q
        where w.q is not null
          and s.analysis_status <> 'skipped'
    ),
    story_rank as (
        select d.story_id, count(*) + max(d.importance)::numeric / 100 as rank, max(d.first_seen) as first_seen
        from (select distinct h.story_id, h.w, h.importance, h.first_seen from hits h) d
        group by d.story_id
    )
    select array_agg(t.story_id order by t.rank desc, t.first_seen desc nulls last, t.story_id)
      into v_story_ids
    from (
        select r.story_id, r.rank, r.first_seen
        from story_rank r
        where v_sample or r.story_id not in (select n.id from node n where n.is_sample)
        order by r.rank desc, r.first_seen desc nulls last, r.story_id
        limit v_limit
    ) t;
    v_story_ids := coalesce(v_story_ids, '{}');

    -- Stories with their newest sources (at most 3) and actions.
    select coalesce(jsonb_agg(c.card || jsonb_build_object(
               'sources', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'source_name', a.source_name, 'title', a.title, 'url', a.url,
                              'published_at', a.published_at)
                          order by a.published_at desc nulls last, a.id desc), '[]'::jsonb)
                   from (select * from article a
                         where a.story_id = i.id
                         order by a.published_at desc nulls last, a.id desc
                         limit 3) a),
               'actions', to_jsonb(s.actions))
           order by i.ord), '[]'::jsonb)
    into v_stories
    from unnest(v_story_ids) with ordinality as i(id, ord)
    join story s on s.node_id = i.id
    join api.story_card c on c.id = i.id;

    -- Causal links touching the returned stories: links between them first.
    with touching as (
        select cl.id from causal_link cl where cl.src_story = any(v_story_ids)
        union
        select cl.id from causal_link cl where cl.dst_story = any(v_story_ids)
    ),
    ok as (
        select cl.*,
               (cl.src_story = any(v_story_ids) and cl.dst_story = any(v_story_ids)) as inner_link
        from touching t
        join causal_link cl on cl.id = t.id
        join story ss on ss.node_id = cl.src_story
        join node sn on sn.id = cl.src_story
        join story ds on ds.node_id = cl.dst_story
        join node dn on dn.id = cl.dst_story
        where ss.analysis_status <> 'skipped'
          and ds.analysis_status <> 'skipped'
          and (v_sample or (not sn.is_sample and not dn.is_sample))
          and (cl.forecast_id is null or cl.forecast_id = any(v_pool_ids))
        order by inner_link desc, cl.confidence desc, cl.id
        limit 20
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ok.id,
               'src', ok.src_story,
               'dst', ok.dst_story,
               'link_type', ok.link_type,
               'mechanism', ok.mechanism,
               'direction', ok.direction,
               'confidence', round(ok.confidence::numeric, 3),
               'lag_days', ok.lag_days,
               'forecast_id', ok.forecast_id,
               'outcome', ok.outcome,
               'evidence', coalesce((
                   select jsonb_agg(jsonb_build_object(
                              'source_name', ev.source_name, 'url', ev.url,
                              'published_at', ev.published_at, 'snippet', ev.snippet,
                              'is_sample', ev.is_sample)
                          order by ev.published_at desc nulls last, ev.id)
                   from evidence ev where ev.causal_link_id = ok.id), '[]'::jsonb))
           order by ok.inner_link desc, ok.confidence desc, ok.id), '[]'::jsonb)
    into v_links
    from ok;

    -- Forecasts about the entities, or whose title or question uses the words.
    select api._c_cards(coalesce(array_agg(t.id order by t.ord), '{}')) into v_forecasts
    from (
        select p.id,
               row_number() over (order by h.about_hits + h.word_hits desc, p.volume desc nulls last, p.id) as ord
        from unnest(v_pool_ids, v_pool_volume) as p(id, volume)
        join forecast f on f.node_id = p.id
        cross join lateral (
            select (select count(distinct e.dst) from edge e
                    where e.src = p.id and e.type = 'about' and e.dst = any(v_ent_ids)) as about_hits,
                   (select count(*) from unnest(v_res) as w(re)
                    where f.short_title ~* w.re or f.question ~* w.re) as word_hits
        ) h
        where h.about_hits > 0 or h.word_hits > 0
    ) t
    where t.ord <= 6;

    return jsonb_build_object(
        'entities', api._c_entity_refs_ordered(v_ent_ids),
        'stories', v_stories,
        'links', v_links,
        'forecasts', v_forecasts);
end
$$;

-- ---------------------------------------------------------------------------
-- api.pending_analysis({limit?}) → PendingAnalysisResponse
-- ---------------------------------------------------------------------------

-- Earlier analysed events that might have caused this story: 'done' events
-- from the 30 days before it, live or sample like the story itself, at most 6.
-- Preference: sharing a mentioned entity (not a sector or a country; most
-- shared first), then the same country, then a shared sector; within each,
-- by importance. Each step runs only while places are left, and each reaches
-- stories through an index (mentions, country + date, sectors).
create or replace function api._c_candidates(p_id text) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_seen timestamptz;
    v_country text;
    v_sectors text[];
    v_sample boolean;
    v_ids text[];
begin
    select s.first_seen, s.country_id, s.sectors, n.is_sample
      into v_seen, v_country, v_sectors, v_sample
    from story s
    join node n on n.id = s.node_id
    where s.node_id = p_id;
    if v_seen is null then
        return '[]'::jsonb;
    end if;

    -- 1. A shared entity.
    select coalesce(array_agg(t.id order by t.shared desc, t.importance desc, t.first_seen desc, t.id), '{}')
      into v_ids
    from (
        select s.node_id as id, count(distinct m.dst) as shared, s.importance, s.first_seen
        from edge m
        join node en on en.id = m.dst
        left join region r on r.node_id = m.dst
        join edge e on e.dst = m.dst and e.type = 'mentions'
        join story s on s.node_id = e.src
        join node n on n.id = e.src
        where m.src = p_id and m.type = 'mentions'
          and en.type not in ('sector', 'story', 'forecast', 'user_entity', 'indicator')
          and r.level is distinct from 'country'
          and s.node_id <> p_id
          and s.kind = 'event' and s.analysis_status = 'done'
          and s.first_seen < v_seen and s.first_seen >= v_seen - interval '30 days'
          and n.is_sample = v_sample
        group by s.node_id, s.importance, s.first_seen
        order by count(distinct m.dst) desc, s.importance desc, s.first_seen desc, s.node_id
        limit 6
    ) t;

    -- 2. The same country.
    if cardinality(v_ids) < 6 and v_country is not null then
        v_ids := v_ids || array(
            select s.node_id
            from story s
            join node n on n.id = s.node_id
            where s.country_id = v_country
              and s.kind = 'event' and s.analysis_status = 'done'
              and s.first_seen < v_seen and s.first_seen >= v_seen - interval '30 days'
              and n.is_sample = v_sample
              and s.node_id <> p_id
              and s.node_id <> all(v_ids)
            order by s.importance desc, s.first_seen desc, s.node_id
            limit 6 - cardinality(v_ids));
    end if;

    -- 3. A shared sector.
    if cardinality(v_ids) < 6 and cardinality(v_sectors) > 0 then
        v_ids := v_ids || array(
            select s.node_id
            from story s
            join node n on n.id = s.node_id
            where s.sectors && v_sectors
              and s.kind = 'event' and s.analysis_status = 'done'
              and s.first_seen < v_seen and s.first_seen >= v_seen - interval '30 days'
              and n.is_sample = v_sample
              and s.node_id <> p_id
              and s.node_id <> all(v_ids)
            order by s.importance desc, s.first_seen desc, s.node_id
            limit 6 - cardinality(v_ids));
    end if;

    return api._c_story_cards(v_ids);
end
$$;

-- One pending item: what the AI needs to analyse the story.
create or replace function api._c_pending_item(p_id text) returns jsonb
language sql stable set search_path = public, extensions as $$
    select jsonb_build_object(
        'id', s.node_id,
        'titles', coalesce((
            select jsonb_agg(t.title order by t.latest desc nulls last, t.title)
            from (select a.title, max(a.published_at) as latest
                  from article a where a.story_id = s.node_id
                  group by a.title
                  order by max(a.published_at) desc nulls last, a.title
                  limit 8) t), '[]'::jsonb),
        'snippets', coalesce((
            select jsonb_agg(t.snippet order by t.latest desc nulls last, t.snippet)
            from (select a.snippet, max(a.published_at) as latest
                  from article a where a.story_id = s.node_id and a.snippet is not null
                  group by a.snippet
                  order by max(a.published_at) desc nulls last, a.snippet
                  limit 5) t), '[]'::jsonb),
        'sources', coalesce((
            select jsonb_agg(t.source_name order by t.n desc, t.source_name)
            from (select a.source_name, count(*) as n
                  from article a where a.story_id = s.node_id
                  group by a.source_name
                  order by count(*) desc, a.source_name
                  limit 20) t), '[]'::jsonb),
        'first_seen', coalesce(s.first_seen, s.last_seen, n.created_at),
        'region', api._region_ref(coalesce(s.primary_region, s.admin1_id, s.country_id)),
        'event_type', s.event_type,
        'sectors', to_jsonb(array(select x from unnest(s.sectors) as x where x = any(api._c_sectors()))),
        'entities', coalesce((
            select api._c_entity_refs(array_agg(distinct en.id))
            from edge e
            join node en on en.id = e.dst
            where e.src = s.node_id and e.type = 'mentions'
              and en.type not in ('sector', 'story', 'forecast', 'user_entity', 'indicator')), '[]'::jsonb),
        'candidates', api._c_candidates(s.node_id))
    from story s
    join node n on n.id = s.node_id
    where s.node_id = p_id
$$;

create or replace function api.pending_analysis(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_limit integer := api._c_int(args -> 'limit', 12, 1, 30);
    v_total integer;
    v_items jsonb;
begin
    select count(*) into v_total from story where analysis_status = 'pending';

    select coalesce(jsonb_agg(api._c_pending_item(t.node_id)
                              order by t.importance desc, t.first_seen desc nulls last, t.node_id), '[]'::jsonb)
    into v_items
    from (
        select s.node_id, s.importance, s.first_seen
        from story s
        where s.analysis_status = 'pending'
        order by s.importance desc, s.first_seen desc nulls last, s.node_id
        limit v_limit
    ) t;

    return jsonb_build_object('items', v_items, 'total_pending', v_total);
end
$$;

-- ---------------------------------------------------------------------------
-- api.save_analysis({engine, model, items, skipped?}) → SaveAnalysisResponse
-- ---------------------------------------------------------------------------

-- A string of p_min..p_max words (and at most p_max_chars characters).
create or replace function api._c_words_ok(v jsonb, p_min integer, p_max integer, p_max_chars integer)
returns boolean
language sql immutable set search_path = public, extensions as $$
    select case when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') <> ''
                then char_length(v #>> '{}') <= p_max_chars
                     and word_count(v #>> '{}') between p_min and p_max
                else false end
$$;

-- A JSON number within [p_lo, p_hi] (and a whole number when p_int).
create or replace function api._c_num_ok(v jsonb, p_lo numeric, p_hi numeric, p_int boolean)
returns boolean
language sql immutable set search_path = pg_catalog as $$
    select case when jsonb_typeof(v) = 'number'
                then (v #>> '{}')::numeric between p_lo and p_hi
                     and (not p_int or (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric))
                else false end
$$;

-- Why an analysis item can't be saved, or null when it is valid. The same
-- rules as AnalysisItem in contract.ts (checked again here).
create or replace function api._c_item_problem(p_item jsonb) returns text
language plpgsql immutable set search_path = public, extensions as $$
declare
    v_x jsonb;
    v_n integer;
begin
    if jsonb_typeof(p_item) is distinct from 'object' then
        return 'item must be an object';
    end if;
    if jsonb_typeof(p_item -> 'id') is distinct from 'string'
       or (p_item ->> 'id') !~ '^[a-z_]+:[a-z0-9][a-z0-9.-]*$' then
        return 'id must be a story id';
    end if;
    if not api._c_words_ok(p_item -> 'headline', 1, 12, 200) then
        return 'headline must be 1-12 words';
    end if;
    if not api._c_words_ok(p_item -> 'so_what', 1, 20, 300) then
        return 'so_what must be 1-20 words';
    end if;
    if jsonb_typeof(p_item -> 'event_type') is distinct from 'string'
       or char_length(btrim(p_item ->> 'event_type')) not between 2 and 40 then
        return 'event_type must be 2-40 characters';
    end if;
    if coalesce(p_item ->> 'impact', '') not in ('risk', 'opportunity', 'neutral')
       or jsonb_typeof(p_item -> 'impact') <> 'string' then
        return 'impact must be risk, opportunity or neutral';
    end if;
    if coalesce(p_item ->> 'direction', '') not in ('up', 'down')
       or jsonb_typeof(p_item -> 'direction') <> 'string' then
        return 'direction must be up or down';
    end if;
    if not api._c_num_ok(p_item -> 'magnitude', 1, 5, true) then
        return 'magnitude must be a whole number 1-5';
    end if;
    if coalesce(p_item ->> 'horizon', '') not in ('now', 'weeks', 'months')
       or jsonb_typeof(p_item -> 'horizon') <> 'string' then
        return 'horizon must be now, weeks or months';
    end if;
    if not api._c_num_ok(p_item -> 'confidence', 0, 1, false) then
        return 'confidence must be 0-1';
    end if;

    -- sectors: 1-3 different sector ids
    v_x := p_item -> 'sectors';
    if jsonb_typeof(v_x) is distinct from 'array' or jsonb_array_length(v_x) not between 1 and 3 then
        return 'sectors must list 1-3 sectors';
    end if;
    select count(*) into v_n
    from jsonb_array_elements(v_x) as e(v)
    where jsonb_typeof(e.v) <> 'string' or (e.v #>> '{}') <> all(api._c_sectors());
    if v_n > 0 or (select count(distinct e.v) from jsonb_array_elements(v_x) as e(v)) <> jsonb_array_length(v_x) then
        return 'sectors must be different known sector ids';
    end if;

    -- actions: at most 3, each 1-8 words
    v_x := p_item -> 'actions';
    if v_x is not null and jsonb_typeof(v_x) <> 'null' then
        if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) > 3 then
            return 'actions must be a list of at most 3';
        end if;
        if exists (select 1 from jsonb_array_elements(v_x) as e(v) where not api._c_words_ok(e.v, 1, 8, 120)) then
            return 'each action must be 1-8 words';
        end if;
    end if;

    -- entities: at most 12 ids (unknown ones are skipped when saving)
    v_x := p_item -> 'entities';
    if v_x is not null and jsonb_typeof(v_x) <> 'null' then
        if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) > 12 then
            return 'entities must be a list of at most 12 ids';
        end if;
        if exists (select 1 from jsonb_array_elements(v_x) as e(v) where jsonb_typeof(e.v) <> 'string') then
            return 'entities must be ids';
        end if;
    end if;

    -- links: at most 4, each fully described
    v_x := p_item -> 'links';
    if v_x is not null and jsonb_typeof(v_x) <> 'null' then
        if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) > 4 then
            return 'links must be a list of at most 4';
        end if;
        if exists (
            select 1 from jsonb_array_elements(v_x) as e(l)
            where jsonb_typeof(e.l) <> 'object'
               or jsonb_typeof(e.l -> 'from') is distinct from 'string'
               or coalesce(e.l ->> 'link_type', '') not in ('reported', 'inferred')
               or not api._c_words_ok(e.l -> 'mechanism', 2, 4, 80)
               or coalesce(e.l ->> 'direction', '') not in ('up', 'down')
               or not api._c_num_ok(e.l -> 'confidence', 0, 1, false)
               or jsonb_typeof(e.l -> 'evidence') is distinct from 'string'
               or char_length(e.l ->> 'evidence') > 300
        ) then
            return 'each link needs from, link_type (reported or inferred), a 2-4 word mechanism, '
                   'direction, confidence 0-1 and evidence of at most 300 characters';
        end if;
    end if;
    return null;
end
$$;

create or replace function api.save_analysis(args jsonb) returns jsonb
language plpgsql volatile set search_path = public, extensions as $$
declare
    v_engine text := args ->> 'engine';
    v_model text := btrim(args ->> 'model');
    v_items jsonb := coalesce(args -> 'items', '[]'::jsonb);
    v_skips jsonb := coalesce(args -> 'skipped', '[]'::jsonb);
    v_item jsonb;
    v_link jsonb;
    v_id text;
    v_problem text;
    v_story_sample boolean;
    v_story_seen timestamptz;
    v_src text;
    v_src_sample boolean;
    v_src_seen timestamptz;
    v_link_id bigint;
    v_url text;
    v_published timestamptz;
    v_evidence text;
    v_item_links integer;
    v_saved integer := 0;
    v_skipped integer := 0;
    v_links_saved integer := 0;
    v_rejected jsonb := '[]'::jsonb;
begin
    if jsonb_typeof(args -> 'engine') is distinct from 'string' or v_engine not in ('artifact', 'api') then
        raise exception 'engine must be "artifact" or "api"';
    end if;
    if jsonb_typeof(args -> 'model') is distinct from 'string' or v_model = '' or char_length(v_model) > 100 then
        raise exception 'model must name the model (at most 100 characters)';
    end if;
    if jsonb_typeof(v_items) = 'null' then
        v_items := '[]'::jsonb;
    end if;
    if jsonb_typeof(v_skips) = 'null' then
        v_skips := '[]'::jsonb;
    end if;
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 30 then
        raise exception 'items must be a list of at most 30 analyses';
    end if;
    if jsonb_typeof(v_skips) <> 'array' or jsonb_array_length(v_skips) > 30 then
        raise exception 'skipped must be a list of at most 30 stories';
    end if;

    for v_item in select e.v from jsonb_array_elements(v_items) as e(v) loop
        v_id := case when jsonb_typeof(v_item) = 'object' and jsonb_typeof(v_item -> 'id') = 'string'
                     then v_item ->> 'id' else '' end;
        v_problem := api._c_item_problem(v_item);
        if v_problem is null then
            select n.is_sample, s.first_seen into v_story_sample, v_story_seen
            from story s
            join node n on n.id = s.node_id
            where s.node_id = v_id
            for update of s;
            if not found then
                v_problem := 'unknown story';
            end if;
        end if;
        if v_problem is not null then
            v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_problem));
            continue;
        end if;

        begin
            update story set
                headline = btrim(v_item ->> 'headline'),
                so_what = btrim(v_item ->> 'so_what'),
                event_type = btrim(v_item ->> 'event_type'),
                impact = v_item ->> 'impact',
                direction = v_item ->> 'direction',
                magnitude = (v_item ->> 'magnitude')::numeric::smallint,
                horizon = v_item ->> 'horizon',
                confidence = (v_item ->> 'confidence')::real,
                sectors = array(select x.v from jsonb_array_elements_text(v_item -> 'sectors')
                                with ordinality as x(v, ord) order by x.ord),
                actions = array(select btrim(x.v) from jsonb_array_elements_text(
                                    case when jsonb_typeof(v_item -> 'actions') = 'array'
                                         then v_item -> 'actions' else '[]'::jsonb end)
                                with ordinality as x(v, ord) order by x.ord),
                analysis_status = 'done',
                analysed_at = now(),
                analysis_engine = v_engine,
                analysis_model = v_model
            where node_id = v_id;
            update node set name = btrim(v_item ->> 'headline'), updated_at = now() where id = v_id;

            -- Mentions: the listed entities that exist (sample entities only on
            -- sample stories), plus the sector nodes; sector mentions the
            -- analysis no longer lists (the rules-based guess) are dropped.
            delete from edge e
            where e.src = v_id and e.type = 'mentions' and e.dst like 'sector:%'
              and e.dst <> all(array(select 'sector:' || x.v
                                     from jsonb_array_elements_text(v_item -> 'sectors') as x(v)));
            insert into edge (src, dst, type, is_sample)
            select v_id, n.id, 'mentions', v_story_sample
            from (
                select x.v as id from jsonb_array_elements_text(
                    case when jsonb_typeof(v_item -> 'entities') = 'array'
                         then v_item -> 'entities' else '[]'::jsonb end) as x(v)
                union
                select 'sector:' || x.v from jsonb_array_elements_text(v_item -> 'sectors') as x(v)
            ) t
            join node n on n.id = t.id
            where n.id <> v_id
              and n.type not in ('story', 'forecast', 'user_entity', 'indicator')
              and (v_story_sample or not n.is_sample)
            on conflict do nothing;

            -- Evidence points at the newest article of this story.
            v_url := null;
            v_published := null;
            select a.url, a.published_at into v_url, v_published
            from article a
            where a.story_id = v_id and a.url is not null
            order by a.published_at desc nulls last, a.id desc
            limit 1;

            v_item_links := 0;
            for v_link in select e.v from jsonb_array_elements(
                    case when jsonb_typeof(v_item -> 'links') = 'array'
                         then v_item -> 'links' else '[]'::jsonb end) as e(v) loop
                -- The cause must be another event (live or sample like this one).
                v_src := null;
                select s.node_id, n.is_sample, s.first_seen into v_src, v_src_sample, v_src_seen
                from story s
                join node n on n.id = s.node_id
                where s.node_id = v_link ->> 'from'
                  and s.kind = 'event'
                  and s.node_id <> v_id
                  and s.analysis_status <> 'skipped';
                continue when v_src is null or v_src_sample <> v_story_sample;
                -- No loops: skip when the opposite link exists.
                continue when exists (select 1 from causal_link cl
                                      where cl.src_story = v_id and cl.dst_story = v_src);

                v_link_id := null;
                insert into causal_link (src_story, dst_story, link_type, mechanism, direction, lag_days,
                                         confidence, method, model_version, is_sample)
                values (v_src, v_id, v_link ->> 'link_type', btrim(v_link ->> 'mechanism'),
                        v_link ->> 'direction',
                        case when v_story_seen >= v_src_seen
                             then floor(extract(epoch from v_story_seen - v_src_seen) / 86400)::integer end,
                        (v_link ->> 'confidence')::real, 'llm', v_model, v_story_sample)
                on conflict do nothing
                returning id into v_link_id;
                continue when v_link_id is null;
                v_item_links := v_item_links + 1;

                v_evidence := btrim(v_link ->> 'evidence');
                if v_evidence <> '' and (v_url is not null or v_story_sample) then
                    insert into evidence (causal_link_id, source_name, url, published_at, snippet, is_sample)
                    values (v_link_id, 'AI analysis (' || v_engine || ')', v_url, v_published,
                            v_evidence, v_story_sample);
                end if;
            end loop;

            v_saved := v_saved + 1;
            v_links_saved := v_links_saved + v_item_links;
        exception when others then
            v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
                'id', v_id, 'reason', 'could not save: ' || left(sqlerrm, 160)));
        end;
    end loop;

    -- Stories judged not to be business news. Marking one 'skipped' fires
    -- the story_skipped trigger (0009): a live story and its articles are
    -- deleted and their URLs remembered, so it disappears everywhere.
    for v_item in select e.v from jsonb_array_elements(v_skips) as e(v) loop
        v_id := case when jsonb_typeof(v_item) = 'object' and jsonb_typeof(v_item -> 'id') = 'string'
                     then v_item ->> 'id' else '' end;
        begin
            update story set
                analysis_status = 'skipped',
                analysed_at = now(),
                analysis_engine = v_engine,
                analysis_model = v_model
            where node_id = v_id and analysis_status = 'pending';
            if found then
                v_skipped := v_skipped + 1;
            else
                v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
                    'id', v_id, 'reason', 'not a pending story'));
            end if;
        exception when others then
            v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
                'id', v_id, 'reason', 'could not skip: ' || left(sqlerrm, 160)));
        end;
    end loop;

    return jsonb_build_object(
        'saved', v_saved,
        'skipped', v_skipped,
        'rejected', v_rejected,
        'links_saved', v_links_saved);
end
$$;
