-- 0013: an opportunity card's crowd forecast must be about the opening, not
-- just its country (replaces api._c_best_forecasts from 0006).
--
-- 0006 attached a forecast about any entity a story mentions or its country,
-- so "Will the Fed cut rates at its next meeting?" sat on ten US cards about
-- ports, foundries and castings. Now a forecast needs two signals:
--   0. a conditional link of the story hangs on it, or it relates to the story;
--   1. it is about an entity the story mentions (an organisation, commodity,
--      policy, piece of infrastructure…; not a place or a sector), and it
--      shares a place or a sector with the story; or
--   2. its places and the story's match both ways (the story's country is one
--      of the forecast's, and every country the forecast is about is one of
--      the story's), and it shares a sector with the story.
-- Otherwise the card has no forecast. Among those that qualify: the lowest
-- group, then the most shared entities and places, then the biggest volume.
--
-- A story's places: its country, the countries of the regions it mentions,
-- and the blocs (EU…) those belong to. A forecast's places: the countries of
-- the regions it is about (a bloc counts as itself). A forecast's sectors:
-- its category's (api._c_category_sectors) and the sectors it is about.

create or replace function api._c_best_forecasts(p_stories text[], p_visible text[])
returns table (story_id text, forecast_id text)
language sql stable set search_path = public, extensions as $$
    with st as materialized (
        select distinct x.id from unnest(p_stories) as x(id)
    ),
    vis as materialized (
        select distinct x.id from unnest(p_visible) as x(id)
    ),
    ents as materialized (
        -- the entities each story mentions (not places, sectors or other stories)
        select st.id as story_id, m.dst as ent
        from st
        join edge m on m.src = st.id and m.type = 'mentions'
        join node mn on mn.id = m.dst
        where mn.type not in ('region', 'sector', 'story', 'forecast', 'user_entity', 'indicator')
    ),
    own_regions as materialized (
        -- the regions each story is in or mentions
        select st.id as story_id, m.dst as rid
        from st
        join edge m on m.src = st.id and m.type = 'mentions'
        join region r on r.node_id = m.dst
        union
        select st.id, x.rid
        from st
        join story s on s.node_id = st.id
        cross join lateral (values (s.country_id), (s.admin1_id), (s.primary_region)) as x(rid)
        join region r on r.node_id = x.rid
    ),
    regions as materialized (
        -- those, and the regions they are in (a city's state)
        select o.story_id, o.rid from own_regions o
        union
        select o.story_id, r.parent_id
        from own_regions o
        join region r on r.node_id = o.rid
        where r.parent_id is not null
    ),
    places as materialized (
        -- the story's places: those regions as countries (a bloc as itself),
        -- plus the blocs the countries belong to
        select rg.story_id, coalesce(r.country_id, r.node_id) as place
        from regions rg
        join region r on r.node_id = rg.rid
        union
        select rg.story_id, b.dst
        from regions rg
        join region r on r.node_id = rg.rid
        join edge b on b.src = coalesce(r.country_id, r.node_id) and b.type = 'member_of'
    ),
    pairs as materialized (
        -- visible forecasts linked to a story, or sharing an entity, region or place with it
        select x.story_id, x.fid, bool_or(x.direct) as direct
        from (
            select cl.dst_story as story_id, cl.forecast_id as fid, true as direct
            from st
            join causal_link cl on cl.dst_story = st.id
            where cl.forecast_id is not null
            union all
            select e.dst, e.src, true
            from st
            join edge e on e.dst = st.id and e.type = 'relates_to'
            union all
            select en.story_id, fe.src, false
            from ents en
            join edge fe on fe.dst = en.ent and fe.type = 'about'
            union all
            select sp.story_id, fe.src, false
            from (select rg.story_id, rg.rid as dst from regions rg
                  union
                  select pl.story_id, pl.place from places pl) sp
            join edge fe on fe.dst = sp.dst and fe.type = 'about'
        ) x
        join vis on vis.id = x.fid
        group by x.story_id, x.fid
    ),
    fmeta as materialized (
        -- each candidate forecast's sectors and places
        select f.node_id as fid,
               api._c_category_sectors(f.category) || array(
                   select substr(fe.dst, length('sector:') + 1)
                   from edge fe
                   where fe.src = f.node_id and fe.type = 'about' and fe.dst like 'sector:%'
               ) as sectors,
               array(
                   select distinct coalesce(r.country_id, r.node_id)
                   from edge fe
                   join region r on r.node_id = fe.dst
                   where fe.src = f.node_id and fe.type = 'about'
               ) as places
        from (select distinct p.fid from pairs p) c
        join forecast f on f.node_id = c.fid
    ),
    ent_hits as (
        select en.story_id, fe.src as fid, count(distinct en.ent) as n
        from ents en
        join edge fe on fe.dst = en.ent and fe.type = 'about'
        group by en.story_id, fe.src
    ),
    place_hits as (
        select p.story_id, p.fid, count(pl.place) as shared, count(*) as total
        from pairs p
        join fmeta fm on fm.fid = p.fid
        cross join lateral unnest(fm.places) as fp(place)
        left join places pl on pl.story_id = p.story_id and pl.place = fp.place
        group by p.story_id, p.fid
    ),
    per as (
        select p.story_id, p.fid,
               case
                   when p.direct then 0
                   when coalesce(eh.n, 0) > 0
                        and (coalesce(ph.shared, 0) > 0 or s.sectors && fm.sectors) then 1
                   when ph.total > 0 and ph.shared = ph.total
                        and s.country_id = any(fm.places)
                        and s.sectors && fm.sectors then 2
                   else 3
               end as grp,
               coalesce(eh.n, 0) + coalesce(ph.shared, 0) as hits
        from pairs p
        join story s on s.node_id = p.story_id
        join fmeta fm on fm.fid = p.fid
        left join ent_hits eh on eh.story_id = p.story_id and eh.fid = p.fid
        left join place_hits ph on ph.story_id = p.story_id and ph.fid = p.fid
    )
    select distinct on (p.story_id) p.story_id, p.fid
    from per p
    left join lateral (
        select fs.volume from forecast_snapshot fs
        where fs.forecast_id = p.fid
        order by fs.ts desc
        limit 1
    ) v on true
    where p.grp < 3
    order by p.story_id, p.grp, p.hits desc, v.volume desc nulls last, p.fid
$$;
