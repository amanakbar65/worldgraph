-- Undo 0021_kg_types_properties: feature flags, node types and properties.
-- Stored property values are lost. Runs after 0022's down file.

-- Policies and grants go with the tables.
drop trigger if exists node_properties_valid on node;
drop function if exists public.node_properties_valid();

drop function if exists api._where_filter(text[], text, jsonb);
drop function if exists api._where_match(jsonb, jsonb);
drop function if exists api._where_one(jsonb, jsonb);
drop function if exists api._where_eq(jsonb, jsonb, text);
drop function if exists api._where_conditions(text, jsonb);
drop function if exists api._entity_properties(text);
drop function if exists api._property_item(jsonb, jsonb, jsonb);
drop function if exists api._fmt_date(text);
drop function if exists api._fmt_number(numeric);
drop function if exists api._node_values(text);
drop function if exists api._derived_properties(text, text);
drop function if exists api._property_coerce(jsonb, text);
drop function if exists api._property_problems(text, jsonb);
drop function if exists api._prop_value_problem(jsonb, jsonb);
drop function if exists api._valid_date(text);

alter table node drop column if exists properties;

-- node.type goes back to the CHECK list of 0001.
alter table node drop constraint if exists node_type_fkey;
alter table node add constraint node_type_check check (type in (
    'region', 'organization', 'person', 'commodity', 'sector',
    'infrastructure', 'policy', 'indicator', 'story', 'forecast',
    'user_entity'));
drop table if exists node_type;

-- api.meta as 0011 left it (no flags).
create or replace function api.meta(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
begin
    return jsonb_build_object(
        'generated_at', now(),
        'data', (
            select jsonb_build_object(
                'live_stories', count(*) filter (where s.kind = 'event' and not n.is_sample),
                'sample_stories', count(*) filter (where s.kind = 'event' and n.is_sample),
                'forecasts', (
                    select count(*) from api.forecast_card fc
                    where fc.status = 'open' and not fc.hidden
                      and (v_sample or not fc.is_sample)
                      and api._provider_visible(fc.provider, v_viewer)
                ),
                'entities', (
                    select count(*) from node en
                    where en.type not in ('story', 'forecast') and (v_sample or not en.is_sample)
                ),
                -- the last news run that finished, else the newest live story
                'last_ingest_at', coalesce(
                    (select max(r.finished_at) from ingest_run r where r.job = 'news' and r.ok),
                    max(s.first_seen) filter (where not n.is_sample)
                ),
                'showing_sample', api._use_sample('{}'::jsonb)
            )
            from story s join node n on n.id = s.node_id
        ),
        'sectors', (
            select jsonb_agg(jsonb_build_object(
                       'id', sec.id,
                       'name', coalesce(n.name, initcap(replace(sec.id, '-', ' '))),
                       'icon', coalesce(n.props ->> 'icon', 'circle')
                   ) order by sec.ord)
            from unnest(api._a_sectors()) with ordinality as sec(id, ord)
            left join node n on n.id = 'sector:' || sec.id
        ),
        'sources', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', x.id, 'name', x.name, 'attribution', x.attribution, 'homepage', x.homepage
                   ) order by x.grp, x.name, x.id), '[]'::jsonb)
            from (
                select src.id, src.name, src.attribution, src.homepage, 0 as grp from source src
                union all
                select fp.id, fp.name, fp.attribution, fp.homepage, 1 from forecast_provider fp
                where fp.enabled
                  and api._provider_visible(fp.id, v_viewer)
                  and not exists (select 1 from source src where src.id = fp.id)
            ) x
        )
    );
end;
$$;

drop function if exists api._flag(text);
drop table if exists app_flag;
