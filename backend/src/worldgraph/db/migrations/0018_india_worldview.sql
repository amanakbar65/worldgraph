-- India's official view for names and parents, not only for map shapes.
--
-- With India's borders on, the map draws Gilgit-Baltistan and the area
-- Pakistan calls Azad Kashmir inside India (Ladakh, Jammu and Kashmir), but
-- search and the region panel still said "Azad Kashmir · Pakistan" and
-- "Northern Areas · Pakistan". The app now sends `worldview: "india"` with
-- search and region when the viewer sees India's borders, and:
--
-- * api.search shows those two regions as their Indian parent (one entry,
--   "Jammu and Kashmir · State · India", "Ladakh · State · India");
-- * api.region opens the Indian parent for them, and Pakistan's page leaves
--   them out of its states and its graph.
--
-- Without `worldview` (or with any other value) nothing changes. The list
-- matches frontend/public/geo/manifest.json (worldviews.india.statesNotShown);
-- the Paracel Islands, also not drawn there, are not an Indian claim and
-- keep their name.

-- The worldview the viewer asked for: 'india' or null (the international default).
create or replace function api._worldview(args jsonb) returns text
language sql immutable as $$
    select case when lower(btrim(coalesce(args ->> 'worldview', ''))) = 'india' then 'india' end
$$;

-- The region a viewer with this worldview knows `p_id` as (itself when no change).
create or replace function api._wv_region(p_id text, p_view text) returns text
language sql immutable as $$
    select case
        when p_view = 'india' and p_id = 'region:pk-jk' then 'region:in-jk'  -- Jammu and Kashmir
        when p_view = 'india' and p_id = 'region:pk-gb' then 'region:in-la'  -- Ladakh
        else p_id
    end
$$;

-- The international versions stay as they are, under a new name.
alter function api.search(jsonb) rename to _search_world;
alter function api.region(jsonb) rename to _region_world;

create or replace function api.search(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_view text := api._worldview(args);
    v_res jsonb := api._search_world(args);
begin
    if v_view is null then
        return v_res;
    end if;
    -- Swap in the region the viewer knows, then keep each id once (best score first).
    return jsonb_build_object('results', coalesce((
        select jsonb_agg(d.r order by d.ord)
        from (
            select distinct on (x.r ->> 'id') x.r, x.ord
            from (
                select case
                           when m.id is not null then
                               t.e || jsonb_build_object(
                                   'id', m.id, 'type', m.type, 'subtype', m.subtype, 'name', m.name,
                                   'context', api._b_context(m.id))
                           else t.e
                       end as r,
                       t.ord
                from jsonb_array_elements(v_res -> 'results') with ordinality as t(e, ord)
                left join node m
                       on m.id = api._wv_region(t.e ->> 'id', v_view)
                      and m.id <> t.e ->> 'id'
            ) x
            order by x.r ->> 'id', x.ord
        ) d
    ), '[]'::jsonb));
end
$$;

create or replace function api.region(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_view text := api._worldview(args);
    v_res jsonb;
    v_gone text[];
begin
    if v_view is null then
        return api._region_world(args);
    end if;
    v_res := api._region_world(
        args || jsonb_build_object('id', api._wv_region(args ->> 'id', v_view)));

    -- Regions this view places elsewhere leave this page's states and graph.
    select coalesce(array_agg(c ->> 'id'), '{}') into v_gone
    from jsonb_array_elements(v_res -> 'children') c
    where api._wv_region(c ->> 'id', v_view) <> c ->> 'id';
    if cardinality(v_gone) = 0 then
        return v_res;
    end if;
    return v_res
        || jsonb_build_object('children', (
               select coalesce(jsonb_agg(c order by o), '[]'::jsonb)
               from jsonb_array_elements(v_res -> 'children') with ordinality as t(c, o)
               where not (c ->> 'id' = any (v_gone))))
        || jsonb_build_object('graph', (v_res -> 'graph') || jsonb_build_object(
               'nodes', (
                   select coalesce(jsonb_agg(n order by o), '[]'::jsonb)
                   from jsonb_array_elements(v_res -> 'graph' -> 'nodes') with ordinality as t(n, o)
                   where not (n ->> 'id' = any (v_gone))),
               'links', (
                   select coalesce(jsonb_agg(l order by o), '[]'::jsonb)
                   from jsonb_array_elements(v_res -> 'graph' -> 'links') with ordinality as t(l, o)
                   where not (l ->> 'source' = any (v_gone)) and not (l ->> 'target' = any (v_gone)))));
end
$$;

grant execute on function api.search(jsonb), api.region(jsonb), api._worldview(jsonb),
    api._wv_region(text, text) to wg_web_reader;
