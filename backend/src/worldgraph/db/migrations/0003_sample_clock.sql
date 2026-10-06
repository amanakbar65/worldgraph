-- 0003: keep sample data looking current.
-- Shifts every sample timestamp forward so the newest sample story is
-- `p_offset` old. Scheduled in Supabase with pg_cron (every 30 minutes) and
-- called by the tests after loading sample data with a fixed clock.
-- Not part of the client-callable API (not in the RPC allow-list).

create or replace function api.refresh_sample_clock(p_offset interval default interval '20 minutes')
returns interval
language plpgsql
set search_path = public, extensions
as $$
declare
    newest timestamptz;
    delta interval;
    delta_days integer;
begin
    select max(s.first_seen) into newest
    from story s join node n on n.id = s.node_id
    where n.is_sample;
    if newest is null then
        return interval '0';
    end if;
    delta := (now() - p_offset) - newest;
    if delta < interval '5 minutes' and delta > interval '-5 minutes' then
        return interval '0';  -- already fresh
    end if;
    delta_days := floor(extract(epoch from delta) / 86400)::integer;

    update story s set first_seen = s.first_seen + delta,
                       last_seen = s.last_seen + delta,
                       analysed_at = s.analysed_at + delta
    from node n where n.id = s.node_id and n.is_sample;

    update article set published_at = published_at + delta where is_sample;

    update forecast f set end_date = f.end_date + delta
    from node n where n.id = f.node_id and n.is_sample;

    -- Primary keys include the timestamp, so move rows by delete + insert.
    with moved as (
        delete from forecast_snapshot fs using node n
        where n.id = fs.forecast_id and n.is_sample
        returning fs.forecast_id, fs.ts, fs.probability, fs.volume, fs.liquidity
    )
    insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
    select forecast_id, ts + delta, probability, volume, liquidity from moved;

    if delta_days <> 0 then
        with moved as (
            delete from indicator_point ip using node n
            where n.id = ip.series_id and n.is_sample
            returning ip.series_id, ip.date, ip.value
        )
        insert into indicator_point (series_id, date, value)
        select series_id, date + delta_days, value from moved;
    end if;

    update node set created_at = created_at + delta, updated_at = updated_at + delta where is_sample;
    update edge set created_at = created_at + delta where is_sample;
    update causal_link set created_at = created_at + delta where is_sample;
    return delta;
end;
$$;
