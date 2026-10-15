-- 0012: the sample clock never moves anything into the future (replaces
-- api.refresh_sample_clock from 0007).
--
-- 0007 moved the newest sample story's first_seen to now() - 20 minutes. The
-- sample's other times (forecast snapshots, last_seen, analysed_at) are up to
-- 24 minutes newer than that story, so they landed in the future and the app
-- read "Updated in 3 min". Now the newest of all moved sample times goes to
-- now() - p_offset (default 5 minutes; the newest story is then about half an
-- hour old). Node, edge and causal-link created_at come from loading, not
-- from the sample itself, so they are moved too but never past that moment.
--
-- Also repairs sample articles dated after their story's last_seen (the
-- sample builder used to date them up to 4 hours after first_seen): their
-- times are scaled into the story's [first_seen, last_seen].

update article a
set published_at = greatest(s.first_seen, least(s.last_seen,
        s.first_seen + (a.published_at - s.first_seen)
                       * (extract(epoch from s.last_seen - s.first_seen) / 14400.0)))
from story s
where a.story_id = s.node_id
  and a.is_sample
  and s.first_seen is not null
  and s.last_seen is not null
  and exists (select 1 from article b
              where b.story_id = s.node_id and b.is_sample and b.published_at > s.last_seen);

create or replace function api.refresh_sample_clock(p_offset interval default interval '5 minutes')
returns interval
language plpgsql
set search_path = public, extensions
as $$
declare
    newest timestamptz;
    target timestamptz := now() - p_offset;
    delta interval := interval '0';
    newest_point date;
    day_shift integer;
begin
    -- The newest sample moment: stories, articles and forecast snapshots ----------
    select greatest(
        (select greatest(max(s.first_seen), max(s.last_seen), max(s.analysed_at))
         from story s join node n on n.id = s.node_id where n.is_sample),
        (select max(a.published_at) from article a where a.is_sample),
        (select max(fs.ts) from forecast_snapshot fs join node n on n.id = fs.forecast_id
         where n.is_sample)
    ) into newest;

    -- Move when it is 5 minutes or more off, and always when it is in the future.
    if newest is not null and (abs(extract(epoch from target - newest)) >= 300 or newest > now()) then
        delta := target - newest;

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

        update node set created_at = least(created_at + delta, target),
                        updated_at = least(updated_at + delta, target)
            where is_sample;
        update edge set created_at = least(created_at + delta, target) where is_sample;
        update causal_link set created_at = least(created_at + delta, target) where is_sample;
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
