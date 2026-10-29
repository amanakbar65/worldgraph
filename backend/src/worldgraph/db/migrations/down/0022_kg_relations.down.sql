-- Undo 0022_kg_relations: relation types, causal link relation/polarity/
-- strength/delayed, and the A1/A2 api changes. The api functions go back to
-- their 0005 definitions. Edges of the relation types 0022 added
-- (supplies, operates, regulates, drives) are deleted; the five curated
-- links 0022 turned from owns into operates turn back. Runs before 0021's.

drop function if exists api.schema(jsonb);
drop function if exists api._entity_connections(text, text, boolean, integer);
drop function if exists api._b_where(text[], jsonb);
drop function if exists api._b_graph_filters(text[], text);
drop function if exists api._b_local_graph(text, integer, integer, text, boolean, text[], text);
drop function if exists api._b_local_ids(text, integer, integer, text, boolean, text[], text);
drop function if exists api._b_graph_data(text[], text, boolean, numeric, boolean, text[], text, text);

drop trigger if exists story_direction_polarity on story;
drop function if exists public.story_direction_polarity();
drop trigger if exists causal_link_defaults on causal_link;
drop function if exists public.causal_link_defaults();
drop function if exists api._polarity(text, text);
alter table causal_link
    drop column if exists delayed,
    drop column if exists strength,
    drop column if exists polarity,
    drop column if exists relation;

drop trigger if exists edge_relation_valid on edge;
drop function if exists public.edge_relation_valid();
drop function if exists api._relation_allows(text, text, text);

update edge set type = 'owns'
where type = 'operates'
  and (src, dst) in (('org:dp-world', 'infra:jebel-ali-port'), ('org:adani-ports', 'infra:mundra-port'),
                     ('org:bhp', 'infra:escondida-mine'), ('org:suez-canal-authority', 'infra:suez-canal'),
                     ('org:panama-canal-authority', 'infra:panama-canal'))
  and not exists (select 1 from edge o where o.src = edge.src and o.dst = edge.dst and o.type = 'owns');
delete from edge where type not in (
    'located_in', 'part_of', 'owns', 'subsidiary_of', 'produces',
    'exports_to', 'imports_from', 'depends_on', 'member_of', 'competes_with',
    'in_sector', 'mentions', 'about', 'relates_to');
alter table edge drop constraint if exists edge_type_fkey;
alter table edge add constraint edge_type_check check (type in (
    -- structural
    'located_in', 'part_of', 'owns', 'subsidiary_of', 'produces',
    'exports_to', 'imports_from', 'depends_on', 'member_of', 'competes_with',
    'in_sector',
    -- story mentions an entity
    'mentions',
    -- forecast or indicator is about an entity; forecast relates to a story
    'about', 'relates_to'));
drop table if exists relation_type;

-- The 0005 definitions.

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
