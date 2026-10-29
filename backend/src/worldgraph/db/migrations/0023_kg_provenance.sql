-- 0023: knowledge graph upgrade, Phase A3 (sources on everything). See
-- PLAN.md "Phase A".
--
-- Provenance  node and edge gain source_id (→ source), confidence, kind
--     (reported | inferred | projected | conditional | user | ai_suggested),
--     created_by and (edge) updated_at; causal_link gains created_by and
--     updated_at. Backfill: gazetteer regions and their part_of links come
--     from Natural Earth; curated entities and reference links from the new
--     source "WorldGraph curated"; live stories from their feeds (GDELT,
--     USGS, GDACS or the business news feeds), and their mentions from the
--     story's own articles; forecasts from their provider; AI links and the
--     mentions AI analysis added: created_by = 'ai:<model>'; sample rows:
--     the sample source. Then source_id and created_by are NOT NULL, so no
--     row can be saved without them. A writer names them per row, or
--     declares them for its session: created_by defaults to the setting
--     wg.actor and source_id to wg.source (a row with neither is refused).
-- Evidence  evidence rows can back an edge or a node as well as a causal
--     link (edge_id, node_id; exactly one target).
-- Writers  api.save_analysis sets them (mentions: the story's source;
--     created_by 'ai:<model>'); the pipeline and the seed loader set them in
--     Python (same commit).
-- API  new api.provenance({target: node|edge|link, id}) ("Why is this
--     here?"; kg.provenance). Graph links carry the edge's confidence and
--     `weak` (confidence < 0.5, or a causal link without evidence); cascade
--     links carry `weak`; entity connections carry the edge id and `weak`.
--
-- Undo: down/0023_kg_provenance.down.sql.

select set_config('wg.actor', 'migration:0023', true);

-- ===========================================================================
-- Sources
-- ===========================================================================
insert into source (id, name, homepage, licence, attribution) values
    ('curated', 'WorldGraph curated', null, 'Compiled by WorldGraph from public information',
     'Reference entities and links: compiled by WorldGraph from public sources'),
    ('crowd-forecasts', 'Crowd forecast providers', null, 'Each provider''s own terms',
     'Crowd forecasts: each one names its provider')
on conflict (id) do nothing;

-- ===========================================================================
-- Columns
-- ===========================================================================
alter table node
    add column source_id text references source (id),
    add column confidence real check (confidence between 0 and 1),
    add column kind text not null default 'reported'
        check (kind in ('reported', 'inferred', 'projected', 'conditional', 'user', 'ai_suggested')),
    add column created_by text;

alter table edge
    add column source_id text references source (id),
    add column confidence real check (confidence between 0 and 1),
    add column kind text not null default 'reported'
        check (kind in ('reported', 'inferred', 'projected', 'conditional', 'user', 'ai_suggested')),
    add column created_by text,
    add column updated_at timestamptz not null default now();

alter table causal_link
    add column created_by text,
    add column updated_at timestamptz not null default now();

-- ===========================================================================
-- Backfill
-- ===========================================================================

-- A live story's source: the feed its items came from (pipeline props).
create or replace function api._story_source(p_props jsonb) returns text
language sql immutable set search_path = pg_catalog as $$
    select case
        when coalesce(p_props -> 'providers', '[]'::jsonb) ? 'usgs' then 'usgs'
        when coalesce(p_props -> 'providers', '[]'::jsonb) ? 'gdacs' then 'gdacs'
        when coalesce(p_props -> 'providers', '[]'::jsonb) ? 'rss' then 'news-feeds'
        when coalesce(p_props -> 'providers', '[]'::jsonb) ? 'gdelt' then 'gdelt'
        else 'news-feeds'
    end
$$;

update node n set
    source_id = case
        when n.is_sample then 'sample'
        when n.type = 'region' and x.level is distinct from 'bloc' then 'natural-earth'
        when n.type = 'story' then api._story_source(x.story_props)
        when n.type = 'forecast' then coalesce((select src.id from source src where src.id = x.provider),
                                               'crowd-forecasts')
        else 'curated'
    end,
    created_by = case
        when n.is_sample then 'sample'
        when n.type = 'region' and x.level is distinct from 'bloc' then 'gazetteer'
        when n.type = 'story' then 'pipeline:news'
        when n.type = 'forecast' then 'pipeline:forecasts'
        when n.type = 'user_entity' then 'user'
        else 'curated'
    end,
    kind = case
        when x.story_kind = 'projected' then 'projected'
        when n.type = 'user_entity' then 'user'
        else 'reported'
    end
from (
    select n2.id, r.level, s.kind as story_kind, s.props as story_props, f.provider
    from node n2
    left join region r on r.node_id = n2.id
    left join story s on s.node_id = n2.id
    left join forecast f on f.node_id = n2.id
) x
where x.id = n.id;

update edge e set
    source_id = case
        when e.is_sample then 'sample'
        when e.type = 'part_of' and x.src_type = 'region' and x.src_level is distinct from 'bloc' then 'natural-earth'
        when x.src_type in ('story', 'forecast') then x.src_source
        else 'curated'
    end,
    created_by = case
        when e.is_sample then 'sample'
        when e.type = 'part_of' and x.src_type = 'region' and x.src_level is distinct from 'bloc' then 'gazetteer'
        when x.src_type = 'story' and e.type = 'mentions' and x.analysis_engine in ('api', 'artifact')
             and e.created_at = x.analysed_at then 'ai:' || coalesce(x.analysis_model, 'unknown')
        when x.src_type = 'story' then 'pipeline:news'
        when x.src_type = 'forecast' then 'pipeline:forecasts'
        else 'curated'
    end,
    confidence = case when jsonb_typeof(e.props -> 'confidence') = 'number'
                      then least(1, greatest(0, (e.props ->> 'confidence')::real)) end,
    updated_at = e.created_at
from (
    select e2.id, sn.type as src_type, sn.source_id as src_source, r.level as src_level,
           s.analysis_engine, s.analysed_at, s.analysis_model
    from edge e2
    join node sn on sn.id = e2.src
    left join region r on r.node_id = sn.id
    left join story s on s.node_id = sn.id
) x
where x.id = e.id;

update causal_link set
    created_by = case
        when is_sample then 'sample'
        when method = 'llm' then 'ai:' || coalesce(model_version, 'unknown')
        else 'pipeline:' || method
    end,
    updated_at = created_at;

-- From now on: no row without a source and a creator. A writer names them,
-- or declares them for its session (set wg.actor / wg.source).
alter table node
    alter column source_id set not null,
    alter column source_id set default nullif(current_setting('wg.source', true), ''),
    alter column created_by set not null,
    alter column created_by set default nullif(current_setting('wg.actor', true), '');
alter table edge
    alter column source_id set not null,
    alter column source_id set default nullif(current_setting('wg.source', true), ''),
    alter column created_by set not null,
    alter column created_by set default nullif(current_setting('wg.actor', true), '');
alter table causal_link
    alter column created_by set not null,
    alter column created_by set default nullif(current_setting('wg.actor', true), '');

-- updated_at follows real changes to links (nodes: writers set it).
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if new.updated_at is not distinct from old.updated_at and new is distinct from old then
        new.updated_at := now();
    end if;
    return new;
end;
$$;

create trigger edge_touch_updated_at
    before update on edge
    for each row execute function public.touch_updated_at();
create trigger causal_link_touch_updated_at
    before update on causal_link
    for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Evidence for edges and nodes too (exactly one target)
-- ===========================================================================
alter table evidence
    alter column causal_link_id drop not null,
    add column edge_id bigint references edge (id) on delete cascade,
    add column node_id text references node (id) on delete cascade,
    add constraint evidence_one_target check (num_nonnulls(causal_link_id, edge_id, node_id) = 1);
create index evidence_edge_idx on evidence (edge_id) where edge_id is not null;
create index evidence_node_idx on evidence (node_id) where node_id is not null;

-- ===========================================================================
-- Plain words for who added something: "News pipeline · AI analysis · 22 Oct"
-- ===========================================================================
create or replace function api._actor_words(p_actor text) returns text
language sql immutable set search_path = pg_catalog as $$
    select case
        when p_actor is null or p_actor = '' then 'Unknown'
        when p_actor = 'pipeline:news' then 'News pipeline'
        when p_actor = 'pipeline:forecasts' then 'Forecast sync'
        when p_actor like 'pipeline%' then 'Pipeline'
        when p_actor like 'ai:%' then 'AI analysis'
        when p_actor = 'curated' then 'WorldGraph curated'
        when p_actor = 'gazetteer' then 'Natural Earth gazetteer'
        when p_actor = 'sample' then 'Sample data'
        when p_actor = 'seed' then 'Reference data'
        when p_actor = 'user' then 'You'
        when p_actor like 'owner%' then 'Owner correction'
        when p_actor like 'migration%' then 'Data upgrade'
        else initcap(replace(split_part(p_actor, ':', 1), '_', ' '))
    end
$$;

create or replace function api._added_by(p_actor text, p_at timestamptz, p_also text default null) returns text
language sql stable set search_path = pg_catalog as $$
    select concat_ws(' · ',
        api._actor_words(p_actor),
        case when p_also is not null and p_also <> api._actor_words(p_actor) then p_also end,
        to_char(p_at at time zone 'UTC',
                case when date_part('year', p_at at time zone 'UTC') = date_part('year', now() at time zone 'UTC')
                     then 'FMDD Mon' else 'FMDD Mon YYYY' end))
$$;

-- ===========================================================================
-- api.provenance({target: node|edge|link, id}) → ProvenanceResponse
-- "Why is this here?": the sources behind a node, an edge or a causal link
-- (its own evidence; a story's articles; a mention's story articles; a
-- forecast's provider; else the source it came from), with confidence,
-- kind, who added it in plain words, and when. weak: confidence < 0.5 or
-- nothing to cite. Needs kg.provenance.
-- ===========================================================================
create or replace function api.provenance(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_target text := args ->> 'target';
    v_viewer text := api._viewer_country(args);
    v_key text := args ->> 'id';
    v_num bigint;
    v_node public.node%rowtype;
    v_edge public.edge%rowtype;
    v_link public.causal_link%rowtype;
    v_story public.story%rowtype;
    v_src_name text;
    v_dst_name text;
    v_label text;
    v_title text;
    v_sources jsonb := '[]'::jsonb;
    v_source_id text;
    v_conf numeric;
    v_kind text;
    v_created_by text;
    v_created_at timestamptz;
    v_updated_at timestamptz;
    v_sample boolean;
    v_also text;
    v_forecast text;
begin
    if not api._flag('kg.provenance') then
        raise exception 'Provenance is switched off';
    end if;
    if v_target is null or v_target not in ('node', 'edge', 'link') then
        raise exception 'target must be node, edge or link';
    end if;
    if v_key is null or v_key = '' then
        raise exception 'id is required';
    end if;
    if v_target in ('edge', 'link') then
        if v_key !~ '^[0-9]{1,18}$' then
            raise exception 'id must be a number for %', v_target;
        end if;
        v_num := v_key::bigint;
    end if;

    if v_target = 'node' then
        select * into v_node from node where id = v_key;
        if not found or v_node.type = 'user_entity'
           or (v_node.type = 'forecast' and not api._b_forecast_focus_ok(v_key, v_viewer)) then
            raise exception 'Not found: %', v_key;
        end if;
        select * into v_story from story where node_id = v_key;
        v_title := coalesce(v_story.headline, v_node.name);
        v_source_id := v_node.source_id;
        v_conf := coalesce(v_node.confidence, v_story.confidence);
        v_kind := v_node.kind;
        v_created_by := v_node.created_by;
        v_created_at := v_node.created_at;
        v_updated_at := v_node.updated_at;
        v_sample := v_node.is_sample;
        if v_story.analysis_engine in ('api', 'artifact') then
            v_also := 'AI analysis';
        end if;
        select coalesce(jsonb_agg(x.j order by x.ord, x.at desc nulls last, x.id), '[]'::jsonb) into v_sources
        from (
            select 1 as ord, ev.published_at as at, ev.id::text as id,
                   jsonb_build_object('name', ev.source_name, 'url', ev.url, 'snippet', ev.snippet,
                                      'published_at', ev.published_at, 'title', null) as j
            from evidence ev where ev.node_id = v_key
            union all
            select 2, a.published_at, a.id::text,
                   jsonb_build_object('name', a.source_name, 'url', a.url, 'snippet', a.snippet,
                                      'published_at', a.published_at, 'title', a.title)
            from (select * from article a where a.story_id = v_key
                  order by a.published_at desc nulls last, a.id desc limit 8) a
            union all
            select 3, null, f.node_id,
                   jsonb_build_object('name', fp.name, 'url', f.url, 'snippet', null,
                                      'published_at', null, 'title', f.question)
            from forecast f join forecast_provider fp on fp.id = f.provider
            where f.node_id = v_key
        ) x;
    elsif v_target = 'edge' then
        select * into v_edge from edge where id = v_num;
        if not found then
            raise exception 'Not found: edge %', v_num;
        end if;
        select coalesce(sh.headline, n.name) into v_src_name
        from node n left join story sh on sh.node_id = n.id
        where n.id = v_edge.src and n.type <> 'user_entity'
          and (n.type <> 'forecast' or api._b_forecast_focus_ok(n.id, v_viewer));
        select coalesce(sh.headline, n.name) into v_dst_name
        from node n left join story sh on sh.node_id = n.id
        where n.id = v_edge.dst and n.type <> 'user_entity'
          and (n.type <> 'forecast' or api._b_forecast_focus_ok(n.id, v_viewer));
        if v_src_name is null or v_dst_name is null then
            raise exception 'Not found: edge %', v_num;
        end if;
        select rt.label into v_label from relation_type rt where rt.key = v_edge.type;
        v_title := v_src_name || ' ' || lower(coalesce(v_label, v_edge.type)) || ' ' || v_dst_name;
        v_source_id := v_edge.source_id;
        v_conf := v_edge.confidence;
        v_kind := v_edge.kind;
        v_created_by := v_edge.created_by;
        v_created_at := v_edge.created_at;
        v_updated_at := v_edge.updated_at;
        v_sample := v_edge.is_sample;
        select coalesce(jsonb_agg(x.j order by x.ord, x.at desc nulls last, x.id), '[]'::jsonb) into v_sources
        from (
            select 1 as ord, ev.published_at as at, ev.id::text as id,
                   jsonb_build_object('name', ev.source_name, 'url', ev.url, 'snippet', ev.snippet,
                                      'published_at', ev.published_at, 'title', null) as j
            from evidence ev where ev.edge_id = v_num
            union all
            -- a story's links come from its own articles
            select 2, a.published_at, a.id::text,
                   jsonb_build_object('name', a.source_name, 'url', a.url, 'snippet', a.snippet,
                                      'published_at', a.published_at, 'title', a.title)
            from (select * from article a where a.story_id = v_edge.src
                  order by a.published_at desc nulls last, a.id desc limit 5) a
            union all
            select 3, null, f.node_id,
                   jsonb_build_object('name', fp.name, 'url', f.url, 'snippet', null,
                                      'published_at', null, 'title', f.question)
            from forecast f join forecast_provider fp on fp.id = f.provider
            where f.node_id = v_edge.src
        ) x;
    else
        select * into v_link from causal_link where id = v_num;
        if not found or (v_link.forecast_id is not null
                         and not api._b_forecast_ok(v_link.forecast_id, v_viewer, true)) then
            raise exception 'Not found: link %', v_num;
        end if;
        select s.headline into v_src_name from story s where s.node_id = v_link.src_story;
        select s.headline into v_dst_name from story s where s.node_id = v_link.dst_story;
        v_title := v_src_name || ' → ' || v_dst_name;
        v_source_id := null;
        v_conf := v_link.confidence;
        v_kind := v_link.link_type;
        v_created_by := v_link.created_by;
        v_created_at := v_link.created_at;
        v_updated_at := v_link.updated_at;
        v_sample := v_link.is_sample;
        select coalesce(jsonb_agg(jsonb_build_object('name', ev.source_name, 'url', ev.url, 'snippet', ev.snippet,
                                                     'published_at', ev.published_at, 'title', null)
                                  order by ev.published_at desc nulls last, ev.id), '[]'::jsonb)
        into v_sources
        from evidence ev where ev.causal_link_id = v_num;
    end if;

    -- Nothing more specific: the source it came from.
    if jsonb_array_length(v_sources) = 0 and v_source_id is not null then
        select jsonb_build_array(jsonb_build_object('name', src.name, 'url', src.homepage,
                                                    'snippet', src.attribution, 'published_at', null,
                                                    'title', null))
        into v_sources
        from source src where src.id = v_source_id;
    end if;

    return jsonb_build_object(
        'target', v_target,
        'id', case when v_target = 'node' then to_jsonb(v_key) else to_jsonb(v_num) end,
        'title', v_title,
        'sources', coalesce(v_sources, '[]'::jsonb),
        'source', (select jsonb_build_object('id', src.id, 'name', src.name, 'url', src.homepage,
                                             'attribution', src.attribution)
                   from source src where src.id = v_source_id),
        'confidence', round(v_conf, 3),
        'kind', v_kind,
        'added_by', api._added_by(v_created_by, v_created_at, v_also),
        'created_by', v_created_by,
        'created_at', v_created_at,
        'updated_at', coalesce(v_updated_at, v_created_at),
        'is_sample', v_sample,
        'weak', (v_conf is not null and v_conf < 0.5) or coalesce(jsonb_array_length(v_sources), 0) = 0);
end
$$;

-- ===========================================================================
-- Graph data (0022's): links carry the edge's confidence (edges below
-- min_confidence are left out, like causal links) and `weak`: confidence
-- below 0.5, or a causal link with no evidence (kg.provenance; else false).
-- ===========================================================================
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

-- ===========================================================================
-- Connections (0022's): items carry the edge id (for "Why is this here?"),
-- the edge's confidence (else props.confidence) and `weak`.
-- ===========================================================================
create or replace function api._entity_connections(
    p_id text, p_viewer text, p_sample boolean, p_per integer default 12)
returns jsonb
language sql stable set search_path = public, extensions as $$
    with raw as (
        select e.type as relation, 'out' as dir, e.dst as other, e.props, e.id as edge_id, e.confidence
        from edge e where e.src = p_id
        union all
        select e.type, 'in', e.src, e.props, e.id, e.confidence from edge e where e.dst = p_id
    ),
    vis as (
        select r.relation,
               case when rt.symmetric then 'both' else r.dir end as direction,
               case when r.dir = 'out' or rt.symmetric then rt.label else rt.inverse_label end as label,
               rt.causal, rt.ord,
               n.id, coalesce(s.headline, n.name) as name, n.type, n.subtype, n.is_sample,
               s.first_seen, rg.population,
               round(coalesce(r.confidence::numeric,
                              case when jsonb_typeof(r.props -> 'confidence') = 'number'
                                   then (r.props ->> 'confidence')::numeric end), 3) as confidence,
               r.edge_id
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
        order by relation, direction, id, confidence desc nulls last, edge_id
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
                   'is_sample', is_sample, 'confidence', confidence, 'edge_id', edge_id,
                   'weak', confidence < 0.5 and api._flag('kg.provenance')) order by rn)
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
-- api.cascade (0022's): links carry `weak` (kg.provenance).
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
               'weak', api._flag('kg.provenance')
                       and (cl.confidence < 0.5
                            or not exists (select 1 from evidence ev where ev.causal_link_id = cl.id)),
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
-- api.save_analysis (0006's): mentions it adds take the story's source and
-- created_by 'ai:<model>', as do its causal links; wg.actor is 'ai:<model>'
-- while it runs (the change log's actor).
-- ===========================================================================
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
    v_actor text;
    v_prev_actor text := current_setting('wg.actor', true);
begin
    if jsonb_typeof(args -> 'engine') is distinct from 'string' or v_engine not in ('artifact', 'api') then
        raise exception 'engine must be "artifact" or "api"';
    end if;
    if jsonb_typeof(args -> 'model') is distinct from 'string' or v_model = '' or char_length(v_model) > 100 then
        raise exception 'model must name the model (at most 100 characters)';
    end if;
    -- Everything this saves is added by the model (provenance and history).
    v_actor := 'ai:' || v_model;
    perform set_config('wg.actor', v_actor, true);
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
                                with ordinality as x(v, ord) group by x.v order by min(x.ord)),
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
            insert into edge (src, dst, type, is_sample, source_id, created_by)
            select v_id, n.id, 'mentions', v_story_sample,
                   (select sn.source_id from node sn where sn.id = v_id), v_actor
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
                                         confidence, method, model_version, is_sample, created_by)
                values (v_src, v_id, v_link ->> 'link_type', btrim(v_link ->> 'mechanism'),
                        v_link ->> 'direction',
                        case when v_story_seen >= v_src_seen
                             then floor(extract(epoch from v_story_seen - v_src_seen) / 86400)::integer end,
                        (v_link ->> 'confidence')::real, 'llm', v_model, v_story_sample, v_actor)
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

    perform set_config('wg.actor', coalesce(v_prev_actor, ''), true);
    return jsonb_build_object(
        'saved', v_saved,
        'skipped', v_skipped,
        'rejected', v_rejected,
        'links_saved', v_links_saved);
end
$$;

-- ===========================================================================
-- The website's read-only role runs the new functions.
-- ===========================================================================
grant execute on all functions in schema api to wg_web_reader;
