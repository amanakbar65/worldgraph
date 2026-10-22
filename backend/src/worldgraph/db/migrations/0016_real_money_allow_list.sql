-- Real-money forecast providers: an allow-list of viewer countries, failing closed.
--
-- 0002 only blocked listed countries (Polymarket: India), so a real-money
-- provider, once switched on, would show (with a link) everywhere else,
-- including countries where it is blocked. Now a real-money provider shows
-- only to a viewer whose country (set by the server, never the browser) is on
-- its allow-list. An empty list means nowhere. blocked_countries still wins.
--
-- Polymarket stays switched off, and its list stays empty until legal advice
-- names the countries where it may be shown.

alter table forecast_provider
    add column allowed_countries text[] not null default '{}',
    add constraint forecast_provider_allowed_countries_iso2
        check (array_to_string(allowed_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');

comment on column forecast_provider.allowed_countries is
    'Real-money providers show only to viewers in these countries (ISO 3166-1 alpha-2); empty = nowhere';

update forecast_provider
set allowed_countries = '{}',
    attribution = 'Crowd forecast from Polymarket (real-money market, information only)'
where id = 'polymarket';

-- May this provider's forecasts be shown to this viewer? Real-money providers
-- need a known viewer country that is on the allow-list and not blocked.
create or replace function api._provider_visible(p_provider text, p_viewer text) returns boolean
language sql stable set search_path = public, extensions as $$
    select exists (
        select 1 from forecast_provider fp
        where fp.id = p_provider
          and fp.enabled
          and (not fp.real_money
               or (p_viewer is not null
                   and upper(p_viewer) = any (fp.allowed_countries)
                   and not (upper(p_viewer) = any (fp.blocked_countries))))
    )
$$;
