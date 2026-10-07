-- 0009: stories the AI judges "not business news" disappear everywhere, and
-- small helpers get a fixed search_path (Supabase security advisor).

-- ---------------------------------------------------------------------------
-- Skipped stories. When a story is marked analysis_status = 'skipped' (by
-- api.save_analysis), its links are remembered here and the story is
-- deleted, so no screen ever shows it and the pipeline never re-ingests the
-- same articles. Kept for 7 days (see the pipeline's retention rules).
-- ---------------------------------------------------------------------------
create table skipped_url (
    url  text primary key,
    at   timestamptz not null default now()
);
alter table skipped_url enable row level security;

create or replace function public.story_skipped() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    insert into skipped_url (url)
        select a.url from article a where a.story_id = new.node_id and a.url is not null
        on conflict (url) do nothing;
    delete from article where story_id = new.node_id and not is_sample;
    delete from node where id = new.node_id and not is_sample;
    return null;
end;
$$;

create trigger story_skipped
    after update of analysis_status on story
    for each row
    when (new.analysis_status = 'skipped' and old.analysis_status is distinct from 'skipped')
    execute function public.story_skipped();

-- ---------------------------------------------------------------------------
-- Fixed search_path for helpers that had none.
-- ---------------------------------------------------------------------------
alter function api._viewer_country(jsonb) set search_path = pg_catalog;
alter function api._window(jsonb) set search_path = pg_catalog;
alter function api._text_array(jsonb) set search_path = pg_catalog;
alter function api._b_int(jsonb, integer) set search_path = pg_catalog;
alter function api._b_num(jsonb, numeric) set search_path = pg_catalog;
alter function api._b_readable(text) set search_path = pg_catalog;
