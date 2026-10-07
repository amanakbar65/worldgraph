-- Supabase-only schedule (applied once through the Supabase connector).
-- Keeps sample data "fresh": every 30 minutes the sample stories, forecasts
-- and KPI points are shifted so the newest is always recent. Live data is
-- never touched (api.refresh_sample_clock only moves rows with is_sample).

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'wg-sample-clock';
select cron.schedule('wg-sample-clock', '*/30 * * * *', $$select api.refresh_sample_clock()$$);
