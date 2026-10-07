-- 0004: api functions for the map and region screens.
--
--   api.meta     app-wide counts, the sector lenses and attribution
--   api.globe    events, cross-border arcs, forecast rings and country heat
--   api.top      "Top 5 now" and the biggest forecast movers
--   api.region   the region panel (any level: bloc, country, state, city)
--   api.compare  two or three regions side by side
--   api.brief    the six-card daily brief
--
-- Private helpers use the prefix api._a_ (this group's prefix).

-- ---------------------------------------------------------------------------
-- Indexes: stories in a region within a time window.
-- ---------------------------------------------------------------------------
create index if not exists story_country_seen_a_idx on story (country_id, first_seen) where kind = 'event';
create index if not exists story_admin1_seen_a_idx on story (admin1_id, first_seen) where kind = 'event';
create index if not exists story_primary_seen_a_idx on story (primary_region, first_seen) where kind = 'event';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The nine sector lenses, in display order.
create or replace function api._a_sectors() returns text[]
language sql immutable set search_path = public, extensions as $$
    select array['energy', 'agri-food', 'manufacturing', 'logistics-trade', 'finance',
                 'tech', 'health', 'real-estate', 'consumer']
$$;

-- The window key echoed back to the client: 24h, 7d or 30d (default 7d).
create or replace function api._a_window_key(args jsonb) returns text
language sql immutable set search_path = public, extensions as $$
    select case when args ->> 'window' in ('24h', '7d', '30d') then args ->> 'window' else '7d' end
$$;

-- KPI tile preference: inflation, policy rate, currency, fuel, power, PMI, others.
create or replace function api._a_kpi_rank(p_name text, p_id text) returns integer
language sql immutable set search_path = public, extensions as $$
    select case
        when p_name ~* 'inflation|\mcpi\M' or p_id ~ '-cpi$' then 1
        when p_name ~* '(policy|deposit|repo|interest|bank) rate' or p_id ~ '-(policy|ecb)-rate$' then 2
        when p_name ~* ' per [a-z]{3}\M|exchange rate' or p_id ~ '-fx$' then 3
        when p_name ~* 'diesel|petrol|gasoline|fuel' then 4
        when p_name ~* 'power|electricity' then 5
        when p_name ~* '\mpmi\M' then 6
        else 7
    end
$$;

-- Up to four KPI tiles for one subject (region or commodity), in tile order.
create or replace function api._a_kpis(p_subject text, p_sample boolean) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(k.kpi order by k.rank, k.name, k.id), '[]'::jsonb)
    from (
        select s.node_id as id,
               s.name,
               api._a_kpi_rank(s.name, s.node_id) as rank,
               jsonb_build_object(
                   'id', s.node_id,
                   'name', s.name,
                   'unit', s.unit,
                   'latest', p.latest,
                   'previous', p.previous,
                   'change', round((p.latest - p.previous)::numeric, 6)::float8,
                   'as_of', p.as_of,
                   'higher_is', s.higher_is,
                   'series', p.series,
                   'source_name', s.source_name,
                   'is_sample', n.is_sample
               ) as kpi
        from indicator_series s
        join node n on n.id = s.node_id
        cross join lateral (
            select (array_agg(pt.value order by pt.date desc))[1] as latest,
                   (array_agg(pt.value order by pt.date desc))[2] as previous,
                   max(pt.date) as as_of,
                   jsonb_agg(jsonb_build_object('d', pt.date, 'v', pt.value) order by pt.date) as series
            from (
                select ip.date, ip.value from indicator_point ip
                where ip.series_id = s.node_id
                order by ip.date desc
                limit 60
            ) pt
        ) p
        where s.subject_id = p_subject
          and (p_sample or not n.is_sample)
          and p.latest is not null
        order by rank, s.name, s.node_id
        limit 4
    ) k
$$;

-- KPI tiles for a region, falling back to its country for states and cities.
-- Returns {"kpis": [...], "scope": region id or null}.
create or replace function api._a_region_kpis(p_id text, p_sample boolean) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_level text;
    v_country text;
    v_kpis jsonb;
begin
    select r.level, r.country_id into v_level, v_country from region r where r.node_id = p_id;
    v_kpis := api._a_kpis(p_id, p_sample);
    if jsonb_array_length(v_kpis) > 0 then
        return jsonb_build_object('kpis', v_kpis, 'scope', p_id);
    end if;
    if v_level in ('state', 'city') and v_country is not null and v_country <> p_id then
        v_kpis := api._a_kpis(v_country, p_sample);
        if jsonb_array_length(v_kpis) > 0 then
            return jsonb_build_object('kpis', v_kpis, 'scope', v_country);
        end if;
    end if;
    return jsonb_build_object('kpis', '[]'::jsonb, 'scope', null);
end;
$$;

-- Event stories "in" a region since a moment (sample rule applied):
-- country: s.country_id; state: s.admin1_id; city (or any level): s.primary_region;
-- bloc: stories in member countries, plus stories placed on the bloc itself.
create or replace function api._a_region_events(p_id text, p_since timestamptz, p_sample boolean)
returns table (
    id text, first_seen timestamptz, importance real, impact text, sectors text[],
    country_id text, admin1_id text, primary_region text
)
language sql stable set search_path = public, extensions as $$
    with ids as (
        select s.node_id from story s
        where s.country_id = p_id and s.kind = 'event' and s.first_seen >= p_since
        union
        select s.node_id from story s
        where s.admin1_id = p_id and s.kind = 'event' and s.first_seen >= p_since
        union
        select s.node_id from story s
        where s.primary_region = p_id and s.kind = 'event' and s.first_seen >= p_since
        union
        select s.node_id from story s
        where s.country_id in (select m.src from edge m where m.dst = p_id and m.type = 'member_of')
          and s.kind = 'event' and s.first_seen >= p_since
        union
        select s.node_id from edge e
        join story s on s.node_id = e.src
        where e.dst = p_id and e.type = 'mentions' and s.country_id is null
          and s.kind = 'event' and s.first_seen >= p_since
          and exists (select 1 from region b where b.node_id = p_id and b.level = 'bloc')
    )
    select s.node_id, s.first_seen, s.importance, s.impact, s.sectors,
           s.country_id, s.admin1_id, s.primary_region
    from ids
    join story s on s.node_id = ids.node_id
    join node n on n.id = s.node_id
    where p_sample or not n.is_sample
$$;

-- Sector pulse for a region: all nine sectors in order. Impact is the
-- importance-weighted dominant impact (a tie reads as neutral); direction
-- compares the count with the previous window of the same length.
create or replace function api._a_sector_pulse(p_id text, p_win interval, p_sample boolean) returns jsonb
language sql stable set search_path = public, extensions as $$
    with ev as (
        select e.importance::numeric as w, e.impact, e.sectors, e.first_seen >= now() - p_win as cur
        from api._a_region_events(p_id, now() - 2 * p_win, p_sample) e
    ),
    per as (
        select sec.ord,
               sec.id as sector,
               count(*) filter (where ev.cur) as n,
               count(*) filter (where not ev.cur) as prev_n,
               coalesce(sum(ev.w) filter (where ev.cur and ev.impact = 'risk'), 0) as risk_w,
               coalesce(sum(ev.w) filter (where ev.cur and ev.impact = 'opportunity'), 0) as opp_w,
               coalesce(sum(ev.w) filter (where ev.cur and ev.impact = 'neutral'), 0) as neu_w
        from unnest(api._a_sectors()) with ordinality as sec(id, ord)
        left join ev on sec.id = any(ev.sectors)
        group by sec.ord, sec.id
    )
    select jsonb_agg(jsonb_build_object(
        'sector', p.sector,
        'impact', case
            when p.n = 0 then 'neutral'
            when p.risk_w > p.opp_w and p.risk_w > p.neu_w then 'risk'
            when p.opp_w > p.risk_w and p.opp_w > p.neu_w then 'opportunity'
            else 'neutral'  -- neutral wins, and so does any tie
        end,
        'direction', case when p.n > p.prev_n then 'up' when p.n < p.prev_n then 'down' end,
        'count', p.n,
        'score', case
            when p.risk_w + p.opp_w + p.neu_w > 0
                then round((p.opp_w - p.risk_w) / (p.risk_w + p.opp_w + p.neu_w), 3)
            else 0
        end
    ) order by p.ord)
    from per p
$$;

-- Story cards (StorySummary) for a list of ids, in the list's order.
create or replace function api._a_story_cards(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(sc.card order by i.ord), '[]'::jsonb)
    from unnest(p_ids) with ordinality as i(id, ord)
    join api.story_card sc on sc.id = i.id
$$;

-- ---------------------------------------------------------------------------
-- api.meta({})
-- ---------------------------------------------------------------------------
create or replace function api.meta(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
begin
    return jsonb_build_object(
        'generated_at', now(),
        'data', (
            select jsonb_build_object(
                'live_stories', count(*) filter (where s.kind = 'event' and not n.is_sample),
                'sample_stories', count(*) filter (where s.kind = 'event' and n.is_sample),
                'forecasts', (
                    select count(*) from api.forecast_card fc
                    where fc.status = 'open' and not fc.hidden
                      and (v_sample or not fc.is_sample)
                      and api._provider_visible(fc.provider, v_viewer)
                ),
                'entities', (
                    select count(*) from node en
                    where en.type not in ('story', 'forecast') and (v_sample or not en.is_sample)
                ),
                'last_ingest_at', max(s.first_seen) filter (where not n.is_sample),
                'showing_sample', api._use_sample('{}'::jsonb)
            )
            from story s join node n on n.id = s.node_id
        ),
        'sectors', (
            select jsonb_agg(jsonb_build_object(
                       'id', sec.id,
                       'name', coalesce(n.name, initcap(replace(sec.id, '-', ' '))),
                       'icon', coalesce(n.props ->> 'icon', 'circle')
                   ) order by sec.ord)
            from unnest(api._a_sectors()) with ordinality as sec(id, ord)
            left join node n on n.id = 'sector:' || sec.id
        ),
        'sources', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', x.id, 'name', x.name, 'attribution', x.attribution, 'homepage', x.homepage
                   ) order by x.grp, x.name, x.id), '[]'::jsonb)
            from (
                select src.id, src.name, src.attribution, src.homepage, 0 as grp from source src
                union all
                select fp.id, fp.name, fp.attribution, fp.homepage, 1 from forecast_provider fp
                where fp.enabled
                  and api._provider_visible(fp.id, v_viewer)
                  and not exists (select 1 from source src where src.id = fp.id)
            ) x
        )
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- api.globe({window, sectors?, sample?})
-- ---------------------------------------------------------------------------
create or replace function api.globe(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_key text := api._a_window_key(args);
    v_since timestamptz := now() - api._window(jsonb_build_object('window', v_key));
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_result jsonb;
begin
    with ev as materialized (
        select s.node_id as id, s.location, s.impact, s.importance, s.magnitude, s.sectors,
               s.first_seen, s.headline, s.country_id
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.first_seen >= v_since
          and s.location is not null
          and (v_sample or not n.is_sample)
          and (v_sectors is null or s.sectors && v_sectors)
        order by s.importance desc, s.first_seen desc, s.node_id
        limit 1500
    ),
    arc as (
        select cl.id, cl.src_story, cl.dst_story, src.location as src_loc, dst.location as dst_loc,
               src.country_id as src_country, dst.country_id as dst_country,
               cl.link_type, cl.confidence, dst.impact
        from ev dst
        join causal_link cl on cl.dst_story = dst.id
        join story src on src.node_id = cl.src_story
        join node srcn on srcn.id = src.node_id
        where cl.link_type in ('reported', 'inferred')
          and (v_sample or not cl.is_sample)
          and src.kind = 'event'
          and src.first_seen >= now() - interval '30 days'
          and src.location is not null
          and (v_sample or not srcn.is_sample)
          and src.country_id is not null
          and dst.country_id is not null
          and src.country_id <> dst.country_id
    ),
    country as (
        select ev.country_id as id,
               count(*) as n,
               count(*) filter (where ev.impact = 'risk') as risk,
               count(*) filter (where ev.impact = 'opportunity') as opp,
               count(*) filter (where ev.impact = 'neutral') as neu
        from ev
        where ev.country_id is not null
        group by ev.country_id
    ),
    fc as (
        select f.card, f.change_24h, f.id
        from api.forecast_card f
        where f.geom is not null
          and f.status = 'open'
          and not f.hidden
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
        order by abs(f.change_24h) desc nulls last, f.id
        limit 500
    )
    select jsonb_build_object(
        'window', v_key,
        'events', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', ev.id,
                       'lon', round(st_x(ev.location::geometry)::numeric, 4),
                       'lat', round(st_y(ev.location::geometry)::numeric, 4),
                       'impact', ev.impact,
                       'importance', round(ev.importance::numeric, 1),
                       'magnitude', ev.magnitude,
                       'sectors', to_jsonb(ev.sectors),
                       'first_seen', ev.first_seen,
                       'headline', ev.headline,
                       'country_id', ev.country_id
                   ) order by ev.importance desc, ev.first_seen desc, ev.id), '[]'::jsonb)
            from ev
        ),
        'arcs', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', arc.id,
                       'src_story', arc.src_story,
                       'dst_story', arc.dst_story,
                       'src', jsonb_build_array(round(st_x(arc.src_loc::geometry)::numeric, 4),
                                                round(st_y(arc.src_loc::geometry)::numeric, 4)),
                       'dst', jsonb_build_array(round(st_x(arc.dst_loc::geometry)::numeric, 4),
                                                round(st_y(arc.dst_loc::geometry)::numeric, 4)),
                       'src_country', arc.src_country,
                       'dst_country', arc.dst_country,
                       'link_type', arc.link_type,
                       'confidence', round(arc.confidence::numeric, 3),
                       'impact', arc.impact
                   ) order by arc.id), '[]'::jsonb)
            from arc
        ),
        'forecasts', (
            select coalesce(jsonb_agg(fc.card order by abs(fc.change_24h) desc nulls last, fc.id), '[]'::jsonb)
            from fc
        ),
        'countries', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id,
                       'count', c.n,
                       'risk', c.risk,
                       'opportunity', c.opp,
                       'neutral', c.neu,
                       'score', round((c.opp - c.risk)::numeric / c.n, 3)
                   ) order by c.n desc, c.id), '[]'::jsonb)
            from country c
        )
    ) into v_result;
    return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- api.top({window, sectors?, sample?})
-- ---------------------------------------------------------------------------
create or replace function api.top(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_since timestamptz := now() - api._window(jsonb_build_object('window', api._a_window_key(args)));
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_ids text[];
    v_movers jsonb;
begin
    select array_agg(t.id order by t.rank desc, t.id) into v_ids
    from (
        select s.node_id as id,
               s.importance
                 + 25 * exp(-greatest(extract(epoch from now() - s.first_seen), 0) / 3600.0 / 24) as rank
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.first_seen >= v_since
          and (v_sample or not n.is_sample)
          and (v_sectors is null or s.sectors && v_sectors)
        order by rank desc, s.node_id
        limit 5
    ) t;

    select coalesce(jsonb_agg(m.card order by abs(m.change_24h) desc, m.id), '[]'::jsonb) into v_movers
    from (
        select f.card, f.change_24h, f.id
        from api.forecast_card f
        where f.status = 'open'
          and not f.hidden
          and not f.thin
          and abs(f.change_24h) >= 0.03
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
        order by abs(f.change_24h) desc, f.id
        limit 3
    ) m;

    return jsonb_build_object(
        'stories', api._a_story_cards(coalesce(v_ids, '{}')),
        'movers', v_movers
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- api.region({id, window, sample?})
-- ---------------------------------------------------------------------------
create or replace function api.region(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_win interval := api._window(jsonb_build_object('window', api._a_window_key(args)));
    v_since timestamptz := now() - v_win;
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_level text;
    v_country text;
    v_region jsonb;
    v_breadcrumb jsonb;
    v_kpis jsonb;
    v_targets text[];
    v_story_ids text[];
    v_children jsonb;
    v_decisions jsonb;
    v_graph jsonb;
begin
    select coalesce(r.level, n.subtype, 'region'),
           r.country_id,
           jsonb_build_object(
               'id', n.id,
               'name', n.name,
               'subtype', coalesce(r.level, n.subtype, 'region'),
               'qid', n.qid,
               'lon', round(st_x(st_pointonsurface(n.geom::geometry))::numeric, 4),
               'lat', round(st_y(st_pointonsurface(n.geom::geometry))::numeric, 4),
               'population', coalesce(
                   r.population::numeric,
                   case when jsonb_typeof(n.props -> 'population') = 'number'
                        then (n.props ->> 'population')::numeric end)
           )
      into v_level, v_country, v_region
    from node n
    left join region r on r.node_id = n.id
    where n.id = v_id and n.type = 'region';
    if not found then
        raise exception 'Not found: %', v_id;
    end if;

    -- Breadcrumb: from the country down to the parent (empty for countries and blocs).
    with recursive up as (
        select r.parent_id as id, 1 as depth
        from region r
        where r.node_id = v_id and r.level not in ('country', 'bloc') and r.parent_id is not null
        union all
        select r.parent_id, up.depth + 1
        from up
        join region r on r.node_id = up.id
        where r.level not in ('country', 'bloc') and r.parent_id is not null and up.depth < 8
    )
    select coalesce(jsonb_agg(api._region_ref(up.id) order by up.depth desc), '[]'::jsonb)
      into v_breadcrumb
    from up;

    v_kpis := api._a_region_kpis(v_id, v_sample);

    -- Regions whose forecasts count as this region's decisions.
    v_targets := array[v_id];
    if v_level in ('state', 'city') and v_country is not null then
        v_targets := v_targets || v_country;
    elsif v_level = 'bloc' then
        v_targets := v_targets || array(
            select m.src from edge m where m.dst = v_id and m.type = 'member_of');
    end if;

    select coalesce(jsonb_agg(d.card order by d.end_date asc nulls last, d.id), '[]'::jsonb)
      into v_decisions
    from (
        select f.card, f.end_date, f.id
        from api.forecast_card f
        where f.status = 'open'
          and not f.hidden
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
          and exists (
              select 1 from edge e
              where e.src = f.id and e.type = 'about' and e.dst = any(v_targets))
        order by f.end_date asc nulls last, f.id
        limit 8
    ) d;

    -- Stories, children and the local graph share one pass over the window.
    with ev as materialized (
        select e.* from api._a_region_events(v_id, v_since, v_sample) e
    ),
    kids as (
        select c.node_id as id, cn.name, c.level as subtype, cn.geom, cn.type, cn.subtype as node_subtype,
               cn.created_at, cn.is_sample
        from region c join node cn on cn.id = c.node_id
        where v_level = 'country' and c.parent_id = v_id and c.level = 'state'
        union all
        select c.node_id, cn.name, c.level, cn.geom, cn.type, cn.subtype, cn.created_at, cn.is_sample
        from region c join node cn on cn.id = c.node_id
        where v_level = 'state' and c.parent_id = v_id and c.level = 'city'
        union all
        select c.node_id, cn.name, c.level, cn.geom, cn.type, cn.subtype, cn.created_at, cn.is_sample
        from edge m
        join region c on c.node_id = m.src
        join node cn on cn.id = c.node_id
        where v_level = 'bloc' and m.dst = v_id and m.type = 'member_of'
    ),
    by_kid as (
        select case v_level
                   when 'country' then ev.admin1_id
                   when 'state' then ev.primary_region
                   when 'bloc' then ev.country_id
               end as kid_id,
               count(*) as n,
               count(*) filter (where ev.impact = 'risk') as risk,
               count(*) filter (where ev.impact = 'opportunity') as opp,
               count(*) filter (where ev.impact = 'neutral') as neu
        from ev
        group by 1
    ),
    kid_rows as (
        select k.*,
               coalesce(b.n, 0) as n,
               coalesce(b.risk, 0) as risk,
               coalesce(b.opp, 0) as opp,
               coalesce(b.neu, 0) as neu,
               row_number() over (order by coalesce(b.n, 0) desc, k.name, k.id) as rank
        from kids k
        left join by_kid b on b.kid_id = k.id
    ),
    top_stories as (
        select ev.*, row_number() over (order by ev.importance desc, ev.first_seen desc, ev.id) as rank
        from ev
    ),
    -- Graph nodes ------------------------------------------------------------
    g_kids as (
        select * from kid_rows where rank <= 12
    ),
    g_stories as (
        select ts.*,
               case when v_level in ('country', 'state', 'bloc') then
                   (select gk.id from g_kids gk
                    where gk.id = case v_level
                                      when 'country' then ts.admin1_id
                                      when 'state' then ts.primary_region
                                      else ts.country_id
                                  end)
               end as anchor_kid
        from top_stories ts
        where ts.rank <= 25
    ),
    g_forecasts as (
        select f.id
        from api.forecast_card f
        where f.status = 'open'
          and not f.hidden
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
          and exists (
              select 1 from edge e
              where (e.src = f.id and e.dst = v_id) or (e.dst = f.id and e.src = v_id))
        order by f.end_date asc nulls last, f.id
        limit 12
    ),
    g_entities as (
        select distinct on (nb.id) nb.id
        from (
            select e.dst as id from edge e where e.src = v_id and (v_sample or not e.is_sample)
            union
            select e.src from edge e where e.dst = v_id and (v_sample or not e.is_sample)
        ) nb
        join node n on n.id = nb.id
        where n.type not in ('story', 'forecast')
          and n.id <> v_id
          and (v_sample or not n.is_sample)
          and not exists (select 1 from kids k where k.id = nb.id)
        order by nb.id
        limit 40
    ),
    g_nodes as (
        select n.id, n.type, n.subtype, n.name, null::text as impact, n.created_at, n.is_sample
        from node n where n.id = v_id
        union all
        select gk.id, gk.type, gk.node_subtype, gk.name, null, gk.created_at, gk.is_sample
        from g_kids gk
        union all
        select s.node_id, 'story', s.kind, s.headline, s.impact, s.first_seen, n.is_sample
        from g_stories gs
        join story s on s.node_id = gs.id
        join node n on n.id = s.node_id
        union all
        select n.id, n.type, n.subtype, n.name, null, n.created_at, n.is_sample
        from g_forecasts gf join node n on n.id = gf.id
        union all
        select n.id, n.type, n.subtype, n.name, null, n.created_at, n.is_sample
        from g_entities ge join node n on n.id = ge.id
    ),
    -- Graph links ------------------------------------------------------------
    g_edges as (
        select e.src as source, e.dst as target, e.type, false as causal,
               null::numeric as confidence, e.created_at, e.id as ord
        from edge e
        where e.src in (select id from g_nodes)
          and e.dst in (select id from g_nodes)
          and (v_sample or not e.is_sample)
    ),
    g_causal as (
        select cl.src_story as source, cl.dst_story as target, cl.link_type as type, true as causal,
               round(cl.confidence::numeric, 3) as confidence, cl.created_at, cl.id as ord
        from causal_link cl
        where cl.src_story in (select id from g_stories)
          and cl.dst_story in (select id from g_stories)
          and (v_sample or not cl.is_sample)
    ),
    -- Stories placed under the region (or its child) when no edge says so already.
    g_placed as (
        select gs.id as source, coalesce(gs.anchor_kid, v_id) as target, 'located_in' as type,
               false as causal, null::numeric as confidence, gs.first_seen as created_at,
               gs.rank as ord
        from g_stories gs
        where not exists (
            select 1 from g_edges ge
            where (ge.source = gs.id and ge.target = coalesce(gs.anchor_kid, v_id))
               or (ge.target = gs.id and ge.source = coalesce(gs.anchor_kid, v_id)))
    ),
    g_links as (
        select *, 1 as grp from g_edges
        union all
        select *, 2 from g_causal
        union all
        select *, 3 from g_placed
    ),
    g_degree as (
        select x.id, count(*) as degree
        from (select source as id from g_links union all select target from g_links) x
        group by x.id
    )
    select
        (select array_agg(ts.id order by ts.rank) from top_stories ts where ts.rank <= 10),
        (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', kr.id,
                    'name', kr.name,
                    'subtype', kr.subtype,
                    'lon', round(st_x(st_pointonsurface(kr.geom::geometry))::numeric, 4),
                    'lat', round(st_y(st_pointonsurface(kr.geom::geometry))::numeric, 4),
                    'count', kr.n,
                    'risk', kr.risk,
                    'opportunity', kr.opp,
                    'neutral', kr.neu,
                    'score', case when kr.n > 0 then round((kr.opp - kr.risk)::numeric / kr.n, 3) else 0 end
                ) order by kr.rank), '[]'::jsonb)
         from kid_rows kr),
        jsonb_build_object(
            'nodes', (
                select coalesce(jsonb_agg(jsonb_build_object(
                           'id', gn.id,
                           'type', gn.type,
                           'subtype', gn.subtype,
                           'name', gn.name,
                           'degree', coalesce(gd.degree, 0),
                           'impact', gn.impact,
                           'created_at', gn.created_at,
                           'is_sample', gn.is_sample
                       ) order by gn.id), '[]'::jsonb)
                from g_nodes gn
                left join g_degree gd on gd.id = gn.id
            ),
            'links', (
                select coalesce(jsonb_agg(jsonb_build_object(
                           'source', gl.source,
                           'target', gl.target,
                           'type', gl.type,
                           'causal', gl.causal,
                           'confidence', gl.confidence,
                           'created_at', gl.created_at
                       ) order by gl.grp, gl.ord, gl.source, gl.target), '[]'::jsonb)
                from g_links gl
            )
        )
      into v_story_ids, v_children, v_graph;

    return jsonb_build_object(
        'region', v_region || jsonb_build_object('breadcrumb', v_breadcrumb),
        'kpis', v_kpis -> 'kpis',
        'kpi_scope', v_kpis -> 'scope',
        'sector_pulse', api._a_sector_pulse(v_id, v_win, v_sample),
        'stories', api._a_story_cards(coalesce(v_story_ids, '{}')),
        'decisions', v_decisions,
        'children', case when v_level = 'city' then '[]'::jsonb else v_children end,
        'graph', v_graph
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- api.compare({ids: 2..3 region ids, window?, sample?})
-- ---------------------------------------------------------------------------
create or replace function api.compare(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_win interval := api._window(jsonb_build_object('window', api._a_window_key(args)));
    v_sample boolean := api._use_sample(args);
    v_ids text[];
    v_id text;
    v_kpis jsonb;
    v_out jsonb := '[]'::jsonb;
begin
    if jsonb_typeof(args -> 'ids') is distinct from 'array' then
        raise exception 'compare needs "ids": a list of 2 or 3 region ids';
    end if;
    -- Keep the given order and drop repeats.
    select coalesce(array_agg(x.id order by x.first_ord), '{}') into v_ids
    from (
        select t.id, min(t.ord) as first_ord
        from jsonb_array_elements_text(args -> 'ids') with ordinality as t(id, ord)
        group by t.id
    ) x;
    if cardinality(v_ids) < 2 or cardinality(v_ids) > 3 then
        raise exception 'compare needs 2 or 3 different region ids, got %', cardinality(v_ids);
    end if;
    foreach v_id in array v_ids loop
        if not exists (select 1 from node n where n.id = v_id and n.type = 'region') then
            raise exception 'Not found: %', v_id;
        end if;
    end loop;

    foreach v_id in array v_ids loop
        v_kpis := api._a_region_kpis(v_id, v_sample);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'region', api._region_ref(v_id),
            'kpis', v_kpis -> 'kpis',
            'sector_pulse', api._a_sector_pulse(v_id, v_win, v_sample),
            'counts', (
                select jsonb_build_object(
                    'risk', count(*) filter (where e.impact = 'risk'),
                    'opportunity', count(*) filter (where e.impact = 'opportunity'),
                    'neutral', count(*) filter (where e.impact = 'neutral'))
                from api._a_region_events(v_id, now() - v_win, v_sample) e
            )
        ));
    end loop;
    return jsonb_build_object('regions', v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- api.brief({profile?, sample?})
-- ---------------------------------------------------------------------------
create or replace function api.brief(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_profile jsonb := case when jsonb_typeof(args -> 'profile') = 'object' then args -> 'profile' end;
    v_p_sectors text[];
    v_p_regions text[];
    v_p_nodes text[];
    v_since timestamptz;
    v_risks text[];
    v_opps text[];
    v_movers text[];
    v_odds jsonb;
    v_focus text;
    v_effects integer := 0;
    v_country text;
    v_country_stories text[];
    v_score numeric := 0;
begin
    -- Profile nodes and regions (a boost only; nothing is filtered out).
    if v_profile is not null then
        v_p_sectors := coalesce(api._text_array(v_profile -> 'sectors'), '{}');
        v_p_regions := coalesce(api._text_array(v_profile -> 'locations'), '{}')
                    || coalesce(api._text_array(v_profile -> 'suppliers'), '{}')
                    || coalesce(api._text_array(v_profile -> 'markets'), '{}');
        v_p_nodes := v_p_regions
                    || coalesce(api._text_array(v_profile -> 'inputs'), '{}')
                    || coalesce(api._text_array(v_profile -> 'competitors'), '{}')
                    || array(select 'sector:' || x from unnest(v_p_sectors) as x);
    end if;

    -- The last 24 hours, or 7 days when the day is quiet.
    v_since := now() - interval '24 hours';
    if (select count(*) from story s join node n on n.id = s.node_id
        where s.kind = 'event' and s.first_seen >= v_since and (v_sample or not n.is_sample)) < 3 then
        v_since := now() - interval '7 days';
    end if;

    with ev as materialized (
        select s.node_id as id, s.impact, s.importance, s.source_count, s.first_seen,
               s.importance * case
                   when v_profile is not null and (
                        s.sectors && v_p_sectors
                        or s.primary_region = any(v_p_regions)
                        or s.admin1_id = any(v_p_regions)
                        or s.country_id = any(v_p_regions)
                        or s.country_id in (
                            select m.src from edge m
                            where m.type = 'member_of' and m.dst = any(v_p_regions))
                        or exists (
                            select 1 from edge e
                            where e.src = s.node_id and e.type = 'mentions' and e.dst = any(v_p_nodes)))
                   then 1.5 else 1 end as score
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.first_seen >= v_since
          and (v_sample or not n.is_sample)
    )
    select
        (select array_agg(t.id order by t.score desc, t.importance desc, t.id)
         from (select * from ev where ev.impact = 'risk'
               order by ev.score desc, ev.importance desc, ev.id limit 3) t),
        (select array_agg(t.id order by t.score desc, t.importance desc, t.id)
         from (select * from ev where ev.impact = 'opportunity'
               order by ev.score desc, ev.importance desc, ev.id limit 3) t),
        (select array_agg(t.id order by t.source_count desc, t.importance desc, t.id)
         from (select * from ev
               order by ev.source_count desc, ev.importance desc, ev.id limit 3) t)
      into v_risks, v_opps, v_movers;

    select coalesce(jsonb_agg(m.card order by abs(m.change_24h) desc, m.id), '[]'::jsonb) into v_odds
    from (
        select f.card, f.change_24h, f.id
        from api.forecast_card f
        where f.status = 'open'
          and not f.hidden
          and f.change_24h is not null
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
        order by abs(f.change_24h) desc, f.id
        limit 3
    ) m;

    -- The recent event with the most outgoing causal links.
    select s.node_id, count(*)::integer into v_focus, v_effects
    from story s
    join node n on n.id = s.node_id
    join causal_link cl on cl.src_story = s.node_id
    where s.kind = 'event'
      and s.first_seen >= now() - interval '7 days'
      and (v_sample or not n.is_sample)
      and (v_sample or not cl.is_sample)
    group by s.node_id, s.importance
    order by count(*) desc, s.importance desc, s.node_id
    limit 1;
    if v_focus is null then
        v_effects := 0;
    end if;

    -- The country with the most stories in the window.
    select c.country_id, c.score into v_country, v_score
    from (
        select s.country_id,
               count(*) as n,
               sum(s.importance) as weight,
               round((count(*) filter (where s.impact = 'opportunity')
                      - count(*) filter (where s.impact = 'risk'))::numeric / count(*), 3) as score
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.first_seen >= v_since
          and s.country_id is not null
          and (v_sample or not n.is_sample)
        group by s.country_id
    ) c
    order by c.n desc, c.weight desc, c.country_id
    limit 1;

    if v_country is not null then
        select array_agg(t.node_id order by t.importance desc, t.first_seen desc, t.node_id)
          into v_country_stories
        from (
            select s.node_id, s.importance, s.first_seen
            from story s
            join node n on n.id = s.node_id
            where s.kind = 'event'
              and s.first_seen >= v_since
              and s.country_id = v_country
              and (v_sample or not n.is_sample)
            order by s.importance desc, s.first_seen desc, s.node_id
            limit 3
        ) t;
    end if;

    return jsonb_build_object(
        'generated_at', now(),
        'cards', jsonb_build_array(
            jsonb_build_object('kind', 'top_risks',
                               'stories', api._a_story_cards(coalesce(v_risks, '{}'))),
            jsonb_build_object('kind', 'top_opportunities',
                               'stories', api._a_story_cards(coalesce(v_opps, '{}'))),
            jsonb_build_object('kind', 'biggest_movers',
                               'stories', api._a_story_cards(coalesce(v_movers, '{}'))),
            jsonb_build_object('kind', 'odds_moved', 'forecasts', v_odds),
            jsonb_build_object('kind', 'cascade_to_watch',
                               'focus', (select sc.card from api.story_card sc where sc.id = v_focus),
                               'effects', v_effects),
            jsonb_build_object('kind', 'region_spotlight',
                               'region', case when v_country is not null then api._region_ref(v_country) end,
                               'stories', api._a_story_cards(coalesce(v_country_stories, '{}')),
                               'score', coalesce(v_score, 0))
        )
    );
end;
$$;
