-- Undo 0023_kg_provenance: the provenance columns on node, edge and
-- causal_link, evidence for edges and nodes (those rows are deleted), the
-- curated and crowd-forecasts sources, api.provenance and its helpers. The
-- functions 0023 redefined go back to their earlier definitions
-- (api._b_graph_data, api._entity_connections and api.cascade from 0022,
-- api.save_analysis from 0006). Runs before 0022's.

drop function if exists api.provenance(jsonb);
drop function if exists api._added_by(text, timestamptz, text);
drop function if exists api._actor_words(text);
drop function if exists api._story_source(jsonb);

drop trigger if exists edge_touch_updated_at on edge;
drop trigger if exists causal_link_touch_updated_at on causal_link;
drop function if exists public.touch_updated_at();

delete from evidence where causal_link_id is null;
drop index if exists evidence_edge_idx;
drop index if exists evidence_node_idx;
alter table evidence
    drop constraint if exists evidence_one_target,
    drop column if exists edge_id,
    drop column if exists node_id,
    alter column causal_link_id set not null;

alter table causal_link
    drop column if exists updated_at,
    drop column if exists created_by;
alter table edge
    drop column if exists updated_at,
    drop column if exists created_by,
    drop column if exists kind,
    drop column if exists confidence,
    drop column if exists source_id;
alter table node
    drop column if exists created_by,
    drop column if exists kind,
    drop column if exists confidence,
    drop column if exists source_id;

delete from source where id in ('curated', 'crowd-forecasts');

-- ---------------------------------------------------------------------------
-- Earlier definitions
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
begin
    if jsonb_typeof(args -> 'engine') is distinct from 'string' or v_engine not in ('artifact', 'api') then
        raise exception 'engine must be "artifact" or "api"';
    end if;
    if jsonb_typeof(args -> 'model') is distinct from 'string' or v_model = '' or char_length(v_model) > 100 then
        raise exception 'model must name the model (at most 100 characters)';
    end if;
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
            insert into edge (src, dst, type, is_sample)
            select v_id, n.id, 'mentions', v_story_sample
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
                                         confidence, method, model_version, is_sample)
                values (v_src, v_id, v_link ->> 'link_type', btrim(v_link ->> 'mechanism'),
                        v_link ->> 'direction',
                        case when v_story_seen >= v_src_seen
                             then floor(extract(epoch from v_story_seen - v_src_seen) / 86400)::integer end,
                        (v_link ->> 'confidence')::real, 'llm', v_model, v_story_sample)
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

    return jsonb_build_object(
        'saved', v_saved,
        'skipped', v_skipped,
        'rejected', v_rejected,
        'links_saved', v_links_saved);
end
$$;
