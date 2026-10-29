-- Undo 0024_kg_history: the change log, its triggers and the history
-- schema (the log is lost), the as-of views and api.graph_as_of /
-- api.local_graph_as_of. The graph functions go back to their earlier
-- definitions (api._b_graph_data from 0023, api._b_local_ids, api.graph and
-- api.local_graph from 0022, api._b_top_children from 0005), which read the
-- tables directly and ignore valid dates. Runs before 0023's.

drop function if exists api.graph_as_of(jsonb);
drop function if exists api.local_graph_as_of(jsonb);
drop function if exists api._as_of(text, jsonb);
drop function if exists api._history_at(jsonb);

drop trigger if exists node_history_insert on node;
drop trigger if exists node_history_update on node;
drop trigger if exists node_history_delete on node;
drop trigger if exists story_history_insert on story;
drop trigger if exists story_history_update on story;
drop trigger if exists edge_history_insert on edge;
drop trigger if exists edge_history_update on edge;
drop trigger if exists edge_history_delete on edge;
drop trigger if exists edge_history_mentions_insert on edge;
drop trigger if exists edge_history_mentions_update on edge;
drop trigger if exists edge_history_mentions_delete on edge;
drop trigger if exists causal_link_history_insert on causal_link;
drop trigger if exists causal_link_history_update on causal_link;
drop trigger if exists causal_link_history_delete on causal_link;

-- ---------------------------------------------------------------------------
-- Earlier definitions (they stop reading the views)
-- ---------------------------------------------------------------------------

create or replace function api._b_graph_data(
    p_ids text[], p_viewer text, p_sample boolean,
    p_min_conf numeric default 0, p_drop_isolated boolean default false,
    p_relations text[] default null, p_focus text default null, p_direction text default 'both')
returns jsonb
language sql stable set search_path = public, extensions as $$
    with ids as (
        select u.id, min(u.ord) as ord
        from unnest(p_ids) with ordinality as u(id, ord)
        group by u.id
    ),
    prov as (
        select api._flag('kg.provenance') as enabled
    ),
    edge_links as (
        select distinct on (e.src, e.dst, e.type)
               e.id, e.src as source, e.dst as target, e.type, false as causal,
               round(e.confidence::numeric, 3) as confidence, e.created_at,
               e.type as relation, null::smallint as polarity, null::numeric as strength,
               null::boolean as delayed,
               e.confidence < 0.5 as weak
        from edge e
        join ids a on a.id = e.src
        join ids b on b.id = e.dst
        where (p_relations is null or e.type = any(p_relations))
          and (e.confidence is null or e.confidence >= p_min_conf)
        order by e.src, e.dst, e.type, e.id
    ),
    causal_links as (
        select distinct on (cl.src_story, cl.dst_story, cl.link_type)
               cl.id, cl.src_story as source, cl.dst_story as target, cl.link_type as type, true as causal,
               round(cl.confidence::numeric, 3) as confidence, cl.created_at,
               cl.relation, cl.polarity, round(coalesce(cl.strength, cl.confidence)::numeric, 3) as strength,
               cl.delayed,
               cl.confidence < 0.5 or not exists (select 1 from evidence ev where ev.causal_link_id = cl.id) as weak
        from causal_link cl
        join ids a on a.id = cl.src_story
        join ids b on b.id = cl.dst_story
        where cl.confidence >= p_min_conf
          and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample))
          and (p_relations is null or cl.relation = any(p_relations))
        order by cl.src_story, cl.dst_story, cl.link_type, cl.confidence desc, cl.id
    ),
    all_links as (
        select * from edge_links
        union all
        select * from causal_links
    ),
    links as (
        select l.*
        from all_links l
        left join relation_type rt on rt.key = l.relation
        where p_focus is null
           or coalesce(p_direction, 'both') = 'both'
           or coalesce(rt.symmetric, false)
           or (p_direction = 'out' and l.target <> p_focus)
           or (p_direction = 'in' and l.source <> p_focus)
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
                               'id', id, 'source', source, 'target', target, 'type', type, 'causal', causal,
                               'confidence', confidence, 'created_at', created_at,
                               'relation', relation, 'polarity', polarity, 'strength', strength,
                               'delayed', delayed,
                               'weak', coalesce(weak, false) and (select enabled from prov))
                           order by causal, source, target, type)
                           from links), '[]'::jsonb))
$$;

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

create or replace function api._b_local_ids(
    p_focus text, p_depth integer, p_limit integer, p_viewer text, p_sample boolean,
    p_relations text[] default null, p_direction text default 'both',
    out ids text[], out truncated boolean)
language plpgsql stable set search_path = public, extensions as $$
declare
    v_frontier text[] := array[p_focus];
    v_next text[];
    v_found integer;
    v_room integer;
    v_level integer;
    v_out boolean := coalesce(p_direction, 'both') <> 'in';
    v_in boolean := coalesce(p_direction, 'both') <> 'out';
begin
    ids := array[p_focus];
    truncated := false;
    for v_level in 1 .. p_depth loop
        exit when cardinality(v_frontier) = 0;
        v_room := greatest(p_limit - cardinality(ids), 0);

        with expand as (
            select n.id
            from node n
            where n.id = any(v_frontier) and (n.type <> 'sector' or n.id = p_focus)
        ),
        nb(id, via) as (
            select e.dst, e.src
            from edge e join expand x on x.id = e.src join relation_type rt on rt.key = e.type
            where (v_out or rt.symmetric) and (p_relations is null or e.type = any(p_relations))
            union all
            select e.src, e.dst
            from edge e join expand x on x.id = e.dst join relation_type rt on rt.key = e.type
            where e.type <> 'part_of'
              and (v_in or rt.symmetric) and (p_relations is null or e.type = any(p_relations))
            union all
            select c.child, c.parent
            from api._b_top_children(array(select id from expand), 12) c
            where v_in and (p_relations is null or 'part_of' = any(p_relations))
            union all
            select cl.dst_story, cl.src_story from causal_link cl join expand x on x.id = cl.src_story
            where v_out
              and (p_relations is null or cl.relation = any(p_relations))
              and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample))
            union all
            select cl.src_story, cl.dst_story from causal_link cl join expand x on x.id = cl.dst_story
            where v_in
              and (p_relations is null or cl.relation = any(p_relations))
              and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample))
        ),
        cand as (
            select nb.id, count(distinct nb.via) as conn
            from nb
            where nb.id <> all(ids)
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
            truncated := true;
            v_next := v_next[1:v_room];
        end if;
        exit when cardinality(v_next) = 0;
        ids := ids || v_next;
        v_frontier := v_next;
    end loop;
end
$$;

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
    v_relations text[] := api._text_array(args -> 'relations');
    v_conds jsonb;
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
    perform api._b_graph_filters(v_relations, args ->> 'direction');
    v_conds := api._b_where(v_types, args -> 'where');
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
    if v_conds is not null then
        v_all := api._where_filter(v_all, v_types[1], v_conds);
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
            where v_relations is null or e.type = any(v_relations)
            union all
            select cl.src_story, cl.dst_story from causal_link cl
            join ids a on a.id = cl.src_story join ids b on b.id = cl.dst_story
            where cl.confidence >= v_min_conf
              and (v_relations is null or cl.relation = any(v_relations))
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

    return api._b_graph_data(v_all, v_viewer, v_sample, v_min_conf, v_truncated, v_relations)
        || jsonb_build_object('truncated', v_truncated);
end
$$;

create or replace function api.local_graph(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_id text := args ->> 'id';
    v_depth integer := greatest(1, least(3, api._b_int(args -> 'depth', 1)));
    v_limit integer := greatest(1, least(400, api._b_int(args -> 'limit', 150)));
    v_viewer text := api._viewer_country(args);
    v_types text[] := api._text_array(args -> 'types');
    v_relations text[] := api._text_array(args -> 'relations');
    v_direction text;
    v_conds jsonb;
    v_node public.node%rowtype;
    v_sample boolean;
    v_ids text[];
    v_truncated boolean;
begin
    v_direction := api._b_graph_filters(v_relations, args ->> 'direction');
    v_conds := api._b_where(v_types, args -> 'where');
    select * into v_node from node where id = v_id;
    if not found or v_node.type = 'user_entity'
       or (v_node.type = 'forecast' and not api._b_forecast_focus_ok(v_id, v_viewer)) then
        raise exception 'Not found: %', v_id;
    end if;
    v_sample := v_node.is_sample or api._use_sample(args);

    select l.ids, l.truncated into v_ids, v_truncated
    from api._b_local_ids(v_id, v_depth, v_limit, v_viewer, v_sample, v_relations, v_direction) l;

    if v_types is not null then
        select array_agg(u.id order by u.ord) into v_ids
        from unnest(v_ids) with ordinality as u(id, ord)
        join node n on n.id = u.id
        where u.id = v_id or n.type = any(v_types);
    end if;
    if v_conds is not null then
        v_ids := array[v_id] || api._where_filter(array_remove(v_ids, v_id), v_types[1], v_conds);
    end if;

    return api._b_graph_data(v_ids, v_viewer, v_sample, 0, false, v_relations, v_id, v_direction)
        || jsonb_build_object('truncated', v_truncated, 'focus', v_id);
end
$$;

drop view if exists api._g_nodes;
drop view if exists api._g_stories;
drop view if exists api._g_edges;
drop view if exists api._g_links;
drop function if exists api._g_now();
drop schema if exists history cascade;
