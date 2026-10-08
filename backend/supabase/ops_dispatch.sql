-- A reliable 15-minute clock for the "Live data" GitHub Actions job.
--
-- GitHub's own `schedule` trigger is best-effort and often skips runs for
-- hours, so pg_cron here asks GitHub to start the job every 15 minutes
-- (workflow_dispatch). The GitHub token lives in Supabase Vault under the name
-- `github_dispatch_token` (a fine-grained token for amanakbar65/worldgraph only,
-- with "Actions: read and write"). Until that secret exists, the job does
-- nothing. The workflow's concurrency group stops runs from piling up.
--
-- Applied by hand in the Supabase SQL editor or through the connector.

create or replace function ops.dispatch_live_data() returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
    token  text;
    status integer;
begin
    select decrypted_secret into token
    from vault.decrypted_secrets
    where name = 'github_dispatch_token'
    limit 1;
    if token is null or token = '' then
        return null;  -- not set up yet
    end if;

    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
    select (extensions.http((
        'POST',
        'https://api.github.com/repos/amanakbar65/worldgraph/actions/workflows/pipeline.yml/dispatches',
        array[
            extensions.http_header('Authorization', 'Bearer ' || token),
            extensions.http_header('Accept', 'application/vnd.github+json'),
            extensions.http_header('X-GitHub-Api-Version', '2022-11-28'),
            extensions.http_header('User-Agent', 'worldgraph-live-data')
        ],
        'application/json',
        '{"ref": "main"}'
    )::extensions.http_request)).status into status;

    if status <> 204 then
        raise warning 'Live data dispatch: GitHub answered %', status;
    end if;
    return status;
end;
$$;

revoke execute on function ops.dispatch_live_data() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'wg-live-data';
select cron.schedule('wg-live-data', '*/15 * * * *', 'select ops.dispatch_live_data()');
