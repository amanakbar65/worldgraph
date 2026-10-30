-- Undo 0025_kg_schema_map: api.schema goes back to 0022's (no property
-- coverage or per-type links; counts include links outside their valid
-- dates). Runs before 0024's.

create or replace function api.schema(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_props boolean := api._flag('kg.properties');
    v_map boolean := api._flag('kg.schema_map');
    v_types jsonb;
    v_relations jsonb;
begin
    select coalesce(jsonb_agg(jsonb_build_object(
               'key', nt.key,
               'label', nt.label,
               'plural', nt.plural,
               'icon', nt.icon,
               'tone', nt.tone,
               'description', nt.description,
               'count', coalesce(c.n, 0),
               'properties', case when v_props then nt.properties else '[]'::jsonb end)
           order by nt.ord), '[]'::jsonb)
    into v_types
    from node_type nt
    left join (
        select n.type, count(*) as n from node n
        where v_sample or not n.is_sample
        group by n.type
    ) c on c.type = nt.key;

    with pairs as (
        select e.type as relation, s.type as src_type, d.type as dst_type, count(*) as n
        from edge e
        join node s on s.id = e.src
        join node d on d.id = e.dst
        where v_sample or not e.is_sample
        group by 1, 2, 3
        union all
        select cl.relation, 'story', 'story', count(*)
        from causal_link cl
        where v_sample or not cl.is_sample
        group by 1
    ),
    per as (
        select p.relation, sum(p.n)::bigint as n,
               jsonb_agg(jsonb_build_object('src_type', p.src_type, 'dst_type', p.dst_type, 'count', p.n)
                         order by p.n desc, p.src_type, p.dst_type) as by_pair
        from pairs p
        group by p.relation
    )
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
           order by rt.ord), '[]'::jsonb)
    into v_relations
    from relation_type rt
    left join per on per.relation = rt.key;

    return jsonb_build_object('types', v_types, 'relations', v_relations);
end
$$;
