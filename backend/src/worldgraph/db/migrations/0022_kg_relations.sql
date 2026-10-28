-- 0022: knowledge graph upgrade, Phase A2 (named relations), and the api
-- functions for A1 and A2. See PLAN.md "Phase A".
--
-- A2  relation_type: the 14 edge types with readable pairs ("Owns" /
--     "Owned by"), plus supplies, operates, regulates and the causal
--     `drives`, generated from schema/types.yaml by `wg schema sql`.
--     edge.type references it (instead of a CHECK list) and a trigger
--     checks the allowed source and target types for new rows; existing
--     rows that break the rules stay and go on the owner's review list
--     (`wg kg review`). causal_link gains relation (drives), polarity
--     (+1 the effect moves the same way as the cause, -1 the opposite way;
--     backfilled, and set the same way for every new link by a trigger, so
--     api.save_analysis and the pipeline need no change), strength (0-1;
--     null means "use confidence") and delayed (lag_days > 0).
-- API api.entity: `properties` (A1) and `connections` grouped by relation
--     (A2; `backlinks` stays for one release). api.graph and
--     api.local_graph: `where` property filters (one type), `relations` and
--     `direction`; links carry id, relation, polarity, strength, delayed.
--     api.cascade links carry the same. New api.schema(): both registries
--     with counts.
--
-- Undo: down/0022_kg_relations.down.sql (restores the 0005 functions).

-- ===========================================================================
-- Relation types
-- ===========================================================================
create table relation_type (
    key            text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
    label          text not null,                -- read from the source: "Owns"
    inverse_label  text not null,                -- read from the target: "Owned by"
    icon           text not null,                -- a lucide icon name
    causal         boolean not null default false,
    "symmetric"    boolean not null default false,  -- reads the same both ways (quoted: an SQL keyword)
    src_types      text[] not null default '{}', -- allowed source node types ({} = any)
    dst_types      text[] not null default '{}', -- allowed target node types ({} = any)
    description    text not null,
    ord            smallint not null
);
alter table relation_type enable row level security;

-- BEGIN `wg schema sql --only relation_types` (schema/types.yaml)
insert into relation_type (key, label, inverse_label, icon, causal, "symmetric", src_types, dst_types, description, ord) values
    ('located_in', 'Located in', 'Home to', 'map-pin', false, false, array['organization', 'person', 'infrastructure']::text[], array['region']::text[], 'Where something is based or sits.', 1),
    ('part_of', 'Part of', 'Includes', 'list-tree', false, false, array['region', 'infrastructure']::text[], array['region', 'infrastructure']::text[], 'A smaller place inside a larger one (city → state → country).', 2),
    ('owns', 'Owns', 'Owned by', 'key-round', false, false, array['organization', 'person', 'region']::text[], array['organization', 'infrastructure']::text[], 'Ownership of a company or an asset.', 3),
    ('subsidiary_of', 'Subsidiary of', 'Parent of', 'git-fork', false, false, array['organization']::text[], array['organization']::text[], 'A company controlled by a parent company.', 4),
    ('produces', 'Produces', 'Produced by', 'factory', false, false, array['region', 'organization', 'infrastructure']::text[], array['commodity']::text[], 'A leading producer of a commodity.', 5),
    ('exports_to', 'Exports to', 'Imports from', 'ship', false, false, array['region', 'organization']::text[], array['region', 'organization']::text[], 'Sells goods abroad to.', 6),
    ('imports_from', 'Imports from', 'Exports to', 'package-open', false, false, array['region', 'organization']::text[], array['region', 'organization']::text[], 'Buys goods from abroad.', 7),
    ('depends_on', 'Depends on', 'Needed by', 'plug', false, false, array['organization', 'region', 'infrastructure', 'commodity', 'sector']::text[], array['organization', 'region', 'infrastructure', 'commodity', 'sector', 'policy']::text[], 'Relies on something to keep working.', 8),
    ('member_of', 'Member of', 'Has member', 'users', false, false, array['region', 'organization']::text[], array['region', 'organization']::text[], 'Membership of a bloc or an organisation.', 9),
    ('competes_with', 'Competes with', 'Competes with', 'swords', false, true, array['organization']::text[], array['organization']::text[], 'Rivals in the same market.', 10),
    ('in_sector', 'In sector', 'Includes', 'tag', false, false, array['organization', 'person', 'commodity', 'infrastructure', 'policy', 'indicator']::text[], array['sector']::text[], 'Belongs to one of the nine sectors.', 11),
    ('mentions', 'Mentions', 'In the news', 'newspaper', false, false, array['story']::text[], array['region', 'organization', 'person', 'commodity', 'sector', 'infrastructure', 'policy']::text[], 'A story is about this.', 12),
    ('about', 'About', 'Covered by', 'target', false, false, array['forecast', 'indicator', 'policy']::text[], array['region', 'organization', 'person', 'commodity', 'sector', 'infrastructure', 'policy', 'story']::text[], 'A forecast, indicator or policy concerns this.', 13),
    ('relates_to', 'Related to', 'Related to', 'link', false, true, '{}'::text[], '{}'::text[], 'A generic link, used when no better relation fits (listed for review).', 14),
    ('supplies', 'Supplies', 'Supplied by', 'truck', false, false, array['organization', 'region', 'infrastructure']::text[], array['organization', 'region', 'infrastructure']::text[], 'Provides goods or services to.', 15),
    ('operates', 'Operates', 'Operated by', 'cog', false, false, array['organization']::text[], array['infrastructure']::text[], 'Runs a port, canal, mine, plant or terminal.', 16),
    ('regulates', 'Regulates', 'Regulated by', 'scale', false, false, array['organization', 'region', 'policy']::text[], array['organization', 'sector', 'commodity', 'infrastructure']::text[], 'Sets the rules for.', 17),
    ('drives', 'Drives', 'Driven by', 'arrow-right', true, false, array['story', 'region', 'organization', 'commodity', 'sector', 'infrastructure', 'policy', 'indicator']::text[], array['story', 'region', 'organization', 'commodity', 'sector', 'infrastructure', 'policy', 'indicator']::text[], 'Cause and effect: a change in one moves the other (polarity ▲ same way, ▼ opposite way).', 18)
on conflict (key) do update set label = excluded.label, inverse_label = excluded.inverse_label, icon = excluded.icon, causal = excluded.causal, "symmetric" = excluded."symmetric", src_types = excluded.src_types, dst_types = excluded.dst_types, description = excluded.description, ord = excluded.ord;
-- END `wg schema sql --only relation_types`

-- edge.type references the registry (it was a CHECK list of the same 14).
alter table edge drop constraint edge_type_check;
alter table edge add constraint edge_type_fkey foreign key (type) references relation_type (key);

-- May this relation connect these node types? (Symmetric relations either way.)
create or replace function api._relation_allows(p_relation text, p_src_type text, p_dst_type text)
returns boolean
language sql stable set search_path = public, extensions as $$
    select exists (
        select 1 from relation_type r
        where r.key = p_relation
          and (((cardinality(r.src_types) = 0 or p_src_type = any(r.src_types))
                and (cardinality(r.dst_types) = 0 or p_dst_type = any(r.dst_types)))
               or (r.symmetric
                   and (cardinality(r.src_types) = 0 or p_dst_type = any(r.src_types))
                   and (cardinality(r.dst_types) = 0 or p_src_type = any(r.dst_types)))))
$$;

-- New and changed edges must fit their relation's endpoint rules
-- (SQLSTATE 23514). Rows from before this migration aren't checked.
create or replace function public.edge_relation_valid() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_src text;
    v_dst text;
begin
    select n.type into v_src from node n where n.id = new.src;
    select n.type into v_dst from node n where n.id = new.dst;
    if v_src is null or v_dst is null then
        return new;  -- the foreign keys report a missing node
    end if;
    if not api._relation_allows(new.type, v_src, v_dst) then
        raise exception 'Relation % does not connect % (%) to % (%)', new.type, new.src, v_src, new.dst, v_dst
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger edge_relation_valid
    before insert or update of src, dst, type on edge
    for each row execute function public.edge_relation_valid();

-- Curated data: five organisations run these assets (their summaries say
-- "runs" or "operates"); the sample data now states `operates`, not `owns`.
-- A reload of the sample data never deletes reference links, so the old
-- ones change here.
update edge e set type = 'operates'
where e.type = 'owns'
  and (e.src, e.dst) in (('org:dp-world', 'infra:jebel-ali-port'), ('org:adani-ports', 'infra:mundra-port'),
                         ('org:bhp', 'infra:escondida-mine'), ('org:suez-canal-authority', 'infra:suez-canal'),
                         ('org:panama-canal-authority', 'infra:panama-canal'))
  and not exists (select 1 from edge o where o.src = e.src and o.dst = e.dst and o.type = 'operates');
delete from edge e
where e.type = 'owns'
  and (e.src, e.dst) in (('org:dp-world', 'infra:jebel-ali-port'), ('org:adani-ports', 'infra:mundra-port'),
                         ('org:bhp', 'infra:escondida-mine'), ('org:suez-canal-authority', 'infra:suez-canal'),
                         ('org:panama-canal-authority', 'infra:panama-canal'));

-- ===========================================================================
-- Causal links: relation, polarity, strength, delayed
-- ===========================================================================
alter table causal_link
    add column relation text not null default 'drives' references relation_type (key),
    add column polarity smallint check (polarity in (-1, 1)),
    add column strength real check (strength between 0 and 1),
    add column delayed boolean generated always as (lag_days > 0) stored;

-- +1 when the effect moves the way the cause did, -1 when the opposite way,
-- null when either direction is unknown.
create or replace function api._polarity(p_cause_direction text, p_link_direction text) returns smallint
language sql immutable set search_path = pg_catalog as $$
    select case
        when p_cause_direction is null or p_link_direction is null then null
        when p_cause_direction = p_link_direction then 1
        else -1
    end::smallint
$$;

update causal_link cl set polarity = api._polarity(s.direction, cl.direction)
from story s
where s.node_id = cl.src_story;

-- Every new link (api.save_analysis, the sample data, anything later) gets
-- its polarity the same way, unless the writer gives one. A causal link's
-- relation must be a causal one.
create or replace function public.causal_link_defaults() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if not exists (select 1 from relation_type r where r.key = new.relation and r.causal) then
        raise exception 'A causal link needs a causal relation, not %', new.relation
            using errcode = 'check_violation';
    end if;
    -- A polarity derived from the old direction follows a new one.
    if tg_op = 'UPDATE' and new.direction is distinct from old.direction
       and new.polarity is not distinct from old.polarity
       and old.polarity is not distinct from (
           select api._polarity(s.direction, old.direction) from story s where s.node_id = old.src_story) then
        new.polarity := null;
    end if;
    if new.polarity is null then
        select api._polarity(s.direction, new.direction) into new.polarity
        from story s where s.node_id = new.src_story;
    end if;
    return new;
end;
$$;

create trigger causal_link_defaults
    before insert or update of relation, direction on causal_link
    for each row execute function public.causal_link_defaults();

-- When AI analysis gives a cause story its direction (pipeline drafts have
-- none), the derived polarity of its links follows.
create or replace function public.story_direction_polarity() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    update causal_link cl set polarity = api._polarity(new.direction, cl.direction)
    where cl.src_story = new.node_id
      and cl.polarity is not distinct from api._polarity(old.direction, cl.direction);
    return null;
end;
$$;

create trigger story_direction_polarity
    after update of direction on story
    for each row
    when (old.direction is distinct from new.direction)
    execute function public.story_direction_polarity();

-- ===========================================================================
-- Graph data: links carry id, relation, polarity, strength and delayed.
-- (Replaces 0005's; new optional arguments, so it is dropped first.)
-- ===========================================================================
drop function api._b_graph_data(text[], text, boolean, numeric, boolean);

-- GraphData ({nodes, links}) for a set of node ids, kept in the given order.
-- Links are every edge and causal link among them (causal links need
-- confidence >= p_min_conf and, when conditional, a visible forecast),
-- limited to p_relations when given. With a focus and a direction, links
-- into the focus (out) or out of it (in) are left out, except symmetric
-- ones. Degree counts links within the result. With p_drop_isolated,
-- non-story nodes left without any link are removed.
-- A link's strength is its own, else its confidence (causal links only).
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
    edge_links as (
        select distinct on (e.src, e.dst, e.type)
               e.id, e.src as source, e.dst as target, e.type, false as causal,
               null::numeric as confidence, e.created_at,
               e.type as relation, null::smallint as polarity, null::numeric as strength,
               null::boolean as delayed
        from edge e
        join ids a on a.id = e.src
        join ids b on b.id = e.dst
        where p_relations is null or e.type = any(p_relations)
        order by e.src, e.dst, e.type, e.id
    ),
    causal_links as (
        select distinct on (cl.src_story, cl.dst_story, cl.link_type)
               cl.id, cl.src_story as source, cl.dst_story as target, cl.link_type as type, true as causal,
               round(cl.confidence::numeric, 3) as confidence, cl.created_at,
               cl.relation, cl.polarity, round(coalesce(cl.strength, cl.confidence)::numeric, 3) as strength,
               cl.delayed
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
                               'delayed', delayed)
                           order by causal, source, target, type)
                           from links), '[]'::jsonb))
$$;

-- ===========================================================================
-- Local graph: relation and direction filters.
-- ===========================================================================
drop function api._b_local_graph(text, integer, integer, text, boolean);

-- Breadth-first neighbourhood of p_focus: the ids (focus first, level by
-- level) and whether the node limit cut anything. Expands over edges (both
-- directions) and causal links. A region expands to at most 12 child
-- regions (the most active first), and sector nodes are never expanded
-- (they connect everything) unless they are the focus. Within a level,
-- stories come first by importance, then other nodes by how many
-- already-included nodes they connect to. p_relations limits the links it
-- follows; p_direction 'out' follows links away from the focus only
-- (source → target), 'in' towards it; symmetric relations count both ways.
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

-- {nodes, links, truncated} around p_focus (see api._b_local_ids).
create or replace function api._b_local_graph(
    p_focus text, p_depth integer, p_limit integer, p_viewer text, p_sample boolean,
    p_relations text[] default null, p_direction text default 'both')
returns jsonb
language sql stable set search_path = public, extensions as $$
    select api._b_graph_data(l.ids, p_viewer, p_sample, 0, false, p_relations, p_focus, p_direction)
           || jsonb_build_object('truncated', l.truncated)
    from api._b_local_ids(p_focus, p_depth, p_limit, p_viewer, p_sample, p_relations, p_direction) l
$$;

-- Checks the shared graph filter arguments: relations (known keys) and
-- direction (in | out | both). Returns the direction.
create or replace function api._b_graph_filters(p_relations text[], p_direction text) returns text
language plpgsql stable set search_path = public, extensions as $$
declare
    v_unknown text;
    v_direction text := coalesce(nullif(p_direction, ''), 'both');
begin
    if v_direction not in ('in', 'out', 'both') then
        raise exception 'direction must be in, out or both';
    end if;
    if p_relations is not null or v_direction <> 'both' then
        if not api._flag('kg.relations') then
            raise exception 'Relation filters are switched off';
        end if;
    end if;
    select r into v_unknown from unnest(coalesce(p_relations, '{}')) as r
    where r not in (select key from relation_type) limit 1;
    if v_unknown is not null then
        raise exception 'Unknown relation: %', v_unknown;
    end if;
    return v_direction;
end
$$;

-- The checked property conditions for `where`, or null when there are none.
-- `where` needs exactly one node type.
create or replace function api._b_where(p_types text[], p_where jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
begin
    if p_where is null or jsonb_typeof(p_where) = 'null'
       or (jsonb_typeof(p_where) = 'array' and jsonb_array_length(p_where) = 0) then
        return null;
    end if;
    if not api._flag('kg.properties') then
        raise exception 'Property filters are switched off';
    end if;
    if p_types is null or cardinality(p_types) <> 1 then
        raise exception 'where needs one type';
    end if;
    return api._where_conditions(p_types[1], p_where);
end
$$;

-- ===========================================================================
-- api.graph({types?, sectors?, regions?, window?, min_confidence?, limit?,
--            where?, relations?, direction?, sample?}) → GraphResponse
-- 0005's, plus: where (property conditions on the one selected type),
-- relations (only these links). direction needs a focus, so it is checked
-- but has no effect here (see api.local_graph).
-- ===========================================================================
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

-- ===========================================================================
-- api.local_graph({id, depth: 1..3, limit?, types?, where?, relations?,
--                  direction?, sample?}) → LocalGraphResponse
-- 0005's, plus: relations and direction (relative to the focus) limit the
-- links the neighbourhood follows; types and where keep only nodes of
-- those types (where: one type) that meet the conditions, and the focus.
-- ===========================================================================
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

-- ===========================================================================
-- Connections: an entity's links grouped by relation, read from its side
-- ("Owned by", "Supplies"…), biggest group first. Symmetric relations are
-- one group (direction 'both'). Items: at most p_per per group, newest
-- stories first, then the most populous places, then by name; count is
-- the whole group.
-- ===========================================================================
create or replace function api._entity_connections(
    p_id text, p_viewer text, p_sample boolean, p_per integer default 12)
returns jsonb
language sql stable set search_path = public, extensions as $$
    with raw as (
        select e.type as relation, 'out' as dir, e.dst as other, e.props from edge e where e.src = p_id
        union all
        select e.type, 'in', e.src, e.props from edge e where e.dst = p_id
    ),
    vis as (
        select r.relation,
               case when rt.symmetric then 'both' else r.dir end as direction,
               case when r.dir = 'out' or rt.symmetric then rt.label else rt.inverse_label end as label,
               rt.causal, rt.ord,
               n.id, coalesce(s.headline, n.name) as name, n.type, n.subtype, n.is_sample,
               s.first_seen, rg.population,
               case when jsonb_typeof(r.props -> 'confidence') = 'number'
                    then round((r.props ->> 'confidence')::numeric, 3) end as confidence
        from raw r
        join relation_type rt on rt.key = r.relation
        join node n on n.id = r.other
        left join story s on s.node_id = n.id
        left join region rg on rg.node_id = n.id
        where n.id <> p_id
          and (p_sample or not n.is_sample)
          and n.type <> 'user_entity'
          and (n.type <> 'forecast' or api._b_forecast_ok(n.id, p_viewer, p_sample))
    ),
    dedup as (
        select distinct on (relation, direction, id) *
        from vis
        order by relation, direction, id, confidence desc nulls last
    ),
    ranked as (
        select d.*,
               count(*) over (partition by relation, direction) as total,
               row_number() over (partition by relation, direction
                                  order by first_seen desc nulls last, population desc nulls last, name, id) as rn
        from dedup d
    ),
    groups as (
        select relation, direction, min(label) as label, bool_or(causal) as causal, min(ord) as ord,
               max(total) as total,
               jsonb_agg(jsonb_build_object(
                   'id', id, 'name', name, 'type', type, 'subtype', subtype,
                   'is_sample', is_sample, 'confidence', confidence) order by rn)
                   filter (where rn <= p_per) as items
        from ranked
        group by relation, direction
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'relation', relation, 'label', label, 'direction', direction, 'causal', causal,
               'count', total, 'items', coalesce(items, '[]'::jsonb))
           order by total desc, ord, direction desc), '[]'::jsonb)
    from groups
$$;

-- ===========================================================================
-- api.entity({id}) → EntityResponse
-- 0005's, plus `properties` (kg.properties) and `connections`
-- (kg.relations); empty lists while a flag is off. Facts gain "Operator"
-- (the new operates relation). `backlinks` is kept for
-- one release (deprecated: use connections).
-- ===========================================================================
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
        (12, 'Operator', (
            select string_agg(n.name, ', ' order by n.name)
            from edge e join node n on n.id = e.src
            where e.dst = v_id and e.type = 'operates' and (v_sample or not n.is_sample))),
        (13, 'Applies to', case when v_node.type = 'policy' then (
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

    -- Backlinks (deprecated: connections): nodes with an edge pointing here
    -- (stories are the timeline); at most 30 child regions, 60 in all, by
    -- type then name.
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
        'properties', case when api._flag('kg.properties') then api._entity_properties(v_id)
                           else '[]'::jsonb end,
        'connections', case when api._flag('kg.relations') then api._entity_connections(v_id, v_viewer, v_sample)
                            else '[]'::jsonb end,
        'timeline', v_timeline,
        'backlinks', v_backlinks,
        'forecasts', v_forecasts,
        'indicators', v_indicators,
        'graph', v_graph);
end
$$;

-- ===========================================================================
-- api.cascade({id, depth?}) → CascadeResponse
-- 0005's; links also carry relation, polarity (+1 / -1 / null), strength
-- (its own, else its confidence) and delayed (lag_days > 0).
-- ===========================================================================
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
               'relation', cl.relation,
               'polarity', cl.polarity,
               'strength', round(coalesce(cl.strength, cl.confidence)::numeric, 3),
               'delayed', cl.delayed,
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

-- ===========================================================================
-- api.schema({sample?}) → SchemaResponse
-- Both registries with counts: nodes per type; links per relation (edges,
-- plus causal links for causal relations) and per source and target type
-- (by_pair, for the schema map: kg.schema_map). Property definitions are
-- sent while kg.properties is on.
-- ===========================================================================
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

-- ===========================================================================
-- The website's read-only role (0014's pattern) reads the new table.
-- ===========================================================================
grant select on public.relation_type to wg_web_reader;
drop policy if exists web_reader_read on public.relation_type;
create policy web_reader_read on public.relation_type for select to wg_web_reader using (true);
grant execute on all functions in schema api to wg_web_reader;
