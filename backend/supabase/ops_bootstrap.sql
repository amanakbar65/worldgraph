-- Supabase-only helpers (applied once through the Supabase connector).
-- They let Supabase run a migration or sample-data file fetched from this
-- public GitHub repo, but only if its MD5 matches the checksum computed
-- locally, so nothing else can be swapped in. The `ops` schema is private
-- (not exposed through the REST API).

create extension if not exists http with schema extensions;
create schema if not exists ops;
revoke all on schema ops from public;

create or replace function ops.run_remote_sql(p_url text, p_md5 text) returns integer
language plpgsql as $$
declare
    r record;
begin
    if p_url !~ '^https://raw\.githubusercontent\.com/amanakbar65/worldgraph/' then
        raise exception 'Only files from the WorldGraph repository may run';
    end if;
    select status, content into r from extensions.http_get(p_url);
    if r.status <> 200 then
        raise exception 'Fetching % failed with HTTP %', p_url, r.status;
    end if;
    if md5(r.content) <> p_md5 then
        raise exception 'Checksum mismatch for %', p_url;
    end if;
    perform set_config('search_path', 'public, extensions', true);
    execute r.content;
    return length(r.content);
end;
$$;

create or replace function ops.apply_migration(p_version text, p_name text, p_url text, p_md5 text)
returns text language plpgsql as $$
begin
    if exists (select 1 from public.schema_migrations where version = p_version) then
        return 'already applied';
    end if;
    perform ops.run_remote_sql(p_url, p_md5);
    insert into public.schema_migrations (version, name) values (p_version, p_name);
    return 'applied';
end;
$$;

-- Hardening (Supabase security advisor): fixed search_path, and only the
-- owner (postgres) may run these.
alter function ops.run_remote_sql(text, text) set search_path = public, extensions;
alter function ops.apply_migration(text, text, text, text) set search_path = public, extensions;
revoke execute on function ops.run_remote_sql(text, text) from public, anon, authenticated;
revoke execute on function ops.apply_migration(text, text, text, text) from public, anon, authenticated;
