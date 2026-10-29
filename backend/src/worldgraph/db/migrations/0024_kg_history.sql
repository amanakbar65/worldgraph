-- 0024: knowledge graph upgrade, Phase A4 (history and "as of" dates). See
-- PLAN.md "Phase A".
--
-- Change log  history.change_log(id, at, entity, entity_id, op, before,
--     after, actor) records every insert, delete and meaningful update of
--     the live world graph: nodes (a story's node carries its story fields:
--     kind, headline, impact, first_seen, sectors, places…), edges and
--     causal links. Housekeeping changes are skipped (updated_at, a story's
--     importance, counts and embeddings), and so is sample data (its clock
--     slides every 30 minutes and it is removed at launch). `mentions`
--     edges are logged per story and statement, not per row: entity
--     'mentions', entity_id the story, after {"add": [[id, dst, created_at
--     (, extras)], …]}, before {"remove": […]}. The actor is the setting
--     wg.actor (the pipeline sets 'pipeline:<job>', AI analysis
--     'ai:<model>', the seed loader 'seed'), else 'pipeline'.
-- Append-only  update, delete and truncate raise for every role; only
--     history.prune() may delete, and only rows past the retention window
--     (at least 30 days old). The website's role can only read it.
-- Baseline  one 'snapshot' row per live node, edge, causal link and story's
--     mentions, now: history starts here (history.info.started_at), and the
--     API says so for earlier dates.
-- Retention  history.prune(days) keeps `days` (default history.info
--     keep_days = 90): older rows go unless they are an entity's latest
--     state at the cut, so "as of" stays exact inside the window, and
--     history then starts at the cut. history.maybe_prune() (the pipeline's
--     prune job) runs it at most once a day.
-- As of  The graph functions read nodes, stories, edges and causal links
--     through the views api._g_nodes, api._g_stories, api._g_edges and
--     api._g_links: the live tables, or, while the setting wg.as_of is set,
--     the state at that time rebuilt from the log (when WorldGraph knew it)
--     together with edge valid_from / valid_to (when it was true in the
--     world; live graphs now leave out links outside their valid dates too).
--     api.graph_as_of and api.local_graph_as_of take `at` plus the same
--     arguments and share every line with api.graph and api.local_graph.
-- Undo  history.revert(change_id, force) puts one change back (the owner's
--     `wg history revert <change_id>`; world-graph corrections only).
--
-- Undo this migration: down/0024_kg_history.down.sql.

select set_config('wg.actor', 'migration:0024', true);

-- ===========================================================================
-- The log
-- ===========================================================================
create schema if not exists history;

create table history.change_log (
    id         bigint generated always as identity primary key,
    at         timestamptz not null default clock_timestamp(),
    entity     text not null check (entity in ('node', 'edge', 'causal_link', 'mentions')),
    entity_id  text not null,
    op         text not null check (op in ('snapshot', 'insert', 'update', 'delete')),
    before     jsonb,
    after      jsonb,
    actor      text not null default coalesce(nullif(current_setting('wg.actor', true), ''), 'pipeline')
);
create index change_log_entity_idx on history.change_log (entity, entity_id, id);
create index change_log_at_idx on history.change_log (at);

create table history.info (
    id          boolean primary key default true check (id),
    started_at  timestamptz not null,           -- "as of" answers from here on
    keep_days   integer not null default 90 check (keep_days >= 30),
    pruned_at   timestamptz
);

alter table history.change_log enable row level security;
alter table history.info enable row level security;

-- Append-only: no update, delete or truncate, except history.prune()'s
-- deletes of rows past the window.
create or replace function history.change_log_guard() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if tg_op = 'DELETE' then
        if current_setting('wg.history_prune', true) = 'on' and old.at <= now() - interval '30 days' then
            return old;
        end if;
    end if;
    raise exception 'history.change_log is append-only (% refused)', lower(tg_op)
        using errcode = 'insufficient_privilege';
end;
$$;

create trigger change_log_append_only
    before update or delete on history.change_log
    for each row execute function history.change_log_guard();
create trigger change_log_no_truncate
    before truncate on history.change_log
    for each statement execute function history.change_log_guard();

-- ===========================================================================
-- What is logged
-- ===========================================================================

-- A story's fields that matter for the graph and its history.
create or replace function history._story_json(p_story public.story) returns jsonb
language sql immutable set search_path = public, extensions as $$
    select jsonb_strip_nulls(jsonb_build_object(
        'kind', p_story.kind, 'headline', p_story.headline, 'so_what', p_story.so_what,
        'event_type', p_story.event_type, 'impact', p_story.impact, 'direction', p_story.direction,
        'magnitude', p_story.magnitude, 'horizon', p_story.horizon, 'confidence', p_story.confidence,
        'importance', p_story.importance, 'sectors', p_story.sectors, 'primary_region', p_story.primary_region,
        'country_id', p_story.country_id, 'admin1_id', p_story.admin1_id, 'first_seen', p_story.first_seen,
        'analysis_status', p_story.analysis_status, 'analysis_engine', p_story.analysis_engine,
        'analysis_model', p_story.analysis_model))
$$;

-- A node as logged: its columns (not updated_at), plus its story's fields.
create or replace function history._node_json(p_node public.node) returns jsonb
language sql stable set search_path = public, extensions as $$
    select jsonb_strip_nulls(to_jsonb(p_node) - 'updated_at')
           || coalesce((select jsonb_build_object('story', history._story_json(s))
                        from story s where s.node_id = p_node.id), '{}'::jsonb)
$$;

-- One mention in the compact per-story form: [id, dst, created_at] plus an
-- object of anything unusual (confidence, valid dates, props, kind).
create or replace function history._mention_item(
    p_id bigint, p_dst text, p_created_at timestamptz, p_confidence real, p_valid_from date,
    p_valid_to date, p_props jsonb, p_kind text)
returns jsonb
language sql immutable set search_path = pg_catalog as $$
    select case when x = '{}'::jsonb then jsonb_build_array(p_id, p_dst, p_created_at)
                else jsonb_build_array(p_id, p_dst, p_created_at, x) end
    from (select jsonb_strip_nulls(jsonb_build_object(
              'confidence', p_confidence, 'valid_from', p_valid_from, 'valid_to', p_valid_to,
              'props', nullif(p_props, '{}'::jsonb), 'kind', nullif(p_kind, 'reported'))) as x) e
$$;

-- An update's `before` keeps only what changed (old values; null for a key
-- the update added), one level deep into a story's fields: the previous
-- state is after || before. `after` is always the whole state.
create or replace function history._changed(p_old jsonb, p_new jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
    v_out jsonb;
    v_story jsonb;
begin
    select coalesce(jsonb_object_agg(x.k, p_old -> x.k), '{}'::jsonb) into v_out
    from (select jsonb_object_keys(p_old) as k union select jsonb_object_keys(p_new)) x
    where x.k <> 'story' and (p_old -> x.k) is distinct from (p_new -> x.k);
    if (p_old -> 'story') is distinct from (p_new -> 'story') then
        if jsonb_typeof(p_old -> 'story') = 'object' and jsonb_typeof(p_new -> 'story') = 'object' then
            select coalesce(jsonb_object_agg(x.k, p_old -> 'story' -> x.k), '{}'::jsonb) into v_story
            from (select jsonb_object_keys(p_old -> 'story') as k
                  union select jsonb_object_keys(p_new -> 'story')) x
            where (p_old -> 'story' -> x.k) is distinct from (p_new -> 'story' -> x.k);
        else
            v_story := coalesce(p_old -> 'story', 'null'::jsonb);
        end if;
        v_out := v_out || jsonb_build_object('story', v_story);
    end if;
    return v_out;
end
$$;

-- The state before an update: its after, with its before laid over.
create or replace function history._previous(p_after jsonb, p_before jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
    select jsonb_strip_nulls(coalesce(p_after, '{}'::jsonb) || coalesce(p_before, '{}'::jsonb)
           || case when p_after ? 'story' or p_before ? 'story'
                   then jsonb_build_object('story', coalesce(p_after -> 'story', '{}'::jsonb)
                                                    || coalesce(p_before -> 'story', '{}'::jsonb))
                   else '{}'::jsonb end)
$$;

create or replace function history.log_node() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if tg_op = 'INSERT' then
        insert into history.change_log (entity, entity_id, op, after)
        values ('node', new.id, 'insert', history._node_json(new));
    elsif tg_op = 'DELETE' then
        -- (a deleted story can't be restored: its type and name are enough)
        insert into history.change_log (entity, entity_id, op, before)
        values ('node', old.id, 'delete',
                case when old.type = 'story' then jsonb_build_object('type', old.type, 'name', old.name)
                     else jsonb_strip_nulls(to_jsonb(old) - 'updated_at') end);
    elsif new.is_sample then
        -- became sample data: gone from the live graph
        insert into history.change_log (entity, entity_id, op, before)
        values ('node', old.id, 'delete', history._node_json(old));
    elsif old.is_sample then
        insert into history.change_log (entity, entity_id, op, after)
        values ('node', new.id, 'insert', history._node_json(new));
    -- (a story's name follows its headline, which the story's row logs)
    elsif (to_jsonb(old) - 'updated_at' - case when new.type = 'story' then 'name' else '' end)
          is distinct from (to_jsonb(new) - 'updated_at' - case when new.type = 'story' then 'name' else '' end) then
        insert into history.change_log (entity, entity_id, op, before, after)
        select 'node', new.id, 'update', history._changed(o.j, n.j), n.j
        from (select history._node_json(old) as j) o, (select history._node_json(new) as j) n;
    end if;
    return null;
end;
$$;

-- Story nodes are logged when their story row arrives (the pipeline writes
-- the node first) and when its fields change.
create trigger node_history_insert
    after insert on node
    for each row when (not new.is_sample and new.type <> 'story')
    execute function history.log_node();
create trigger node_history_update
    after update on node
    for each row when (not old.is_sample or not new.is_sample)
    execute function history.log_node();
create trigger node_history_delete
    after delete on node
    for each row when (not old.is_sample)
    execute function history.log_node();

create or replace function history.log_story() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_node public.node%rowtype;
begin
    select * into v_node from node where id = new.node_id;
    if not found or v_node.is_sample then
        return null;
    end if;
    if tg_op = 'INSERT' then
        insert into history.change_log (entity, entity_id, op, after)
        values ('node', new.node_id, 'insert', history._node_json(v_node));
    elsif (history._story_json(old) - 'importance') is distinct from (history._story_json(new) - 'importance') then
        insert into history.change_log (entity, entity_id, op, before, after)
        select 'node', new.node_id, 'update', history._changed(o.j, n.j), n.j
        from (select jsonb_strip_nulls(to_jsonb(v_node) - 'updated_at')
                     || jsonb_build_object('story', history._story_json(old)) as j) o,
             (select history._node_json(v_node) as j) n;
    end if;
    return null;
end;
$$;

create trigger story_history_insert
    after insert on story
    for each row execute function history.log_story();
create trigger story_history_update
    after update of kind, headline, so_what, event_type, impact, direction, magnitude, horizon, confidence,
                    sectors, primary_region, country_id, admin1_id, first_seen, analysis_status,
                    analysis_engine, analysis_model
    on story
    for each row execute function history.log_story();

-- Edges other than mentions: one row each.
create or replace function history.log_edge() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_old_live boolean;
    v_new_live boolean;
begin
    if tg_op = 'INSERT' then
        insert into history.change_log (entity, entity_id, op, after)
        values ('edge', new.id::text, 'insert', jsonb_strip_nulls(to_jsonb(new) - 'updated_at'));
    elsif tg_op = 'DELETE' then
        insert into history.change_log (entity, entity_id, op, before)
        values ('edge', old.id::text, 'delete', jsonb_strip_nulls(to_jsonb(old) - 'updated_at'));
    else
        v_old_live := not old.is_sample and old.type <> 'mentions';
        v_new_live := not new.is_sample and new.type <> 'mentions';
        if v_old_live and v_new_live
           and (to_jsonb(old) - 'updated_at') is not distinct from (to_jsonb(new) - 'updated_at') then
            return null;
        end if;
        insert into history.change_log (entity, entity_id, op, before, after)
        values ('edge', new.id::text,
                case when not v_new_live then 'delete' when not v_old_live then 'insert' else 'update' end,
                case when not v_old_live then null
                     when not v_new_live then jsonb_strip_nulls(to_jsonb(old) - 'updated_at')
                     else history._changed(jsonb_strip_nulls(to_jsonb(old) - 'updated_at'),
                                           jsonb_strip_nulls(to_jsonb(new) - 'updated_at')) end,
                case when v_new_live then jsonb_strip_nulls(to_jsonb(new) - 'updated_at') end);
    end if;
    return null;
end;
$$;

create trigger edge_history_insert
    after insert on edge
    for each row when (not new.is_sample and new.type <> 'mentions')
    execute function history.log_edge();
create trigger edge_history_update
    after update on edge
    for each row when ((not old.is_sample and old.type <> 'mentions') or (not new.is_sample and new.type <> 'mentions'))
    execute function history.log_edge();
create trigger edge_history_delete
    after delete on edge
    for each row when (not old.is_sample and old.type <> 'mentions')
    execute function history.log_edge();

-- Mentions: one row per story and statement.
create or replace function history.log_mentions() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if tg_op = 'INSERT' then
        insert into history.change_log (entity, entity_id, op, after)
        select 'mentions', n.src, 'insert',
               jsonb_build_object('add', jsonb_agg(history._mention_item(
                   n.id, n.dst, n.created_at, n.confidence, n.valid_from, n.valid_to, n.props, n.kind) order by n.id))
        from new_rows n
        where n.type = 'mentions' and not n.is_sample
        group by n.src;
    elsif tg_op = 'DELETE' then
        -- When the story itself was deleted, only the ids (nothing to restore).
        insert into history.change_log (entity, entity_id, op, before)
        select 'mentions', o.src, 'delete',
               jsonb_build_object('remove', case
                   when exists (select 1 from node sn where sn.id = o.src)
                   then jsonb_agg(history._mention_item(o.id, o.dst, o.created_at, o.confidence, o.valid_from,
                                                        o.valid_to, o.props, o.kind) order by o.id)
                   else jsonb_agg(jsonb_build_array(o.id) order by o.id) end)
        from old_rows o
        where o.type = 'mentions' and not o.is_sample
        group by o.src;
    else
        with changed as (
            select o.id, o.src as o_src, o.dst as o_dst, o.created_at as o_created_at, o.confidence as o_conf,
                   o.valid_from as o_from, o.valid_to as o_to, o.props as o_props, o.kind as o_kind,
                   o.type = 'mentions' and not o.is_sample as o_live,
                   n.src as n_src, n.dst as n_dst, n.created_at as n_created_at, n.confidence as n_conf,
                   n.valid_from as n_from, n.valid_to as n_to, n.props as n_props, n.kind as n_kind,
                   n.type = 'mentions' and not n.is_sample as n_live
            from old_rows o join new_rows n on n.id = o.id
            where (o.type = 'mentions' and not o.is_sample) or (n.type = 'mentions' and not n.is_sample)
        ),
        moved as (
            select * from changed c
            where not (c.o_live and c.n_live)
               or (c.o_src, c.o_dst, c.o_created_at, c.o_conf, c.o_from, c.o_to, c.o_props, c.o_kind)
                  is distinct from (c.n_src, c.n_dst, c.n_created_at, c.n_conf, c.n_from, c.n_to, c.n_props, c.n_kind)
        ),
        removed as (
            select m.o_src as src, jsonb_agg(history._mention_item(
                       m.id, m.o_dst, m.o_created_at, m.o_conf, m.o_from, m.o_to, m.o_props, m.o_kind) order by m.id)
                       as items
            from moved m where m.o_live group by m.o_src
        ),
        added as (
            select m.n_src as src, jsonb_agg(history._mention_item(
                       m.id, m.n_dst, m.n_created_at, m.n_conf, m.n_from, m.n_to, m.n_props, m.n_kind) order by m.id)
                       as items
            from moved m where m.n_live group by m.n_src
        )
        insert into history.change_log (entity, entity_id, op, before, after)
        select 'mentions', coalesce(a.src, r.src),
               case when r.src is null then 'insert' when a.src is null then 'delete' else 'update' end,
               case when r.src is not null then jsonb_build_object('remove', r.items) end,
               case when a.src is not null then jsonb_build_object('add', a.items) end
        from added a full join removed r on r.src = a.src;
    end if;
    return null;
end;
$$;

create trigger edge_history_mentions_insert
    after insert on edge
    referencing new table as new_rows
    for each statement execute function history.log_mentions();
create trigger edge_history_mentions_update
    after update on edge
    referencing old table as old_rows new table as new_rows
    for each statement execute function history.log_mentions();
create trigger edge_history_mentions_delete
    after delete on edge
    referencing old table as old_rows
    for each statement execute function history.log_mentions();

create or replace function history.log_link() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    if tg_op = 'INSERT' then
        insert into history.change_log (entity, entity_id, op, after)
        values ('causal_link', new.id::text, 'insert', jsonb_strip_nulls(to_jsonb(new) - 'updated_at'));
    elsif tg_op = 'DELETE' then
        insert into history.change_log (entity, entity_id, op, before)
        values ('causal_link', old.id::text, 'delete', jsonb_strip_nulls(to_jsonb(old) - 'updated_at'));
    elsif new.is_sample then
        insert into history.change_log (entity, entity_id, op, before)
        values ('causal_link', old.id::text, 'delete', jsonb_strip_nulls(to_jsonb(old) - 'updated_at'));
    elsif old.is_sample then
        insert into history.change_log (entity, entity_id, op, after)
        values ('causal_link', new.id::text, 'insert', jsonb_strip_nulls(to_jsonb(new) - 'updated_at'));
    elsif (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
        insert into history.change_log (entity, entity_id, op, before, after)
        values ('causal_link', new.id::text, 'update',
                history._changed(jsonb_strip_nulls(to_jsonb(old) - 'updated_at'),
                                 jsonb_strip_nulls(to_jsonb(new) - 'updated_at')),
                jsonb_strip_nulls(to_jsonb(new) - 'updated_at'));
    end if;
    return null;
end;
$$;

create trigger causal_link_history_insert
    after insert on causal_link
    for each row when (not new.is_sample)
    execute function history.log_link();
create trigger causal_link_history_update
    after update on causal_link
    for each row when (not old.is_sample or not new.is_sample)
    execute function history.log_link();
create trigger causal_link_history_delete
    after delete on causal_link
    for each row when (not old.is_sample)
    execute function history.log_link();

-- ===========================================================================
-- Baseline: history starts now
-- ===========================================================================
insert into history.info (started_at, keep_days) values (clock_timestamp(), 90);

insert into history.change_log (at, entity, entity_id, op, after)
select i.started_at, 'node', n.id, 'snapshot', history._node_json(n)
from node n cross join history.info i
where not n.is_sample;

insert into history.change_log (at, entity, entity_id, op, after)
select i.started_at, 'edge', e.id::text, 'snapshot', jsonb_strip_nulls(to_jsonb(e) - 'updated_at')
from edge e cross join history.info i
where not e.is_sample and e.type <> 'mentions';

insert into history.change_log (at, entity, entity_id, op, after)
select i.started_at, 'mentions', e.src, 'snapshot',
       jsonb_build_object('add', jsonb_agg(history._mention_item(
           e.id, e.dst, e.created_at, e.confidence, e.valid_from, e.valid_to, e.props, e.kind) order by e.id))
from edge e cross join history.info i
where not e.is_sample and e.type = 'mentions'
group by e.src, i.started_at;

insert into history.change_log (at, entity, entity_id, op, after)
select i.started_at, 'causal_link', cl.id::text, 'snapshot', jsonb_strip_nulls(to_jsonb(cl) - 'updated_at')
from causal_link cl cross join history.info i
where not cl.is_sample;

-- ===========================================================================
-- State at a time: the latest row of each entity at or before wg.as_of
-- (ordered by id, the order the changes were made in)
-- ===========================================================================
create view history.node_state with (security_invoker = true) as
select distinct on (c.entity_id) c.entity_id as id, c.op, c.after
from history.change_log c
where c.entity = 'node'
  and c.at <= nullif(current_setting('wg.as_of', true), '')::timestamptz
order by c.entity_id, c.id desc;

create view history.edge_state with (security_invoker = true) as
select distinct on (c.entity_id) c.entity_id as id, c.op, c.after
from history.change_log c
where c.entity = 'edge'
  and c.at <= nullif(current_setting('wg.as_of', true), '')::timestamptz
order by c.entity_id, c.id desc;

create view history.link_state with (security_invoker = true) as
select distinct on (c.entity_id) c.entity_id as id, c.op, c.after
from history.change_log c
where c.entity = 'causal_link'
  and c.at <= nullif(current_setting('wg.as_of', true), '')::timestamptz
order by c.entity_id, c.id desc;

-- Mentions at wg.as_of: added, and not removed by a later row.
create view history.mention_state with (security_invoker = true) as
select (a.item ->> 0)::bigint as id, c.entity_id as src, a.item ->> 1 as dst,
       (a.item ->> 2)::timestamptz as created_at, a.item -> 3 as extra
from history.change_log c
cross join lateral jsonb_array_elements(c.after -> 'add') as a(item)
where c.entity = 'mentions'
  and c.at <= nullif(current_setting('wg.as_of', true), '')::timestamptz
  and not exists (
      select 1
      from history.change_log r
      cross join lateral jsonb_array_elements(r.before -> 'remove') as x(item)
      where r.entity = 'mentions' and r.entity_id = c.entity_id and r.id > c.id
        and r.at <= nullif(current_setting('wg.as_of', true), '')::timestamptz
        and x.item ->> 0 = a.item ->> 0);

-- ===========================================================================
-- What the graph functions read: the live tables, or the state at wg.as_of
-- ===========================================================================

-- "Now" for the graph: wg.as_of while it is set.
create or replace function api._g_now() returns timestamptz
language sql stable set search_path = pg_catalog as $$
    select coalesce(nullif(current_setting('wg.as_of', true), '')::timestamptz, now())
$$;

-- Each view is a UNION ALL of the live table and the rebuilt state, with a
-- flag column picked by the outer WHERE: the legs themselves have no WHERE,
-- so the planner keeps using the tables' indexes for the live graph (a leg
-- with its own WHERE would be planned as a separate subquery).
create view api._g_nodes with (security_invoker = true) as
select u.id, u.type, u.subtype, u.name, u.is_sample, u.created_at
from (
    select n.id, n.type, n.subtype, n.name, n.is_sample, n.created_at, false as as_of
    from public.node n
    union all
    select s.id, s.after ->> 'type', s.after ->> 'subtype', s.after ->> 'name', false,
           (s.after ->> 'created_at')::timestamptz, true
    from history.node_state s
    where s.op <> 'delete'
) u
where u.as_of = (nullif(current_setting('wg.as_of', true), '') is not null);

create view api._g_stories with (security_invoker = true) as
select u.node_id, u.kind, u.headline, u.impact, u.first_seen, u.sectors, u.primary_region, u.country_id,
       u.admin1_id, u.importance
from (
    select s.node_id, s.kind, s.headline, s.impact, s.first_seen, s.sectors, s.primary_region, s.country_id,
           s.admin1_id, s.importance, false as as_of
    from public.story s
    union all
    select h.id, h.after -> 'story' ->> 'kind', h.after -> 'story' ->> 'headline',
           h.after -> 'story' ->> 'impact', (h.after -> 'story' ->> 'first_seen')::timestamptz,
           array(select jsonb_array_elements_text(coalesce(h.after -> 'story' -> 'sectors', '[]'::jsonb))),
           h.after -> 'story' ->> 'primary_region', h.after -> 'story' ->> 'country_id',
           h.after -> 'story' ->> 'admin1_id', coalesce((h.after -> 'story' ->> 'importance')::real, 0), true
    from history.node_state h
    where h.op <> 'delete' and h.after ? 'story'
) u
where u.as_of = (nullif(current_setting('wg.as_of', true), '') is not null);

-- Links valid on the day (valid_from / valid_to, when set).
create view api._g_edges with (security_invoker = true) as
select u.id, u.src, u.dst, u.type, u.is_sample, u.created_at, u.confidence
from (
    select e.id, e.src, e.dst, e.type, e.is_sample, e.created_at, e.confidence, e.valid_from, e.valid_to,
           false as as_of
    from public.edge e
    union all
    select s.id::bigint, s.after ->> 'src', s.after ->> 'dst', s.after ->> 'type', false,
           (s.after ->> 'created_at')::timestamptz, (s.after ->> 'confidence')::real,
           (s.after ->> 'valid_from')::date, (s.after ->> 'valid_to')::date, true
    from history.edge_state s
    where s.op <> 'delete'
    union all
    select m.id, m.src, m.dst, 'mentions', false, m.created_at, (m.extra ->> 'confidence')::real,
           (m.extra ->> 'valid_from')::date, (m.extra ->> 'valid_to')::date, true
    from history.mention_state m
) u
where u.as_of = (nullif(current_setting('wg.as_of', true), '') is not null)
  and (u.valid_from is null
       or u.valid_from <= (coalesce(nullif(current_setting('wg.as_of', true), '')::timestamptz, now())
                           at time zone 'UTC')::date)
  and (u.valid_to is null
       or u.valid_to >= (coalesce(nullif(current_setting('wg.as_of', true), '')::timestamptz, now())
                         at time zone 'UTC')::date);

create view api._g_links with (security_invoker = true) as
select u.id, u.src_story, u.dst_story, u.link_type, u.confidence, u.forecast_id, u.relation, u.polarity,
       u.strength, u.delayed, u.created_at, u.is_sample
from (
    select cl.id, cl.src_story, cl.dst_story, cl.link_type, cl.confidence, cl.forecast_id, cl.relation,
           cl.polarity, cl.strength, cl.delayed, cl.created_at, cl.is_sample, false as as_of
    from public.causal_link cl
    union all
    select s.id::bigint, s.after ->> 'src_story', s.after ->> 'dst_story', s.after ->> 'link_type',
           (s.after ->> 'confidence')::real, s.after ->> 'forecast_id', coalesce(s.after ->> 'relation', 'drives'),
           (s.after ->> 'polarity')::smallint, (s.after ->> 'strength')::real, (s.after ->> 'delayed')::boolean,
           (s.after ->> 'created_at')::timestamptz, false, true
    from history.link_state s
    where s.op <> 'delete'
) u
where u.as_of = (nullif(current_setting('wg.as_of', true), '') is not null);

-- ===========================================================================
-- Retention
-- ===========================================================================
create or replace function history.prune(p_days integer default null) returns jsonb
language plpgsql volatile
set search_path = public, extensions
as $$
declare
    v_days integer := coalesce(p_days, (select i.keep_days from history.info i), 90);
    v_cut timestamptz;
    v_rows bigint := 0;
    v_mentions bigint := 0;
begin
    if v_days < 30 then
        raise exception 'History keeps at least 30 days';
    end if;
    v_cut := now() - make_interval(days => v_days);
    perform set_config('wg.history_prune', 'on', true);
    -- Nodes, edges and causal links: older rows go, except each one's
    -- latest state at the cut (unless that is a delete).
    with latest as (
        select distinct on (c.entity, c.entity_id) c.entity, c.entity_id, c.id, c.op
        from history.change_log c
        where c.entity <> 'mentions' and c.at <= v_cut
        order by c.entity, c.entity_id, c.id desc
    )
    delete from history.change_log c
    using latest l
    where c.entity = l.entity and c.entity_id = l.entity_id and c.at <= v_cut
      and (c.id < l.id or l.op = 'delete');
    get diagnostics v_rows = row_count;
    -- Mentions: a story's rows go once none of its mentions is left at the cut.
    perform set_config('wg.as_of', to_char(v_cut at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true);
    delete from history.change_log c
    where c.entity = 'mentions' and c.at <= v_cut
      and not exists (select 1 from history.mention_state m where m.src = c.entity_id);
    get diagnostics v_mentions = row_count;
    perform set_config('wg.as_of', '', true);
    perform set_config('wg.history_prune', '', true);
    update history.info set started_at = greatest(started_at, v_cut), pruned_at = now();
    return jsonb_build_object('deleted', v_rows + v_mentions, 'cut', v_cut, 'keep_days', v_days);
end
$$;

-- For the pipeline's prune job: prune at most once a day, and only when
-- something is past the window (a cheap index check).
create or replace function history.maybe_prune() returns jsonb
language plpgsql volatile
set search_path = public, extensions
as $$
declare
    v_info history.info%rowtype;
begin
    select * into v_info from history.info;
    if v_info.pruned_at > now() - interval '20 hours' then
        return jsonb_build_object('pruned', false);
    end if;
    if not exists (select 1 from history.change_log c
                   where c.at < now() - make_interval(days => v_info.keep_days)) then
        update history.info set pruned_at = now();
        return jsonb_build_object('pruned', false);
    end if;
    return history.prune(v_info.keep_days) || jsonb_build_object('pruned', true);
end
$$;

-- ===========================================================================
-- Undo one change (the owner's world-graph corrections: wg history revert)
-- ===========================================================================
create or replace function history.revert(p_change_id bigint, p_force boolean default false) returns jsonb
language plpgsql volatile
set search_path = public, extensions
as $$
declare
    c history.change_log%rowtype;
    v_actor text := 'owner:revert:' || p_change_id;
    v_prev_actor text := current_setting('wg.actor', true);
    v_count bigint := 0;
    v_more bigint := 0;
begin
    select * into c from history.change_log where id = p_change_id;
    if not found then
        raise exception 'No change %', p_change_id;
    end if;
    if c.op = 'snapshot' then
        raise exception 'Change % is where history starts: there is nothing to undo', p_change_id;
    end if;
    if c.entity <> 'mentions' and not p_force and exists (
        select 1 from history.change_log l
        where l.entity = c.entity and l.entity_id = c.entity_id and l.id > c.id) then
        raise exception 'A later change touched % %: undo that one first (or force)', c.entity, c.entity_id;
    end if;
    perform set_config('wg.actor', v_actor, true);

    if c.entity = 'node' then
        if c.op = 'insert' then
            delete from node where id = c.entity_id;
            get diagnostics v_count = row_count;
        elsif c.op = 'delete' then
            if c.before ->> 'type' = 'story' then
                raise exception 'Stories cannot be restored (their articles are gone); the pipeline finds them again';
            end if;
            insert into node (id, type, subtype, name, aliases, summary, qid, props, properties, geom, is_sample,
                              created_at, updated_at, source_id, confidence, kind, created_by)
            select r.id, r.type, r.subtype, r.name, coalesce(r.aliases, '{}'), r.summary, r.qid,
                   coalesce(r.props, '{}'), coalesce(r.properties, '{}'), r.geom, false, r.created_at, now(),
                   r.source_id, r.confidence, coalesce(r.kind, 'reported'), r.created_by
            from jsonb_populate_record(null::public.node, c.before) r
            on conflict (id) do nothing;
            get diagnostics v_count = row_count;
        else
            update node n set subtype = r.subtype, name = r.name, aliases = coalesce(r.aliases, '{}'),
                              summary = r.summary, qid = r.qid, props = coalesce(r.props, '{}'),
                              properties = coalesce(r.properties, '{}'), source_id = r.source_id,
                              confidence = r.confidence, kind = coalesce(r.kind, 'reported'), updated_at = now()
            from jsonb_populate_record(null::public.node, history._previous(c.after, c.before) - 'story') r
            where n.id = c.entity_id;
            get diagnostics v_count = row_count;
            if c.before ? 'story' then
                update story s set kind = r.kind, headline = r.headline, so_what = r.so_what,
                                   event_type = r.event_type, impact = r.impact, direction = r.direction,
                                   magnitude = r.magnitude, horizon = r.horizon, confidence = r.confidence,
                                   sectors = coalesce(r.sectors, '{}'), primary_region = r.primary_region,
                                   country_id = r.country_id, admin1_id = r.admin1_id, first_seen = r.first_seen,
                                   analysis_status = r.analysis_status, analysis_engine = r.analysis_engine,
                                   analysis_model = r.analysis_model
                from jsonb_populate_record(null::public.story, history._previous(c.after, c.before) -> 'story') r
                where s.node_id = c.entity_id;
                get diagnostics v_more = row_count;
                v_count := v_count + v_more;
            end if;
        end if;
    elsif c.entity = 'edge' then
        if c.op = 'insert' then
            delete from edge where id = c.entity_id::bigint;
            get diagnostics v_count = row_count;
        elsif c.op = 'delete' then
            insert into edge (id, src, dst, type, props, valid_from, valid_to, is_sample, created_at, updated_at,
                              source_id, confidence, kind, created_by)
            overriding system value
            select r.id, r.src, r.dst, r.type, coalesce(r.props, '{}'), r.valid_from, r.valid_to, false,
                   r.created_at, now(), r.source_id, r.confidence, coalesce(r.kind, 'reported'), r.created_by
            from jsonb_populate_record(null::public.edge, c.before) r
            where exists (select 1 from node n where n.id = r.src) and exists (select 1 from node n where n.id = r.dst)
            on conflict do nothing;
            get diagnostics v_count = row_count;
        else
            update edge e set src = r.src, dst = r.dst, type = r.type, props = coalesce(r.props, '{}'),
                              valid_from = r.valid_from, valid_to = r.valid_to, source_id = r.source_id,
                              confidence = r.confidence, kind = coalesce(r.kind, 'reported')
            from jsonb_populate_record(null::public.edge, history._previous(c.after, c.before)) r
            where e.id = c.entity_id::bigint;
            get diagnostics v_count = row_count;
        end if;
    elsif c.entity = 'causal_link' then
        if c.op = 'insert' then
            delete from causal_link where id = c.entity_id::bigint;
            get diagnostics v_count = row_count;
        elsif c.op = 'delete' then
            insert into causal_link (id, src_story, dst_story, link_type, mechanism, direction, lag_days,
                                     confidence, forecast_id, outcome, method, model_version, is_sample,
                                     created_at, updated_at, relation, polarity, strength, created_by)
            overriding system value
            select r.id, r.src_story, r.dst_story, r.link_type, r.mechanism, r.direction, r.lag_days,
                   r.confidence, r.forecast_id, r.outcome, r.method, r.model_version, false, r.created_at, now(),
                   coalesce(r.relation, 'drives'), r.polarity, r.strength, r.created_by
            from jsonb_populate_record(null::public.causal_link, c.before) r
            where exists (select 1 from story s where s.node_id = r.src_story)
              and exists (select 1 from story s where s.node_id = r.dst_story)
            on conflict do nothing;
            get diagnostics v_count = row_count;
        else
            update causal_link cl set link_type = r.link_type, mechanism = r.mechanism, direction = r.direction,
                                      lag_days = r.lag_days, confidence = r.confidence, relation = r.relation,
                                      polarity = r.polarity, strength = r.strength
            from jsonb_populate_record(null::public.causal_link, history._previous(c.after, c.before)) r
            where cl.id = c.entity_id::bigint;
            get diagnostics v_count = row_count;
        end if;
    else
        -- mentions: take back what was added, put back what was removed
        delete from edge e
        where e.type = 'mentions' and e.src = c.entity_id
          and e.id in (select (x.item ->> 0)::bigint
                       from jsonb_array_elements(coalesce(c.after -> 'add', '[]'::jsonb)) as x(item));
        get diagnostics v_count = row_count;
        insert into edge (id, src, dst, type, props, valid_from, valid_to, created_at, source_id, confidence,
                          kind, created_by)
        overriding system value
        select (x.item ->> 0)::bigint, c.entity_id, x.item ->> 1, 'mentions',
               coalesce(x.item -> 3 -> 'props', '{}'::jsonb), (x.item -> 3 ->> 'valid_from')::date,
               (x.item -> 3 ->> 'valid_to')::date, (x.item ->> 2)::timestamptz, sn.source_id,
               (x.item -> 3 ->> 'confidence')::real, coalesce(x.item -> 3 ->> 'kind', 'reported'), v_actor
        from jsonb_array_elements(coalesce(c.before -> 'remove', '[]'::jsonb)) as x(item)
        join node sn on sn.id = c.entity_id
        join node dn on dn.id = x.item ->> 1
        on conflict do nothing;
        get diagnostics v_more = row_count;
        v_count := v_count + v_more;
    end if;
    perform set_config('wg.actor', coalesce(v_prev_actor, ''), true);
    return jsonb_build_object('reverted', p_change_id, 'entity', c.entity, 'entity_id', c.entity_id,
                              'op', c.op, 'rows', v_count, 'actor', v_actor);
end
$$;

-- ===========================================================================
-- Graph data (0023's), reading through the views: the live graph, or the
-- graph as of wg.as_of. The graph functions are plpgsql with custom plans
-- every call (plan_cache_mode), so a plan made for the live graph is never
-- reused for "as of" (the planner reads wg.as_of when it estimates rows),
-- and without JIT (the views' estimates are rough).
-- ===========================================================================
create or replace function api._b_graph_data(
    p_ids text[], p_viewer text, p_sample boolean,
    p_min_conf numeric default 0, p_drop_isolated boolean default false,
    p_relations text[] default null, p_focus text default null, p_direction text default 'both')
returns jsonb
language plpgsql stable set search_path = public, extensions set jit = off set plan_cache_mode = force_custom_plan as $$
begin
    return (
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
            from api._g_edges e
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
                   -- (as of a past time, a link deleted since has lost its evidence: confidence only)
                   cl.confidence < 0.5
                   or (not exists (select 1 from evidence ev where ev.causal_link_id = cl.id)
                       and exists (select 1 from causal_link x where x.id = cl.id)) as weak
            from api._g_links cl
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
            join api._g_nodes n on n.id = i.id
            left join api._g_stories s on s.node_id = n.id
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
    );
end
$$;

-- ===========================================================================
-- A region's most active child regions (0005's), through the views.
-- ===========================================================================
create or replace function api._b_top_children(p_parents text[], p_per integer)
returns table (child text, parent text)
language plpgsql stable set search_path = public, extensions set jit = off set plan_cache_mode = force_custom_plan as $$
begin
    return query
    with kids as (
        select e.src as child, e.dst as parent
        from api._g_edges e
        where e.dst = any(p_parents) and e.type = 'part_of'
    ),
    located as (
        select s.node_id, s.admin1_id, s.primary_region
        from api._g_stories s
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
    select ranked.child, ranked.parent from ranked where ranked.rn <= p_per;
end
$$;

-- ===========================================================================
-- Neighbourhood ids (0022's), through the views.
-- ===========================================================================
create or replace function api._b_local_ids(
    p_focus text, p_depth integer, p_limit integer, p_viewer text, p_sample boolean,
    p_relations text[] default null, p_direction text default 'both',
    out ids text[], out truncated boolean)
language plpgsql stable set search_path = public, extensions set jit = off set plan_cache_mode = force_custom_plan as $$
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
            from api._g_nodes n
            where n.id = any(v_frontier) and (n.type <> 'sector' or n.id = p_focus)
        ),
        nb(id, via) as (
            select e.dst, e.src
            from api._g_edges e join expand x on x.id = e.src join relation_type rt on rt.key = e.type
            where (v_out or rt.symmetric) and (p_relations is null or e.type = any(p_relations))
            union all
            select e.src, e.dst
            from api._g_edges e join expand x on x.id = e.dst join relation_type rt on rt.key = e.type
            where e.type <> 'part_of'
              and (v_in or rt.symmetric) and (p_relations is null or e.type = any(p_relations))
            union all
            select c.child, c.parent
            from api._b_top_children(array(select id from expand), 12) c
            where v_in and (p_relations is null or 'part_of' = any(p_relations))
            union all
            select cl.dst_story, cl.src_story from api._g_links cl join expand x on x.id = cl.src_story
            where v_out
              and (p_relations is null or cl.relation = any(p_relations))
              and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, p_viewer, p_sample))
            union all
            select cl.src_story, cl.dst_story from api._g_links cl join expand x on x.id = cl.dst_story
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
            join api._g_nodes n on n.id = c.id
            left join api._g_stories s on s.node_id = c.id
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

-- ===========================================================================
-- api.graph (0022's), through the views: links outside their valid dates
-- are left out, and while wg.as_of is set (api.graph_as_of) it is the
-- graph as it was then.
-- ===========================================================================
create or replace function api.graph(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions set jit = off set plan_cache_mode = force_custom_plan as $$
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
            select e.src from api._g_edges e where e.type = 'member_of' and e.dst = any(v_regions)
        ) r;
        select coalesce(array_agg(r.node_id), '{}') into v_blocs
        from region r where r.node_id = any(v_regions) and r.level = 'bloc';
    end if;

    -- Seeds: event stories in the window.
    select coalesce(array_agg(s.node_id), '{}') into v_seeds
    from api._g_stories s
    join api._g_nodes n on n.id = s.node_id
    where s.kind = 'event'
      and s.first_seen >= api._g_now() - v_window
      and (v_sample or not n.is_sample)
      and (v_sectors is null or s.sectors && v_sectors)
      and (v_region_set is null
           or s.country_id = any(v_region_set)
           or s.admin1_id = any(v_region_set)
           or s.primary_region = any(v_region_set)
           or (cardinality(v_blocs) > 0 and exists (
                   select 1 from api._g_edges e
                   where e.src = s.node_id and e.type = 'mentions' and e.dst = any(v_blocs))));

    -- Entities they mention (sectors only when asked for).
    select coalesce(array_agg(distinct e.dst), '{}') into v_entities
    from api._g_edges e
    join api._g_nodes n on n.id = e.dst
    where e.src = any(v_seeds)
      and e.type = 'mentions'
      and n.type not in ('story', 'forecast', 'user_entity')
      and (n.type <> 'sector' or v_with_sectors)
      and (v_sample or not n.is_sample);

    -- Projected stories linked from the seeds.
    select coalesce(array_agg(distinct cl.dst_story), '{}') into v_projected
    from api._g_links cl
    join api._g_stories s on s.node_id = cl.dst_story
    join api._g_nodes n on n.id = cl.dst_story
    where cl.src_story = any(v_seeds)
      and s.kind = 'projected'
      and cl.confidence >= v_min_conf
      and (v_sample or not n.is_sample)
      and (cl.forecast_id is null or api._b_forecast_ok(cl.forecast_id, v_viewer, v_sample));

    v_all := v_seeds || v_entities || v_projected;

    -- Visible forecasts related to or about anything included.
    select coalesce(array_agg(distinct e.src), '{}') into v_forecasts
    from api._g_edges e
    join api._g_nodes n on n.id = e.src
    where e.dst = any(v_all)
      and e.type in ('relates_to', 'about')
      and n.type = 'forecast'
      and api._b_forecast_ok(e.src, v_viewer, v_sample);

    v_all := v_all || v_forecasts;

    if v_types is not null then
        select coalesce(array_agg(n.id), '{}') into v_all
        from api._g_nodes n where n.id = any(v_all) and n.type = any(v_types);
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
            select e.src, e.dst from api._g_edges e
            join ids a on a.id = e.src join ids b on b.id = e.dst
            where v_relations is null or e.type = any(v_relations)
            union all
            select cl.src_story, cl.dst_story from api._g_links cl
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
            left join api._g_stories s on s.node_id = i.id
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
-- api.local_graph (0022's), through the views (see api.graph).
-- ===========================================================================
create or replace function api.local_graph(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions set jit = off set plan_cache_mode = force_custom_plan as $$
declare
    v_id text := args ->> 'id';
    v_depth integer := greatest(1, least(3, api._b_int(args -> 'depth', 1)));
    v_limit integer := greatest(1, least(400, api._b_int(args -> 'limit', 150)));
    v_viewer text := api._viewer_country(args);
    v_types text[] := api._text_array(args -> 'types');
    v_relations text[] := api._text_array(args -> 'relations');
    v_direction text;
    v_conds jsonb;
    v_node record;
    v_sample boolean;
    v_ids text[];
    v_truncated boolean;
begin
    v_direction := api._b_graph_filters(v_relations, args ->> 'direction');
    v_conds := api._b_where(v_types, args -> 'where');
    select n.id, n.type, n.is_sample into v_node from api._g_nodes n where n.id = v_id;
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
        join api._g_nodes n on n.id = u.id
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
-- "As of": api.graph_as_of({at, ...api.graph args}) and
-- api.local_graph_as_of({at, ...api.local_graph args}) → the same responses
-- plus as_of and history_starts. `at` is a time, or a date (the end of that
-- day, UTC); a future time means now. Before history starts: an error
-- "History starts on <date>". Needs kg.history. Sample data has no history.
-- ===========================================================================
create or replace function api._history_at(args jsonb) returns timestamptz
language plpgsql stable set search_path = public, extensions as $$
declare
    v_text text := btrim(args ->> 'at');
    v_at timestamptz;
    v_start timestamptz;
begin
    if not api._flag('kg.history') then
        raise exception 'History is switched off';
    end if;
    if jsonb_typeof(args -> 'at') is distinct from 'string' or v_text = '' then
        raise exception 'at is required: a date (YYYY-MM-DD) or a time';
    end if;
    begin
        if v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
            v_at := ((v_text::date + 1)::timestamp at time zone 'UTC') - interval '1 microsecond';
        else
            v_at := v_text::timestamptz;
        end if;
    exception when others then
        raise exception 'at must be a date (YYYY-MM-DD) or a time';
    end;
    select i.started_at into v_start from history.info i;
    if v_start is null or v_at < v_start then
        raise exception 'History starts on %',
            to_char(coalesce(v_start, now()) at time zone 'UTC', 'FMDD Mon YYYY');
    end if;
    return least(v_at, clock_timestamp());  -- a future time means now
end
$$;

-- Runs one graph function as of a time: wg.as_of is set for that call only.
create or replace function api._as_of(p_fn text, args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_at timestamptz := api._history_at(args);
    v_out jsonb;
begin
    perform set_config('wg.as_of', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), true);
    begin
        if p_fn = 'graph' then
            v_out := api.graph(args - 'at');
        else
            v_out := api.local_graph(args - 'at');
        end if;
    exception when others then
        perform set_config('wg.as_of', '', true);
        raise;
    end;
    perform set_config('wg.as_of', '', true);
    return v_out || jsonb_build_object('as_of', v_at,
                                       'history_starts', (select i.started_at from history.info i));
end
$$;

create or replace function api.graph_as_of(args jsonb) returns jsonb
language sql stable set search_path = public, extensions as $$
    select api._as_of('graph', args)
$$;

create or replace function api.local_graph_as_of(args jsonb) returns jsonb
language sql stable set search_path = public, extensions as $$
    select api._as_of('local_graph', args)
$$;

-- ===========================================================================
-- Who may do what: the website's read-only role reads the log (for "as of")
-- and runs the api; nobody may change the log; only the owner prunes and
-- reverts.
-- ===========================================================================
revoke all on history.change_log, history.info from public;
revoke execute on function history.prune(integer), history.maybe_prune(), history.revert(bigint, boolean)
    from public;
do $$
declare
    r text;
begin
    foreach r in array array['anon', 'authenticated', 'service_role', 'wg_web_reader'] loop
        if exists (select 1 from pg_roles where rolname = r) then
            execute format('revoke all on history.change_log, history.info from %I', r);
            execute format('revoke execute on function history.prune(integer), history.maybe_prune(), '
                           'history.revert(bigint, boolean) from %I', r);
        end if;
    end loop;
end
$$;
grant usage on schema history to wg_web_reader;
grant select on history.change_log, history.info to wg_web_reader;
grant select on history.node_state, history.edge_state, history.link_state, history.mention_state
    to wg_web_reader;
drop policy if exists web_reader_read on history.change_log;
create policy web_reader_read on history.change_log for select to wg_web_reader using (true);
drop policy if exists web_reader_read on history.info;
create policy web_reader_read on history.info for select to wg_web_reader using (true);
grant select on api._g_nodes, api._g_stories, api._g_edges, api._g_links to wg_web_reader;
grant execute on all functions in schema api to wg_web_reader;
