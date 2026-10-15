-- 0011: api.meta (replaces the 0004 version).
--
-- `last_ingest_at` ("Updated N min ago", "News last checked …") is the time
-- the last news run finished (ingest_run, job 'news', ok). It used to be the
-- newest live story's first_seen, which is the oldest article of that story
-- and stays put when a run finds nothing new. Without any recorded run it
-- falls back to the newest live story, as before.

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
