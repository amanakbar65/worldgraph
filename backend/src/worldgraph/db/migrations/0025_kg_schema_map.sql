-- 0025: knowledge graph upgrade, Phase A5 (the schema map). See PLAN.md
-- "Phase A".
--
-- api.schema (0022's) gains what the schema map shows (kg.schema_map):
--   types[].properties[].coverage  the share of this type's nodes with a
--       value for a stored property (0-1; null for derived ones and while
--       kg.schema_map is off);
--   types[].links  the type's biggest relations, read from its side:
--       [{relation, label, direction: out|in|both, count}], at most 6.
-- Counts now follow the graph: links outside their valid dates (valid_from
-- / valid_to) are left out, and a link counts only when both ends are shown
-- (live nodes, plus sample ones with sample data on). by_pair was already
-- correct on live-style data (tests/api/test_kg.py checks it against direct
-- counts at production scale).
--
-- Undo: down/0025_kg_schema_map.down.sql (restores 0022's api.schema).

create or replace function api.schema(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions set jit = off as $$
declare
    v_sample boolean := api._use_sample(args);
    v_props boolean := api._flag('kg.properties');
    v_map boolean := api._flag('kg.schema_map');
    v_today date := (now() at time zone 'UTC')::date;
    v_types jsonb;
    v_relations jsonb;
begin
    -- Links per relation and source / target type (edges, plus causal links).
    with pairs as (
        select e.type as relation, s.type as src_type, d.type as dst_type, count(*) as n
        from edge e
        join node s on s.id = e.src
        join node d on d.id = e.dst
        where (v_sample or not (e.is_sample or s.is_sample or d.is_sample))
          and (e.valid_from is null or e.valid_from <= v_today)
          and (e.valid_to is null or e.valid_to >= v_today)
        group by 1, 2, 3
        union all
        select cl.relation, 'story', 'story', count(*)
        from causal_link cl
        where v_sample or not cl.is_sample
        group by 1
    ),
    sides as (
        -- each pair seen from its source (out) and its target (in);
        -- symmetric relations once per side, as 'both'
        select p.src_type as type, p.relation,
               case when rt.symmetric then 'both' else 'out' end as direction, p.n
        from pairs p join relation_type rt on rt.key = p.relation
        union all
        select p.dst_type, p.relation, case when rt.symmetric then 'both' else 'in' end, p.n
        from pairs p join relation_type rt on rt.key = p.relation
        where not rt.symmetric or p.src_type <> p.dst_type
    ),
    links as (
        select x.type, jsonb_agg(jsonb_build_object(
                   'relation', x.relation,
                   'label', case when x.direction = 'in' then rt.inverse_label else rt.label end,
                   'direction', x.direction,
                   'count', x.n) order by x.n desc, x.relation, x.direction) as items
        from (
            select s.type, s.relation, s.direction, sum(s.n)::bigint as n,
                   row_number() over (partition by s.type order by sum(s.n) desc, s.relation, s.direction) as rn
            from sides s
            group by s.type, s.relation, s.direction
        ) x
        join relation_type rt on rt.key = x.relation
        where x.rn <= 6
        group by x.type
    ),
    counts as (
        select n.type, count(*) as n from node n
        where v_sample or not n.is_sample
        group by n.type
    ),
    filled as (
        select n.type, k.key, count(*) as n
        from node n
        cross join lateral jsonb_object_keys(n.properties) as k(key)
        where (v_sample or not n.is_sample) and n.properties <> '{}'::jsonb
        group by n.type, k.key
    ),
    per as (
        select p.relation, sum(p.n)::bigint as n,
               jsonb_agg(jsonb_build_object('src_type', p.src_type, 'dst_type', p.dst_type, 'count', p.n)
                         order by p.n desc, p.src_type, p.dst_type) as by_pair
        from pairs p
        group by p.relation
    ),
    types as (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'key', nt.key,
                   'label', nt.label,
                   'plural', nt.plural,
                   'icon', nt.icon,
                   'tone', nt.tone,
                   'description', nt.description,
                   'count', coalesce(c.n, 0),
                   'properties', case when v_props then (
                       select coalesce(jsonb_agg(d.def || jsonb_build_object('coverage',
                                  case when v_map and not coalesce((d.def ->> 'derived')::boolean, false)
                                       then round(coalesce(f.n, 0)::numeric / greatest(c.n, 1), 3) end)
                              order by d.ord), '[]'::jsonb)
                       from jsonb_array_elements(nt.properties) with ordinality as d(def, ord)
                       left join filled f on f.type = nt.key and f.key = d.def ->> 'key'
                   ) else '[]'::jsonb end,
                   'links', case when v_map then coalesce(l.items, '[]'::jsonb) else '[]'::jsonb end)
               order by nt.ord), '[]'::jsonb) as j
        from node_type nt
        left join counts c on c.type = nt.key
        left join links l on l.type = nt.key
    ),
    relations as (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'key', rt.key,
                   'label', rt.label,
                   'inverse_label', rt.inverse_label,
                   'icon', rt.icon,
                   'causal', rt.causal,
                   'symmetric', rt.symmetric,
                   'src_types', to_jsonb(rt.src_types),
                   'dst_types', to_jsonb(rt.dst_types),
                   'description', rt.description,
                   'count', coalesce(per.n, 0),
                   'by_pair', case when v_map then coalesce(per.by_pair, '[]'::jsonb) else '[]'::jsonb end)
               order by rt.ord), '[]'::jsonb) as j
        from relation_type rt
        left join per on per.relation = rt.key
    )
    select t.j, r.j into v_types, v_relations from types t cross join relations r;

    return jsonb_build_object('types', v_types, 'relations', v_relations);
end
$$;

grant execute on all functions in schema api to wg_web_reader;
