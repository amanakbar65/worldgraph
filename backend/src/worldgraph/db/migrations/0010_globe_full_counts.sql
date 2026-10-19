-- 0010: api.globe (replaces the 0004 version).
--
-- 1. Country shading and counts cover every event in the window. They used to
--    be counted from the 1,500 events the globe draws, so a busy window
--    undercounted countries, and left out ones whose events ranked lower.
--    `truncated` says when the event list holds only the top 1,500.
-- 2. Each event says whether the story has its AI analysis (`analysed`).
--    False marks a draft from the live news pipeline.
-- 3. Stories the AI judged "not business news" (analysis_status 'skipped')
--    never appear: not as events, in country counts or as arc sources.

create or replace function api.globe(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_key text := api._a_window_key(args);
    v_since timestamptz := now() - api._window(jsonb_build_object('window', v_key));
    v_sectors text[] := api._text_array(args -> 'sectors');
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_result jsonb;
begin
    with base as materialized (
        -- every event the globe could show (no cap)
        select s.node_id as id, s.location, s.impact, s.importance, s.magnitude, s.sectors,
               s.first_seen, s.headline, s.country_id, s.analysis_status = 'done' as analysed
        from story s
        join node n on n.id = s.node_id
        where s.kind = 'event'
          and s.first_seen >= v_since
          and s.location is not null
          and s.analysis_status <> 'skipped'
          and (v_sample or not n.is_sample)
          and (v_sectors is null or s.sectors && v_sectors)
    ),
    ev as materialized (
        -- the events drawn and listed: the 1,500 most important
        select * from base
        order by base.importance desc, base.first_seen desc, base.id
        limit 1500
    ),
    arc as (
        select cl.id, cl.src_story, cl.dst_story, src.location as src_loc, dst.location as dst_loc,
               src.country_id as src_country, dst.country_id as dst_country,
               cl.link_type, cl.confidence, dst.impact
        from ev dst
        join causal_link cl on cl.dst_story = dst.id
        join story src on src.node_id = cl.src_story
        join node srcn on srcn.id = src.node_id
        where cl.link_type in ('reported', 'inferred')
          and (v_sample or not cl.is_sample)
          and src.kind = 'event'
          and src.first_seen >= now() - interval '30 days'
          and src.location is not null
          and src.analysis_status <> 'skipped'
          and (v_sample or not srcn.is_sample)
          and src.country_id is not null
          and dst.country_id is not null
          and src.country_id <> dst.country_id
    ),
    country as (
        select base.country_id as id,
               count(*) as n,
               count(*) filter (where base.impact = 'risk') as risk,
               count(*) filter (where base.impact = 'opportunity') as opp,
               count(*) filter (where base.impact = 'neutral') as neu
        from base
        where base.country_id is not null
        group by base.country_id
    ),
    fc as (
        select f.card, f.change_24h, f.id
        from api.forecast_card f
        where f.geom is not null
          and f.status = 'open'
          and not f.hidden
          and (v_sample or not f.is_sample)
          and api._provider_visible(f.provider, v_viewer)
        order by abs(f.change_24h) desc nulls last, f.id
        limit 500
    )
    select jsonb_build_object(
        'window', v_key,
        'events', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', ev.id,
                       'lon', round(st_x(ev.location::geometry)::numeric, 4),
                       'lat', round(st_y(ev.location::geometry)::numeric, 4),
                       'impact', ev.impact,
                       'importance', round(ev.importance::numeric, 1),
                       'magnitude', ev.magnitude,
                       'sectors', to_jsonb(ev.sectors),
                       'first_seen', ev.first_seen,
                       'headline', ev.headline,
                       'country_id', ev.country_id,
                       'analysed', ev.analysed
                   ) order by ev.importance desc, ev.first_seen desc, ev.id), '[]'::jsonb)
            from ev
        ),
        'truncated', (select count(*) > 1500 from base),
        'arcs', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', arc.id,
                       'src_story', arc.src_story,
                       'dst_story', arc.dst_story,
                       'src', jsonb_build_array(round(st_x(arc.src_loc::geometry)::numeric, 4),
                                                round(st_y(arc.src_loc::geometry)::numeric, 4)),
                       'dst', jsonb_build_array(round(st_x(arc.dst_loc::geometry)::numeric, 4),
                                                round(st_y(arc.dst_loc::geometry)::numeric, 4)),
                       'src_country', arc.src_country,
                       'dst_country', arc.dst_country,
                       'link_type', arc.link_type,
                       'confidence', round(arc.confidence::numeric, 3),
                       'impact', arc.impact
                   ) order by arc.id), '[]'::jsonb)
            from arc
        ),
        'forecasts', (
            select coalesce(jsonb_agg(fc.card order by abs(fc.change_24h) desc nulls last, fc.id), '[]'::jsonb)
            from fc
        ),
        'countries', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id,
                       'count', c.n,
                       'risk', c.risk,
                       'opportunity', c.opp,
                       'neutral', c.neu,
                       'score', round((c.opp - c.risk)::numeric / c.n, 3)
                   ) order by c.n desc, c.id), '[]'::jsonb)
            from country c
        )
    ) into v_result;
    return v_result;
end;
$$;
