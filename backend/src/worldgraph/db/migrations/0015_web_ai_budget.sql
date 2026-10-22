-- The website's daily AI budget, enforced in the database.
--
-- The website's login (wg_web, a member of wg_web_reader) can only read
-- tables, so it could not log its AI calls and the cap was never applied.
-- Instead of giving it write access, it gets two narrow functions:
--
--   api._ai_reserve(purpose, model, estimate, budget) → id | null
--       Before calling Claude: under one lock, add today's spend (UTC) and
--       the call's worst-case cost; if that fits the budget, log a
--       reservation row at the worst-case cost and return its id, else null.
--       The lock makes concurrent calls queue, so together they can't pass
--       the cap.
--   api._ai_settle(id, model, input_tokens, output_tokens, cost) → found
--       After the reply: replace the reservation's worst-case cost with the
--       real one. A call that times out is never settled, so it keeps
--       counting at its worst case.
--
-- Both run as their owner (security definer), accept only Ask and
-- projection rows, and are not part of the API contract (RPC_NAMES), so the
-- browser can't reach them.

alter table llm_usage add column reserved boolean not null default false;
comment on column llm_usage.reserved is
    'true while cost_usd is a reservation at the worst-case price (set by api._ai_reserve)';

create or replace function api._ai_reserve(
    p_purpose text, p_model text, p_estimate numeric, p_budget numeric
) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
    v_spent numeric;
    v_id bigint;
begin
    if p_purpose is null or p_purpose not in ('ask', 'projection') then
        raise exception 'invalid purpose: must be ask or projection';
    end if;
    if p_model is null or p_model !~ '^[a-z0-9][a-z0-9.-]{1,79}$' then
        raise exception 'invalid model';
    end if;
    if p_estimate is null or p_estimate <= 0 or p_estimate > 10 then
        raise exception 'invalid estimate: must be above 0 and at most 10';
    end if;
    if p_budget is null or p_budget < 0 then
        raise exception 'invalid budget: must be 0 or more';
    end if;

    -- One reservation at a time; held until this call's transaction ends.
    perform pg_advisory_xact_lock(hashtext('wg-ai-budget'));
    select coalesce(sum(cost_usd), 0) into v_spent
    from llm_usage
    where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if v_spent + p_estimate > p_budget then
        return null;
    end if;

    insert into llm_usage (engine, model, purpose, cost_usd, reserved)
    values ('api', p_model, p_purpose, round(p_estimate, 5), true)
    returning id into v_id;
    return v_id;
end
$$;

create or replace function api._ai_settle(
    p_id bigint, p_model text, p_input_tokens integer, p_output_tokens integer, p_cost numeric
) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
    if p_cost is null or p_cost < 0 or p_cost > 100 then
        raise exception 'invalid cost: must be 0 to 100';
    end if;
    if p_model is not null and p_model !~ '^[a-z0-9][a-z0-9.-]{1,79}$' then
        raise exception 'invalid model';
    end if;
    -- Only an open reservation from the last hour; a settled row never changes.
    update llm_usage
    set model = coalesce(p_model, model),
        input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
        cost_usd = round(p_cost, 5),
        reserved = false
    where id = p_id
      and reserved
      and purpose in ('ask', 'projection')
      and at > now() - interval '1 hour';
    return found;
end
$$;

-- Functions are executable by everyone by default: allow only the website's
-- role (the owner keeps its rights).
revoke all on function api._ai_reserve(text, text, numeric, numeric) from public;
revoke all on function api._ai_settle(bigint, text, integer, integer, numeric) from public;
grant execute on function api._ai_reserve(text, text, numeric, numeric) to wg_web_reader;
grant execute on function api._ai_settle(bigint, text, integer, integer, numeric) to wg_web_reader;

do $$
declare
    r text;
begin
    -- Supabase's API roles, where they exist, get nothing either.
    foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
            execute format('revoke all on function api._ai_reserve(text, text, numeric, numeric) from %I', r);
            execute format(
                'revoke all on function api._ai_settle(bigint, text, integer, integer, numeric) from %I', r
            );
        end if;
    end loop;
end
$$;
