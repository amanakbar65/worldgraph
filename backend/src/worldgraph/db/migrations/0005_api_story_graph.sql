-- 0005: api functions for stories, cascades, entities, the knowledge graph
-- and search: api.story, api.cascade, api.entity, api.graph,
-- api.local_graph and api.search. Response shapes are the zod schemas in
-- frontend/src/api/contract.ts (exported to /contracts/*.json).
--
-- Shared rules
-- - Sample rows appear only when api._use_sample(args) is true. When the
--   focus of a call (a story, entity or graph centre) is itself sample data,
--   sample neighbours are allowed too, so a sample story still shows its
--   sample cascade, forecasts and entities.
-- - A forecast is shown only when it is open, not hidden (too little volume),
--   its provider is visible to the viewer's country (fails closed for
--   real-money providers) and the sample rule allows it. Conditional causal
--   links whose forecast is not shown are dropped everywhere.
-- - Arguments are read with ->> and validated; nothing builds SQL from them.
--
-- Private helpers use the prefix api._b_ (group b).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An integer argument: numbers and numeric strings are rounded and clamped to
-- ±1,000,000; anything else gives the default.
create or replace function api._b_int(v jsonb, p_default integer) returns integer
language sql immutable as $$
    select case
        when jsonb_typeof(v) = 'number'
            then greatest(-1000000, least(1000000, round((v #>> '{}')::numeric)))::integer
        when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]{1,9}(\.[0-9]+)?$'
            then round(btrim(v #>> '{}')::numeric)::integer
        else p_default
    end
$$;

-- A numeric argument (numbers or numeric strings); anything else gives the default.
create or replace function api._b_num(v jsonb, p_default numeric) returns numeric
language sql immutable as $$
    select case
        when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
        when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]{1,9}(\.[0-9]+)?$'
            then btrim(v #>> '{}')::numeric
        else p_default
    end
$$;

-- 'central-bank' → 'Central bank', 'user_entity' → 'User entity'.
create or replace function api._b_readable(t text) returns text
language sql immutable as $$
    select case when nullif(t, '') is not null
        then upper(left(t, 1)) || translate(substr(t, 2), '-_', '  ') end
$$;

-- May this forecast be shown? Open, not hidden for low volume, provider
-- visible to the viewer, and sample only when allowed. A forecast without
-- any snapshot has no card, so it is never shown.
create or replace function api._b_forecast_ok(p_id text, p_viewer text, p_sample boolean)
returns boolean
language sql stable set search_path = public, extensions as $$
    select exists (
        select 1
        from forecast f
        join node n on n.id = f.node_id
        join forecast_provider fp on fp.id = f.provider
        cross join lateral (
            select fs.volume from forecast_snapshot fs
            where fs.forecast_id = f.node_id
            order by fs.ts desc limit 1
        ) l
        where f.node_id = p_id
          and f.status = 'open'
          and (p_sample or not n.is_sample)
          and coalesce(l.volume, 0) >= fp.hide_volume
          and api._provider_visible(f.provider, p_viewer)
    )
$$;

-- Same, for a forecast that is the focus of a call: legal gating and the
-- volume floor apply, but closed forecasts and sample data stay reachable.
create or replace function api._b_forecast_focus_ok(p_id text, p_viewer text) returns boolean
language sql stable set search_path = public, extensions as $$
    select exists (
        select 1
        from forecast f
        join forecast_provider fp on fp.id = f.provider
        cross join lateral (
            select fs.volume from forecast_snapshot fs
            where fs.forecast_id = f.node_id
            order by fs.ts desc limit 1
        ) l
        where f.node_id = p_id
          and coalesce(l.volume, 0) >= fp.hide_volume
          and api._provider_visible(f.provider, p_viewer)
    )
$$;

-- ForecastSummary cards for these ids, in the given order. Filtering the
-- card view by an id array keeps it from building every card (each card
-- computes a sparkline).
create or replace function api._b_cards(p_ids text[]) returns jsonb
language sql stable set search_path = public, extensions as $$
    select coalesce(jsonb_agg(fc.card order by array_position(p_ids, fc.id)), '[]'::jsonb)
    from api.forecast_card fc
    where fc.id = any(p_ids)
$$;

-- Volume at the latest snapshot (to rank forecasts without building cards).
create or replace function api._b_latest_volume(p_forecast text) returns double precision
language sql stable set search_path = public, extensions as $$
    select fs.volume from forecast_snapshot fs
    where fs.forecast_id = p_forecast
    order by fs.ts desc limit 1
$$;

-- The child regions (part_of edges into each parent) worth showing, at most
-- p_per per parent: the most active first (stories located in them), then
-- the most populous, then by id. One pass over the parents' stories.
create or replace function api._b_top_children(p_parents text[], p_per integer)
returns table (child text, parent text)
language sql stable set search_path = public, extensions as $$
    with kids as (
        select e.src as child, e.dst as parent
        from edge e
        where e.dst = any(p_parents) and e.type = 'part_of'
    ),
    located as (
        select s.node_id, s.admin1_id, s.primary_region
        from story s
        where s.country_id = any(p_parents) or s.admin1_id = any(p_parents)
    ),
    act as (
        select x.id, count(distinct x.story) as n
        from (
            select admin1_id as id, node_id as story from located
            union all
            select primary_region, node_id from located
        ) x
        where x.id is not null
        group by x.id
    ),
    ranked as (
        select k.child, k.parent,
               row_number() over (partition by k.parent
                                  order by coalesce(a.n, 0) desc, r.population desc nulls last, k.child) as rn
        from kids k
        left join act a on a.id = k.child
        left join region r on r.node_id = k.child
    )
    select ranked.child, ranked.parent from ranked where ranked.rn <= p_per
$$;

-- The Kpi shape for one indicator series (null when it has no points).
create or replace function api._b_kpi(p_series text) returns jsonb
language sql stable set search_path = public, extensions as $$
    with pts as (
        select ip.date, ip.value, row_number() over (order by ip.date desc) as rn
        from indicator_point ip
        where ip.series_id = p_series
        order by ip.date desc
        limit 60
    )
    select jsonb_build_object(
        'id', i.node_id,
        'name', i.name,
        'unit', i.unit,
        'latest', l.value,
        'previous', p.value,
        'change', case when p.value is not null then round((l.value - p.value)::numeric, 4) end,
        'as_of', to_char(l.date, 'YYYY-MM-DD'),
        'higher_is', i.higher_is,
        'series', (select jsonb_agg(jsonb_build_object('d', to_char(pts.date, 'YYYY-MM-DD'), 'v', pts.value)
                                    order by pts.date)
                   from pts),
        'source_name', i.source_name,
        'is_sample', n.is_sample)
    from indicator_series i
    join node n on n.id = i.node_id
    join pts l on l.rn = 1
    left join pts p on p.rn = 2
    where i.node_id = p_series
$$;

-- Probability history, at most p_points points: the time span is cut into
-- equal buckets and the latest snapshot in each is kept (so the newest
-- snapshot is always the last point). Oldest first.
create or replace function api._b_history(p_forecast text, p_points integer default 120)
returns jsonb
language sql stable set search_path = public, extensions as $$
    with b as (
        select extract(epoch from min(ts)) as lo, extract(epoch from max(ts)) as hi
        from forecast_snapshot where forecast_id = p_forecast
    ),
    pts as (
        select fs.ts, fs.probability,
               case when b.hi = b.lo then 1
                    else width_bucket(extract(epoch from fs.ts), b.lo, b.hi + 0.001, p_points) end as bucket
        from forecast_snapshot fs, b
        where fs.forecast_id = p_forecast
    ),
    picked as (
        select distinct on (bucket) ts, probability from pts order by bucket, ts desc
    )
    select coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'p', round(probability::numeric, 3)) order by ts),
                    '[]'::jsonb)
    from picked
$$;

-- The country a node sits in: itself for a country, its country for a
-- state or city, the country of its located_in region otherwise.
create or replace function api._b_country_of(p_id text) returns text
language sql stable set search_path = public, extensions as $$
    select coalesce(
        (select r.country_id from region r where r.node_id = p_id),
        (select r.country_id from edge e join region r on r.node_id = e.dst
         where e.src = p_id and e.type = 'located_in'
         order by e.id limit 1))
$$;

-- A short line that tells search results apart: "State · India",
-- "City · Gujarat, India", "Story · India · risk", "Forecast · 62%"…
create or replace function api._b_context(p_id text) returns text
language plpgsql stable set search_path = public, extensions as $$
declare
    v_node public.node%rowtype;
    v_region public.region%rowtype;
    v_country text;
    v_parent text;
    v_text text;
    v_prob real;
begin
    select * into v_node from node where id = p_id;
    if not found then
        return null;
    end if;
    case v_node.type
    when 'region' then
        select * into v_region from region where node_id = p_id;
        v_country := (select name from node where id = v_region.country_id);
        case coalesce(v_region.level, v_node.subtype)
        when 'country' then
            return 'Country' || coalesce(' · ' || coalesce(v_region.subregion, v_region.continent), '');
        when 'state' then
            return 'State' || coalesce(' · ' || v_country, '');
        when 'city' then
            select pn.name into v_parent
            from region pr join node pn on pn.id = pr.node_id
            where pr.node_id = v_region.parent_id and pr.level = 'state';
            v_text := concat_ws(', ', v_parent, v_country);
            return 'City' || case when v_text <> '' then ' · ' || v_text else '' end;
        when 'bloc' then
            return 'Bloc' || coalesce(' · ' || nullif((select count(*) from edge
                where dst = p_id and type = 'member_of'), 0) || ' members', '');
        else
            return 'Region';
        end case;
    when 'story' then
        select concat_ws(' · ',
                   case when s.kind = 'projected' then 'Projected' else 'Story' end,
                   coalesce(cn.name, pn.name),
                   s.impact)
        into v_text
        from story s
        left join node cn on cn.id = s.country_id
        left join node pn on pn.id = s.primary_region
        where s.node_id = p_id;
        return coalesce(v_text, 'Story');
    when 'forecast' then
        select fs.probability into v_prob from forecast_snapshot fs
        where fs.forecast_id = p_id order by fs.ts desc limit 1;
        return 'Forecast' || coalesce(' · ' || round(v_prob * 100)::integer || '%', '');
    when 'commodity' then
        return 'Commodity' || coalesce(' · HS ' || nullif(v_node.props ->> 'hs', ''), '');
    when 'organization', 'infrastructure' then
        v_country := (select name from node where id = api._b_country_of(p_id));
        return coalesce(api._b_readable(v_node.subtype), api._b_readable(v_node.type))
               || coalesce(' · ' || v_country, '');
    when 'policy' then
        return 'Policy' || coalesce(' · ' || api._b_readable(v_node.subtype), '');
    when 'sector' then
        return 'Sector';
    when 'indicator' then
        return 'Indicator' || coalesce(' · ' || (
            select sn.name from indicator_series i join node sn on sn.id = i.subject_id
            where i.node_id = p_id), '');
    else
        return api._b_readable(v_node.type);
    end case;
end
$$;

-- GraphData ({nodes, links}) for a set of node ids, kept in the given order.
-- Links are every edge and causal link among them (causal links need
-- confidence >= p_min_conf and, when conditional, a visible forecast).
-- Degree counts links within the result. With p_drop_isolated, non-story
-- nodes left without any link are removed.
create or replace function api._b_graph_data(
    p_ids text[], p_viewer text, p_sample boolean,
    p_min_conf numeric default 0, p_drop_isolated boolean default false)
returns jsonb
language sql stable set search_path = public, extensions as $$
    with ids as (
        select u.id, min(u.ord) as ord
        from unnest(p_ids) with ordinality as u(id, ord)
        group by u.id
    ),
    edge_links as (
        select distinct on (e.src, e.dst, e.type)
               e.src as source, e.dst as target, e.type, false as causal,
               null::numeric as confidence, e.created_at
        from edge e
        join ids a on a.id = e.src
        join ids b on b.id = e.dst
        order by e.src, e.dst, e.type, e.id
    ),
    causal_links as (
        select distinct on (cl.src_story, cl.dst_story, cl.link_type)
               cl.src_story as source, cl.dst_story as target, cl.link_type as type, true as causal,
               round(cl.confidence::numeric, 3) as confidence, cl.created_at
        from causal_link cl
        join ids a on a.id = cl.src_story
        join ids b on b.id = cl.dst_story
        where cl.confidence >= p_min_conf
          and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample))
        order by cl.src_story, cl.dst_story, cl.link_type, cl.confidence desc, cl.id
    ),
    links as (
        select * from edge_links
        union all
        select * from causal_links
    ),
    deg as (
        select x.id, count(*) as degree
        from (select source as id from links union all select target from links) x
        group by x.id
    ),
    nodes as (
        select i.ord, jsonb_build_object(
            'id', n.id,
            'type', n.type,
            'subtype', n.subtype,
            'name', coalesce(s.headline, n.name),
            'degree', coalesce(d.degree, 0),
            'impact', s.impact,
            'created_at', case when s.kind = 'event' then s.first_seen else n.created_at end,
            'is_sample', n.is_sample) as j
        from ids i
        join node n on n.id = i.id
        left join story s on s.node_id = n.id
        left join deg d on d.id = n.id
        where not p_drop_isolated or n.type = 'story' or d.degree is not null
    )
    select jsonb_build_object(
        'nodes', coalesce((select jsonb_agg(j order by ord) from nodes), '[]'::jsonb),
        'links', coalesce((select jsonb_agg(jsonb_build_object(
                               'source', source, 'target', target, 'type', type, 'causal', causal,
                               'confidence', confidence, 'created_at', created_at)
                           order by causal, source, target, type)
                           from links), '[]'::jsonb))
$$;

-- Breadth-first local graph around p_focus: {nodes, links, truncated}.
-- Expands over edges (both directions) and causal links, level by level.
-- A region expands to at most 12 child regions (the most active first), and
-- sector nodes are never expanded (they connect everything) unless they are
-- the focus. Within a level, stories come first by importance, then other
-- nodes by how many already-included nodes they connect to. `truncated` is
-- true when the node limit cut anything.
create or replace function api._b_local_graph(
    p_focus text, p_depth integer, p_limit integer, p_viewer text, p_sample boolean)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_ids text[] := array[p_focus];
    v_frontier text[] := array[p_focus];
    v_next text[];
    v_found integer;
    v_room integer;
    v_truncated boolean := false;
    v_level integer;
begin
    for v_level in 1 .. p_depth loop
        exit when cardinality(v_frontier) = 0;
        v_room := greatest(p_limit - cardinality(v_ids), 0);

        with expand as (
            select n.id
            from node n
            where n.id = any(v_frontier) and (n.type <> 'sector' or n.id = p_focus)
        ),
        nb(id, via) as (
            select e.dst, e.src from edge e join expand x on x.id = e.src
            union all
            select e.src, e.dst from edge e join expand x on x.id = e.dst where e.type <> 'part_of'
            union all
            select c.child, c.parent
            from api._b_top_children(array(select id from expand), 12) c
            union all
            select cl.dst_story, cl.src_story from causal_link cl join expand x on x.id = cl.src_story
            where cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample)
            union all
            select cl.src_story, cl.dst_story from causal_link cl join expand x on x.id = cl.dst_story
            where cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample)
        ),
        cand as (
            select nb.id, count(distinct nb.via) as conn
            from nb
            where nb.id <> all(v_ids)
            group by nb.id
        ),
        ok as (
            select c.id, c.conn, s.importance
            from cand c
            join node n on n.id = c.id
            left join story s on s.node_id = c.id
            where (p_sample or not n.is_sample)
              and n.type <> 'user_entity'
              and (n.type <> 'forecast' or api._b_forecast_ok(n.id, p_viewer, p_sample))
        )
        select coalesce(array_agg(ok.id order by ok.importance desc nulls last, ok.conn desc, ok.id), '{}'),
               count(*)
        into v_next, v_found
        from ok;

        if v_found > v_room then
            v_truncated := true;
            v_next := v_next[1:v_room];
        end if;
        exit when cardinality(v_next) = 0;
        v_ids := v_ids || v_next;
        v_frontier := v_next;
    end loop;

    return api._b_graph_data(v_ids, p_viewer, p_sample)
        || jsonb_build_object('truncated', v_truncated);
end
$$;

-- ---------------------------------------------------------------------------
-- api.story({id}) → StoryResponse
-- ---------------------------------------------------------------------------
create or replace function api.story(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_viewer text := api._viewer_country(args);
    v_card jsonb;
    v_is_sample boolean;
    v_story public.story%rowtype;
    v_sample boolean;
    v_sources jsonb;
    v_entities jsonb;
    v_targets text[];
    v_forecasts jsonb;
    v_causes integer;
    v_effects integer;
begin
    select sc.card, sc.is_sample into v_card, v_is_sample
    from api.story_card sc where sc.id = v_id;
    if v_card is null then
        raise exception 'Not found: %', v_id;
    end if;
    select * into v_story from story where node_id = v_id;
    v_sample := v_is_sample or api._use_sample(args);

    -- Sources: newest first, at most 12.
    select coalesce(jsonb_agg(jsonb_build_object(
               'source_name', a.source_name, 'title', a.title, 'url', a.url,
               'published_at', a.published_at)
           order by a.published_at desc nulls last, a.id desc), '[]'::jsonb)
    into v_sources
    from (
        select * from article
        where story_id = v_id
        order by published_at desc nulls last, id desc
        limit 12
    ) a;

    -- Entities the story mentions (not sectors): regions, organizations,
    -- commodities, infrastructure, policies, then the rest. At most 16.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'type', x.type, 'subtype', x.subtype, 'name', x.name)
           order by x.type_rank, x.level_rank, x.name, x.id), '[]'::jsonb)
    into v_entities
    from (
        select d.* from (
            select distinct on (n.id) n.id, n.type, n.subtype, n.name,
                   case n.type when 'region' then 0 when 'organization' then 1 when 'commodity' then 2
                               when 'infrastructure' then 3 when 'policy' then 4 else 5 end as type_rank,
                   case r.level when 'country' then 0 when 'bloc' then 1 when 'state' then 2
                                when 'city' then 3 else 4 end as level_rank
            from edge e
            join node n on n.id = e.dst
            left join region r on r.node_id = n.id
            where e.src = v_id and e.type = 'mentions'
              and n.type not in ('sector', 'story', 'forecast', 'user_entity')
              and (v_sample or not n.is_sample)
            order by n.id
        ) d
        order by d.type_rank, d.level_rank, d.name, d.id
        limit 16
    ) x;

    -- Forecasts: those related to this story first, then those about the
    -- entities it mentions or its country. At most 3.
    select coalesce(array_agg(distinct t), '{}') into v_targets
    from (
        select e.dst as t
        from edge e join node n on n.id = e.dst
        where e.src = v_id and e.type = 'mentions' and n.type <> 'sector'
        union all
        select v_story.country_id
    ) m
    where t is not null;

    with cand as (
        select e.src as id, 0 as rank, 0 as hits
        from edge e where e.dst = v_id and e.type = 'relates_to'
        union all
        select e.src, 1, 1
        from edge e where e.dst = any(v_targets) and e.type = 'about'
    ),
    best as (
        select c.id, min(c.rank) as rank, sum(c.hits) as hits
        from cand c join node n on n.id = c.id
        where n.type = 'forecast'
        group by c.id
    ),
    picked as (
        select b.id, b.rank, b.hits, api._b_latest_volume(b.id) as volume
        from best b
        where api._b_forecast_ok(b.id, v_viewer, v_sample)
        order by b.rank, b.hits desc, volume desc nulls last, b.id
        limit 3
    )
    select api._b_cards(coalesce(array_agg(p.id order by p.rank, p.hits desc, p.volume desc nulls last, p.id),
                                 '{}'))
    into v_forecasts
    from picked p;

    -- Causes and effects: causal links whose other end passes the sample
    -- rule and whose forecast (conditional links) is visible.
    select count(*) filter (where cl.dst_story = v_id),
           count(*) filter (where cl.src_story = v_id)
    into v_causes, v_effects
    from causal_link cl
    join node o on o.id = case when cl.dst_story = v_id then cl.src_story else cl.dst_story end
    where (cl.src_story = v_id or cl.dst_story = v_id)
      and (v_sample or not o.is_sample)
      and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample));

    return jsonb_build_object(
        'story', v_card || jsonb_build_object(
            'actions', to_jsonb(v_story.actions),
            'last_seen', v_story.last_seen,
            'mention_count', v_story.mention_count,
            'sources', v_sources,
            'entities', v_entities),
        'forecasts', v_forecasts,
        'causes', v_causes,
        'effects', v_effects);
end
$$;

-- ---------------------------------------------------------------------------
-- api.cascade({id, depth?}) → CascadeResponse
-- Causes (depth −1, −2, …) and effects (+1, +2, …) around a focus story,
-- at most 60 stories, each at its shortest depth.
-- ---------------------------------------------------------------------------
create or replace function api.cascade(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_depth integer := greatest(1, least(3, api._b_int(args -> 'depth', 2)));
    v_viewer text := api._viewer_country(args);
    v_focus_sample boolean;
    v_sample boolean;
    v_ids text[];
    v_depths integer[];
    v_nodes jsonb;
    v_links jsonb;
    v_branches jsonb;
begin
    select n.is_sample into v_focus_sample
    from story s join node n on n.id = s.node_id
    where s.node_id = v_id;
    if not found then
        raise exception 'Not found: %', v_id;
    end if;
    -- The sample rule applies to non-focus nodes only.
    v_sample := v_focus_sample or api._use_sample(args);

    with recursive back(id, depth, path) as (
        select v_id, 0, array[v_id]
        union all
        select cl.src_story, b.depth - 1, b.path || cl.src_story
        from back b
        join causal_link cl on cl.dst_story = b.id
        join node n on n.id = cl.src_story
        where b.depth > -v_depth
          and cl.src_story <> all(b.path)
          and (v_sample or not n.is_sample)
          and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample))
    ),
    fwd(id, depth, path) as (
        select v_id, 0, array[v_id]
        union all
        select cl.dst_story, f.depth + 1, f.path || cl.dst_story
        from fwd f
        join causal_link cl on cl.src_story = f.id
        join node n on n.id = cl.dst_story
        where f.depth < v_depth
          and cl.dst_story <> all(f.path)
          and (v_sample or not n.is_sample)
          and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample))
    ),
    reach as (
        select id, depth from back where depth < 0
        union all
        select id, depth from fwd where depth > 0
    ),
    best as (
        -- shortest depth per story; a tie between cause and effect goes to cause
        select distinct on (r.id) r.id, r.depth
        from reach r
        where r.id <> v_id
        order by r.id, abs(r.depth), r.depth
    ),
    kept as (
        select b.id, b.depth
        from best b join story s on s.node_id = b.id
        order by abs(b.depth), s.importance desc, b.id
        limit 59
    ),
    all_nodes as (
        select v_id as id, 0 as depth
        union all
        select id, depth from kept
    )
    select array_agg(id order by depth, id), array_agg(depth order by depth, id)
    into v_ids, v_depths
    from all_nodes;

    select coalesce(jsonb_agg(sc.card || jsonb_build_object('depth', k.depth)
                              order by k.depth, sc.importance desc, k.id), '[]'::jsonb)
    into v_nodes
    from unnest(v_ids, v_depths) as k(id, depth)
    join api.story_card sc on sc.id = k.id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', cl.id,
               'src', cl.src_story,
               'dst', cl.dst_story,
               'link_type', cl.link_type,
               'mechanism', cl.mechanism,
               'direction', cl.direction,
               'confidence', round(cl.confidence::numeric, 3),
               'lag_days', cl.lag_days,
               'forecast_id', cl.forecast_id,
               'outcome', cl.outcome,
               'evidence', coalesce((
                   select jsonb_agg(jsonb_build_object(
                              'source_name', ev.source_name, 'url', ev.url,
                              'published_at', ev.published_at, 'snippet', ev.snippet,
                              'is_sample', ev.is_sample)
                          order by ev.published_at desc nulls last, ev.id)
                   from evidence ev where ev.causal_link_id = cl.id), '[]'::jsonb))
           order by cl.id), '[]'::jsonb)
    into v_links
    from causal_link cl
    where cl.src_story = any(v_ids)
      and cl.dst_story = any(v_ids)
      and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample));

    -- If YES / If NO: one branch per visible forecast behind conditional
    -- links in the result; story_ids are the effects that happen only on
    -- that outcome.
    with cond as (
        select cl.forecast_id, upper(cl.outcome) as outcome, cl.dst_story, abs(k.depth) as src_depth
        from causal_link cl
        join unnest(v_ids, v_depths) as k(id, depth) on k.id = cl.src_story
        where cl.link_type = 'conditional'
          and cl.dst_story = any(v_ids)
          and api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample)
    ),
    per as (
        select c.forecast_id, min(c.src_depth) as near,
               coalesce(array_agg(distinct c.dst_story) filter (where c.outcome = 'YES'), '{}') as yes_ids,
               coalesce(array_agg(distinct c.dst_story) filter (where c.outcome = 'NO'), '{}') as no_ids
        from cond c
        group by c.forecast_id
    ),
    cards as (
        select t.card, t.card ->> 'id' as id, (t.card ->> 'probability')::numeric as p
        from jsonb_array_elements(api._b_cards(array(select forecast_id from per))) as t(card)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'forecast', c.card,
               'outcomes', jsonb_build_array(
                   jsonb_build_object(
                       'outcome', 'YES',
                       'probability', c.p,
                       'story_ids', to_jsonb(array(
                           select y from unnest(p.yes_ids) y where y <> all(p.no_ids) order by y))),
                   jsonb_build_object(
                       'outcome', 'NO',
                       'probability', 1 - c.p,
                       'story_ids', to_jsonb(array(
                           select x from unnest(p.no_ids) x where x <> all(p.yes_ids) order by x)))))
           order by p.near, p.forecast_id), '[]'::jsonb)
    into v_branches
    from per p
    join cards c on c.id = p.forecast_id;

    return jsonb_build_object(
        'focus', v_id,
        'nodes', v_nodes,
        'links', v_links,
        'branches', v_branches);
end
$$;

-- ---------------------------------------------------------------------------
-- api.entity({id}) → EntityResponse (any node type except story)
-- ---------------------------------------------------------------------------
create or replace function api.entity(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_viewer text := api._viewer_country(args);
    v_node public.node%rowtype;
    v_region public.region%rowtype;
    v_sample boolean;
    v_facts jsonb;
    v_timeline jsonb;
    v_backlinks jsonb;
    v_forecasts jsonb;
    v_fids text[];
    v_indicators jsonb;
    v_graph jsonb;
    v_members text[];
    v_lon numeric;
    v_lat numeric;
begin
    select * into v_node from node where id = v_id;
    if not found or v_node.type = 'story' then
        raise exception 'Not found: %', v_id;
    end if;
    if v_node.type = 'forecast' and not api._b_forecast_focus_ok(v_id, v_viewer) then
        raise exception 'Not found: %', v_id;
    end if;
    select * into v_region from region where node_id = v_id;
    v_sample := v_node.is_sample or api._use_sample(args);

    if v_node.geom is not null then
        select round(st_x(p)::numeric, 4), round(st_y(p)::numeric, 4) into v_lon, v_lat
        from (select st_pointonsurface(v_node.geom::geometry) as p) g;
    end if;

    -- Facts ------------------------------------------------------------------
    with f(ord, label, value) as (
        values
        (1, 'Type',
            case when v_node.type = 'region'
                 then api._b_readable(coalesce(v_region.level, v_node.subtype, 'region'))
                 else api._b_readable(v_node.type)
                      || coalesce(' · ' || api._b_readable(v_node.subtype), '') end),
        (2, 'Located in', (
            select string_agg(n.name, ', ' order by e.id)
            from edge e join node n on n.id = e.dst
            where e.src = v_id and e.type = 'located_in')),
        (3, 'Part of', coalesce((select name from node where id = v_region.parent_id),
                                case when v_region.level = 'country' then v_region.subregion end)),
        (4, 'Country', (
            select cn.name from node cn
            where cn.id = api._b_country_of(v_id)
              and cn.id <> v_id
              and cn.id is distinct from v_region.parent_id
              and cn.id not in (select e.dst from edge e where e.src = v_id and e.type = 'located_in'))),
        (5, 'Population', to_char(coalesce(v_region.population,
                                           case when v_node.props ->> 'population' ~ '^[0-9]+$'
                                                then (v_node.props ->> 'population')::bigint end),
                                  'FM999,999,999,999,990')),
        (6, 'ISO code', case when v_region.level in ('country', 'bloc') then v_region.iso2
                             when v_region.level = 'state' then v_region.code end),
        (7, 'HS code', nullif(v_node.props ->> 'hs', '')),
        (8, 'Sectors', (
            select string_agg(n.name, ', ' order by n.name)
            from edge e join node n on n.id = e.dst
            where e.src = v_id and e.type = 'in_sector')),
        (9, 'Members', (
            select nullif(count(*), 0)::text from edge e
            where e.dst = v_id and e.type = 'member_of')),
        (10, 'Produced in', (
            select string_agg(name, ', ' order by eid)
            from (select n.name, e.id as eid
                  from edge e join node n on n.id = e.src
                  where e.dst = v_id and e.type = 'produces'
                  order by e.id limit 5) p)),
        (11, 'Owner', (
            select string_agg(n.name, ', ' order by n.name)
            from edge e join node n on n.id = e.src
            where e.dst = v_id and e.type = 'owns' and (v_sample or not n.is_sample))),
        (12, 'Applies to', case when v_node.type = 'policy' then (
            select string_agg(n.name, ', ' order by e.id)
            from edge e join node n on n.id = e.dst
            where e.src = v_id and e.type = 'about') end)
    )
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value) order by ord), '[]'::jsonb)
    into v_facts
    from (select * from f where value is not null and value <> '' order by ord limit 8) x;

    -- Timeline: events about the entity, newest first --------------------------
    if v_node.type = 'region' and v_region.level = 'bloc' then
        select coalesce(array_agg(e.src), '{}') into v_members
        from edge e where e.dst = v_id and e.type = 'member_of';
    end if;

    select coalesce(jsonb_agg(t.card order by t.first_seen desc, t.id), '[]'::jsonb)
    into v_timeline
    from (
        select sc.card, sc.first_seen, sc.id
        from api.story_card sc
        where sc.kind = 'event'
          and (v_sample or not sc.is_sample)
          and case
              when v_region.level = 'country' then sc.country_id = v_id
              when v_region.level = 'state' then sc.admin1_id = v_id
              when v_region.level = 'city' then sc.primary_region = v_id
              when v_region.level = 'bloc' then
                  sc.country_id = any(v_members)
                  or sc.id in (select e.src from edge e where e.dst = v_id and e.type = 'mentions')
              else sc.id in (select e.src from edge e where e.dst = v_id and e.type = 'mentions')
          end
        order by sc.first_seen desc, sc.id
        limit 20
    ) t;

    -- Backlinks: nodes with an edge pointing here (stories are the timeline);
    -- at most 30 child regions, 60 in all, by type then name.
    with bl as (
        select distinct e.src as id, n.type, n.name, e.type as edge_type
        from edge e
        join node n on n.id = e.src
        where e.dst = v_id
          and n.type not in ('story', 'user_entity')
          and (v_sample or not n.is_sample)
          and (n.type <> 'forecast' or api._b_forecast_ok(n.id, v_viewer, v_sample))
    ),
    children as (
        select bl.* from bl
        join api._b_top_children(array[v_id], 30) c on c.child = bl.id
        where bl.edge_type = 'part_of'
    ),
    picked as (
        select * from children
        union all
        select * from bl where bl.edge_type <> 'part_of'
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'type', type, 'name', name, 'edge_type', edge_type)
           order by type, name, id, edge_type), '[]'::jsonb)
    into v_backlinks
    from (select * from picked order by type, name, id, edge_type limit 60) x;

    -- Forecasts about the entity (biggest first), with history ----------------------
    select coalesce(array_agg(x.id order by x.volume desc nulls last, x.id), '{}') into v_fids
    from (
        select f.id, api._b_latest_volume(f.id) as volume
        from (
            select distinct e.src as id
            from edge e join node n on n.id = e.src
            where e.dst = v_id and e.type = 'about' and n.type = 'forecast'
        ) f
        where api._b_forecast_ok(f.id, v_viewer, v_sample)
        order by volume desc nulls last, f.id
        limit 20
    ) x;

    select coalesce(jsonb_agg(t.card || jsonb_build_object('history', api._b_history(t.card ->> 'id', 120))
                              order by t.ord), '[]'::jsonb)
    into v_forecasts
    from jsonb_array_elements(api._b_cards(v_fids)) with ordinality as t(card, ord);

    -- Indicators whose subject is the entity ----------------------------------------
    select coalesce(jsonb_agg(k.kpi order by k.name, k.id), '[]'::jsonb)
    into v_indicators
    from (
        select i.node_id as id, i.name, api._b_kpi(i.node_id) as kpi
        from indicator_series i
        join node n on n.id = i.node_id
        where i.subject_id = v_id and (v_sample or not n.is_sample)
    ) k
    where k.kpi is not null;

    v_graph := api._b_local_graph(v_id, 1, 60, v_viewer, v_sample) - 'truncated';

    return jsonb_build_object(
        'entity', jsonb_build_object(
            'id', v_node.id,
            'type', v_node.type,
            'subtype', v_node.subtype,
            'name', v_node.name,
            'summary', v_node.summary,
            'qid', v_node.qid,
            'aliases', to_jsonb(v_node.aliases),
            'facts', v_facts,
            'lon', v_lon,
            'lat', v_lat,
            'is_sample', v_node.is_sample),
        'timeline', v_timeline,
        'backlinks', v_backlinks,
        'forecasts', v_forecasts,
        'indicators', v_indicators,
        'graph', v_graph);
end
$$;

-- ---------------------------------------------------------------------------
-- api.graph({types?, sectors?, regions?, window?, min_confidence?, limit?,
--            sample?}) → GraphResponse: the global knowledge graph.
-- ---------------------------------------------------------------------------
create or replace function api.graph(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_types text[] := api._text_array(args -> 'types');
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_regions text[] := api._text_array(args -> 'regions');
    v_window interval := api._window(jsonb_build_object('window', coalesce(nullif(args ->> 'window', ''), '30d')));
    v_min_conf numeric := greatest(0, least(1, api._b_num(args -> 'min_confidence', 0)));
    v_limit integer := greatest(1, least(1500, api._b_int(args -> 'limit', 400)));
    v_with_sectors boolean;
    v_region_set text[];
    v_blocs text[];
    v_seeds text[];
    v_entities text[];
    v_projected text[];
    v_forecasts text[];
    v_all text[];
    v_truncated boolean := false;
begin
    v_with_sectors := coalesce('sector' = any(v_types), false);

    -- Regions, plus the member countries of any bloc among them. Stories
    -- about a bloc itself (which have no country) count for that bloc.
    if v_regions is not null then
        select array_agg(distinct r.id) into v_region_set
        from (
            select unnest(v_regions) as id
            union
            select e.src from edge e where e.type = 'member_of' and e.dst = any(v_regions)
        ) r;
        select coalesce(array_agg(r.node_id), '{}') into v_blocs
        from region r where r.node_id = any(v_regions) and r.level = 'bloc';
    end if;

    -- Seeds: event stories in the window.
    select coalesce(array_agg(s.node_id), '{}') into v_seeds
    from story s
    join node n on n.id = s.node_id
    where s.kind = 'event'
      and s.first_seen >= now() - v_window
      and (v_sample or not n.is_sample)
      and (v_sectors is null or s.sectors && v_sectors)
      and (v_region_set is null
           or s.country_id = any(v_region_set)
           or s.admin1_id = any(v_region_set)
           or s.primary_region = any(v_region_set)
           or (cardinality(v_blocs) > 0 and exists (
                   select 1 from edge e
                   where e.src = s.node_id and e.type = 'mentions' and e.dst = any(v_blocs))));

    -- Entities they mention (sectors only when asked for).
    select coalesce(array_agg(distinct e.dst), '{}') into v_entities
    from edge e
    join node n on n.id = e.dst
    where e.src = any(v_seeds)
      and e.type = 'mentions'
      and n.type not in ('story', 'forecast', 'user_entity')
      and (n.type <> 'sector' or v_with_sectors)
      and (v_sample or not n.is_sample);

    -- Projected stories linked from the seeds.
    select coalesce(array_agg(distinct cl.dst_story), '{}') into v_projected
    from causal_link cl
    join story s on s.node_id = cl.dst_story
    join node n on n.id = cl.dst_story
    where cl.src_story = any(v_seeds)
      and s.kind = 'projected'
      and cl.confidence >= v_min_conf
      and (v_sample or not n.is_sample)
      and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample));

    v_all := v_seeds || v_entities || v_projected;

    -- Visible forecasts related to or about anything included.
    select coalesce(array_agg(distinct e.src), '{}') into v_forecasts
    from edge e
    join node n on n.id = e.src
    where e.dst = any(v_all)
      and e.type in ('relates_to', 'about')
      and n.type = 'forecast'
      and api._b_forecast_ok(e.src, v_viewer, v_sample);

    v_all := v_all || v_forecasts;

    if v_types is not null then
        select coalesce(array_agg(n.id), '{}') into v_all
        from node n where n.id = any(v_all) and n.type = any(v_types);
    end if;

    -- Over the limit: keep the most important stories and the most
    -- connected other nodes (score 25·ln(1 + degree), so degree 7 ≈ 52).
    if cardinality(v_all) > v_limit then
        v_truncated := true;
        with ids as (
            select unnest(v_all) as id
        ),
        lk as (
            select e.src, e.dst from edge e
            join ids a on a.id = e.src join ids b on b.id = e.dst
            union all
            select cl.src_story, cl.dst_story from causal_link cl
            join ids a on a.id = cl.src_story join ids b on b.id = cl.dst_story
            where cl.confidence >= v_min_conf
              and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample))
        ),
        deg as (
            select x.id, count(*) as c
            from (select src as id from lk union all select dst from lk) x
            group by x.id
        ),
        scored as (
            select i.id,
                   case when s.node_id is not null then s.importance::numeric
                        else least(100, 25 * ln(1 + coalesce(d.c, 0))) end as score
            from ids i
            left join story s on s.node_id = i.id
            left join deg d on d.id = i.id
        )
        select array_agg(id order by score desc, id) into v_all
        from (select id, score from scored order by score desc, id limit v_limit) top;
    end if;

    return api._b_graph_data(v_all, v_viewer, v_sample, v_min_conf, v_truncated)
        || jsonb_build_object('truncated', v_truncated);
end
$$;

-- ---------------------------------------------------------------------------
-- api.local_graph({id, depth: 1..3, limit?}) → LocalGraphResponse
-- ---------------------------------------------------------------------------
create or replace function api.local_graph(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_depth integer := greatest(1, least(3, api._b_int(args -> 'depth', 1)));
    v_limit integer := greatest(1, least(400, api._b_int(args -> 'limit', 150)));
    v_viewer text := api._viewer_country(args);
    v_node public.node%rowtype;
begin
    select * into v_node from node where id = v_id;
    if not found or v_node.type = 'user_entity'
       or (v_node.type = 'forecast' and not api._b_forecast_focus_ok(v_id, v_viewer)) then
        raise exception 'Not found: %', v_id;
    end if;
    return api._b_local_graph(v_id, v_depth, v_limit, v_viewer,
                              v_node.is_sample or api._use_sample(args))
        || jsonb_build_object('focus', v_id);
end
$$;

-- ---------------------------------------------------------------------------
-- api.search({q, types?, limit?}) → SearchResponse
-- Exact name or alias (1) > prefix (0.8) > word prefix (0.5, three or more
-- characters) / trigram similarity ≥ 0.3, pg_trgm's default threshold, which
-- Supabase doesn't let functions change (similarity × 0.7). Boosts:
-- countries +0.15, states +0.05, events under 24 hours old +0.1,
-- forecasts +0.05.
-- ---------------------------------------------------------------------------
create or replace function api.search(args jsonb) returns jsonb
language plpgsql stable
set search_path = public, extensions
as $$
declare
    v_q text := left(btrim(coalesce(args ->> 'q', '')), 80);
    v_lq text;
    v_wq text;
    v_like text;
    v_types text[] := api._text_array(args -> 'types');
    v_limit integer := greatest(1, least(50, api._b_int(args -> 'limit', 12)));
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_results jsonb;
begin
    if v_q = '' then
        return jsonb_build_object('results', '[]'::jsonb);
    end if;
    v_lq := lower(v_q);
    v_wq := btrim(regexp_replace(v_lq, '[^[:alnum:]]+', ' ', 'g'));
    -- Escape LIKE wildcards so the query is matched literally.
    v_like := '%' || replace(replace(replace(v_lq, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    with matched as (
        select n.id, n.name as label, false as code
        from node n
        where n.name % v_q or n.name ilike v_like
        union all
        select n.id, a.alias, false
        from node n
        cross join lateral unnest(n.aliases) as a(alias)
        where n.aliases <> '{}' and (a.alias % v_q or a.alias ilike v_like)
        union all
        -- ISO codes ("US", "EU", "IND", "IN-GJ") work as exact-only aliases.
        select r.node_id, upper(v_q), true
        from region r
        join node n on n.id = r.node_id
        where length(v_q) <= 6 and upper(v_q) in (r.iso2, r.code, n.props ->> 'iso3')
    ),
    scored as (
        select m.id, max(
            case
                when m.code then 1.0
                when lower(m.label) = v_lq then 1.0
                when starts_with(lower(m.label), v_lq) then 0.8
                else greatest(
                    case when length(v_wq) >= 3
                              and strpos(' ' || btrim(regexp_replace(lower(m.label), '[^[:alnum:]]+', ' ', 'g')),
                                         ' ' || v_wq) > 0
                         then 0.5 else 0 end,
                    case when similarity(m.label, v_q) >= 0.3
                         then similarity(m.label, v_q)::numeric * 0.7 else 0 end)
            end) as base
        from matched m
        group by m.id
    ),
    ranked as (
        select n.id, n.type, n.subtype, n.name,
               sc.base
               + case when r.level = 'country' then 0.15 when r.level = 'state' then 0.05 else 0 end
               + case when s.kind = 'event' and s.first_seen > now() - interval '24 hours' then 0.1 else 0 end
               + case when n.type = 'forecast' then 0.05 else 0 end as score
        from scored sc
        join node n on n.id = sc.id
        left join region r on r.node_id = n.id
        left join story s on s.node_id = n.id
        where sc.base > 0
          and (v_types is null or n.type = any(v_types))
          and (v_sample or not n.is_sample)
          and n.type <> 'user_entity'
          and (n.type <> 'forecast' or api._b_forecast_ok(n.id, v_viewer, v_sample))
        order by score desc, length(n.name), n.name, n.id
        limit v_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'type', type, 'subtype', subtype, 'name', name,
               'context', api._b_context(id),
               'score', round(score, 3))
           order by score desc, length(name), name, id), '[]'::jsonb)
    into v_results
    from ranked;

    return jsonb_build_object('results', v_results);
end
$$;
