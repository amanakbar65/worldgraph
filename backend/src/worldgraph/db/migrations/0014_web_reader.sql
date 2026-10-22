-- A read-only role for the website's server functions (Netlify).
-- It can run the api.* functions and read the public tables they use, and
-- nothing else: no writes, no ops or vault. The login that uses it (wg_web)
-- is created outside git, and its password lives only in Netlify.
-- Every public table has row-level security on, so each one gets a
-- select-only policy for this role. A new public table read by api.* needs
-- the same policy (copy the loop body).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wg_web_reader') then
    create role wg_web_reader nologin;
  end if;
end
$$;

grant usage on schema api, public, extensions to wg_web_reader;
grant execute on all functions in schema api to wg_web_reader;
grant select on all tables in schema api to wg_web_reader;  -- api views such as forecast_card

do $$
declare
  t record;
begin
  -- Only our own tables (PostGIS's spatial_ref_sys belongs to the platform).
  for t in select tablename from pg_tables where schemaname = 'public' and tableowner = current_user loop
    execute format('grant select on public.%I to wg_web_reader', t.tablename);
    execute format('drop policy if exists web_reader_read on public.%I', t.tablename);
    execute format(
      'create policy web_reader_read on public.%I for select to wg_web_reader using (true)',
      t.tablename
    );
  end loop;
end
$$;
