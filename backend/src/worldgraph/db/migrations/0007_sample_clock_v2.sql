-- 0007: a safer sample clock (replaces api.refresh_sample_clock from 0003).
--
-- Fixes two problems:
-- 1. Rows whose primary key contains the timestamp (forecast snapshots,
--    indicator points) were moved with a single delete+insert statement,
--    which can collide with rows that haven't moved yet. They now move via a
--    temporary table.
-- 2. Indicator dates moved by whole days of the story shift, so with a
--    30-minute schedule they never moved. They now shift on their own so the
--    newest sample point is always dated today.

create or replace function api.refresh_sample_clock(p_offset interval default interval '20 minutes')
returns interval
language plpgsql
set search_path = public, extensions
as $$
declare
    newest timestamptz;
    delta interval := interval '0';
    newest_point date;
    day_shift integer;
begin
    -- Stories, articles, forecasts and graph timestamps -----------------------
    select max(s.first_seen) into newest
    from story s join node n on n.id = s.node_id
    where n.is_sample;

    if newest is not null then
        delta := (now() - p_offset) - newest;
        if abs(extract(epoch from delta)) >= 300 then
            update story s set first_seen = s.first_seen + delta,
                               last_seen = s.last_seen + delta,
                               analysed_at = s.analysed_at + delta
            from node n where n.id = s.node_id and n.is_sample;

            update article set published_at = published_at + delta where is_sample;

            update forecast f set end_date = f.end_date + delta
            from node n where n.id = f.node_id and n.is_sample;

            create temp table _wg_snapshots on commit drop as
                select fs.forecast_id, fs.ts + delta as ts, fs.probability, fs.volume, fs.liquidity
                from forecast_snapshot fs join node n on n.id = fs.forecast_id
                where n.is_sample;
            delete from forecast_snapshot fs using node n
                where n.id = fs.forecast_id and n.is_sample;
            insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
                select forecast_id, ts, probability, volume, liquidity from _wg_snapshots;
            drop table _wg_snapshots;

            update node set created_at = created_at + delta, updated_at = updated_at + delta
                where is_sample;
            update edge set created_at = created_at + delta where is_sample;
            update causal_link set created_at = created_at + delta where is_sample;
        else
            delta := interval '0';
        end if;
    end if;

    -- Indicator series: newest sample point dated today -------------------------
    select max(ip.date) into newest_point
    from indicator_point ip join node n on n.id = ip.series_id
    where n.is_sample;

    if newest_point is not null and newest_point <> current_date then
        day_shift := current_date - newest_point;
        create temp table _wg_points on commit drop as
            select ip.series_id, ip.date + day_shift as date, ip.value
            from indicator_point ip join node n on n.id = ip.series_id
            where n.is_sample;
        delete from indicator_point ip using node n
            where n.id = ip.series_id and n.is_sample;
        insert into indicator_point (series_id, date, value)
            select series_id, date, value from _wg_points;
        drop table _wg_points;
    end if;

    return delta;
end;
$$;
