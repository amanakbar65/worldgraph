-- 0021: knowledge graph upgrade, Phase A0 (groundwork) and A1 (node types
-- with properties). See PLAN.md "Phase A" and backend/src/worldgraph/schema/.
--
-- A0  Feature flags: app_flag, api._flag(key) and api.meta's `flags`.
-- A1  node_type: the 11 node types with their property definitions,
--     generated from schema/types.yaml by `wg schema sql`. node.type now
--     references it (instead of a CHECK list). node.properties holds the
--     typed values, checked by api._property_problems in a trigger.
--     Region, sector, story and forecast values are derived from their
--     side tables (read-only), never copied.
--
-- The api functions that show properties and filter by them (api.entity,
-- api.graph, api.local_graph, api.schema) are redefined once, in 0022,
-- together with the relation changes; this keeps each down file a single
-- copy of the previous definitions.
--
-- Undo: down/0021_kg_types_properties.down.sql.

-- ===========================================================================
-- A0. Feature flags
-- ===========================================================================
create table app_flag (
    key         text primary key check (key ~ '^[a-z0-9_.-]+$'),
    enabled     boolean not null,
    note        text,
    updated_at  timestamptz not null default now()
);
alter table app_flag enable row level security;

-- On for the test link (the public website isn't launched yet).
insert into app_flag (key, enabled, note) values
    ('kg.properties', true, 'A1: typed properties on entity pages; property filters in the graph'),
    ('kg.relations', true, 'A2: named relations, connections grouped by relation, relation filters'),
    ('kg.provenance', true, 'A3: sources on every node and link ("Why is this here?")'),
    ('kg.history', true, 'A4: change log and "as of" dates'),
    ('kg.schema_map', true, 'A5: the schema map (types and relations with counts)')
on conflict (key) do nothing;

-- Is this feature on? A missing key is off.
create or replace function api._flag(p_key text) returns boolean
language sql stable set search_path = public, extensions as $$
    select coalesce((select f.enabled from app_flag f where f.key = p_key), false)
$$;

-- api.meta: 0011's, plus `flags` ({key: enabled}).
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
        ),
        'flags', (
            select coalesce(jsonb_object_agg(f.key, f.enabled), '{}'::jsonb) from app_flag f
        )
    );
end;
$$;

-- ===========================================================================
-- A1. Node types
-- ===========================================================================
create table node_type (
    key          text primary key check (key ~ '^[a-z_]+$'),
    label        text not null,
    plural       text not null,
    icon         text not null,                 -- a lucide icon name
    tone         text not null,                 -- a CSS token: colour = var(--<tone>)
    description  text not null,
    properties   jsonb not null default '[]' check (jsonb_typeof(properties) = 'array'),
    ord          smallint not null              -- display order
);
alter table node_type enable row level security;

-- BEGIN `wg schema sql --only node_types` (schema/types.yaml)
insert into node_type (key, label, plural, icon, tone, description, properties, ord) values
    ('region', 'Place', 'Places', 'map-pin', 'type-region', 'A country, state or province, city, or a group of countries.', '[{"key": "level", "label": "Level", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "bloc", "label": "Group of countries"}, {"key": "country", "label": "Country"}, {"key": "state", "label": "State or province"}, {"key": "city", "label": "City"}]}, {"key": "iso_code", "label": "ISO code", "kind": "text", "required": false, "derived": true, "multiple": false}, {"key": "parent", "label": "Part of", "kind": "place", "required": false, "derived": true, "multiple": false}, {"key": "country", "label": "Country", "kind": "place", "required": false, "derived": true, "multiple": false}, {"key": "population", "label": "Population", "kind": "number", "required": false, "derived": true, "multiple": false}, {"key": "continent", "label": "Continent", "kind": "text", "required": false, "derived": true, "multiple": false}, {"key": "subregion", "label": "Subregion", "kind": "text", "required": false, "derived": true, "multiple": false}]'::jsonb, 1),
    ('organization', 'Organisation', 'Organisations', 'building', 'type-organization', 'A company, public body, central bank or international organisation.', '[{"key": "sector", "label": "Sector", "kind": "entity", "required": false, "derived": false, "multiple": true, "entity_types": ["sector"]}, {"key": "headquarters", "label": "Headquarters", "kind": "place", "required": false, "derived": false, "multiple": false}, {"key": "size", "label": "Size", "kind": "choice", "required": false, "derived": false, "multiple": false, "choices": [{"key": "micro", "label": "Micro"}, {"key": "small", "label": "Small"}, {"key": "medium", "label": "Medium"}, {"key": "large", "label": "Large"}], "description": "By staff (EU definition): micro under 10, small under 50, medium under 250, large 250 or more."}, {"key": "founded", "label": "Founded", "kind": "date", "required": false, "derived": false, "multiple": false}, {"key": "website", "label": "Website", "kind": "url", "required": false, "derived": false, "multiple": false}, {"key": "ticker", "label": "Ticker", "kind": "text", "required": false, "derived": false, "multiple": false, "description": "Main listing, for example NYSE: XOM."}]'::jsonb, 2),
    ('person', 'Person', 'People', 'user-round', 'type-person', 'A public figure in a public role (never a private individual).', '[{"key": "role", "label": "Role", "kind": "text", "required": false, "derived": false, "multiple": false}, {"key": "organization", "label": "Organisation", "kind": "entity", "required": false, "derived": false, "multiple": false, "entity_types": ["organization"]}]'::jsonb, 3),
    ('commodity', 'Commodity', 'Commodities', 'package', 'type-commodity', 'A traded good or product, such as crude oil, wheat or chips.', '[{"key": "unit", "label": "Unit", "kind": "text", "required": false, "derived": false, "multiple": false, "description": "Trading unit, for example barrel, tonne or MMBtu."}, {"key": "benchmark", "label": "Benchmark", "kind": "text", "required": false, "derived": false, "multiple": false, "description": "Main price benchmark, for example Brent."}, {"key": "hs_code", "label": "HS code", "kind": "text", "required": false, "derived": false, "multiple": false, "pattern": "^[0-9]{2,10}$", "description": "Harmonized System heading."}]'::jsonb, 4),
    ('sector', 'Sector', 'Sectors', 'layers', 'type-sector', 'One of the nine business sectors used as lenses.', '[{"key": "entity_count", "label": "Linked entities", "kind": "number", "required": false, "derived": true, "multiple": false}]'::jsonb, 5),
    ('infrastructure', 'Infrastructure', 'Infrastructure', 'utility-pole', 'type-infrastructure', 'A port, canal, strait, terminal, mine, plant or industrial zone.', '[{"key": "kind", "label": "Kind", "kind": "choice", "required": false, "derived": false, "multiple": false, "choices": [{"key": "port", "label": "Port"}, {"key": "terminal", "label": "Terminal"}, {"key": "canal", "label": "Canal"}, {"key": "strait", "label": "Strait"}, {"key": "chokepoint", "label": "Chokepoint"}, {"key": "sea-route", "label": "Sea route"}, {"key": "pipeline", "label": "Pipeline"}, {"key": "plant", "label": "Plant"}, {"key": "mine", "label": "Mine"}, {"key": "industrial-zone", "label": "Industrial zone"}, {"key": "data-centre", "label": "Data centre"}]}, {"key": "capacity", "label": "Capacity", "kind": "number", "required": false, "derived": false, "multiple": false, "unit_key": "capacity_unit", "min": 0}, {"key": "capacity_unit", "label": "Capacity unit", "kind": "text", "required": false, "derived": false, "multiple": false, "description": "For example TEU a year, barrels a day or MW."}, {"key": "operator", "label": "Operator", "kind": "entity", "required": false, "derived": false, "multiple": false, "entity_types": ["organization"]}, {"key": "place", "label": "Place", "kind": "place", "required": false, "derived": false, "multiple": false}]'::jsonb, 6),
    ('policy', 'Policy', 'Policies', 'scroll-text', 'type-policy', 'A law, regulation, tariff, subsidy or agreement.', '[{"key": "issuer", "label": "Issuer", "kind": "entity", "required": false, "derived": false, "multiple": false, "entity_types": ["organization", "region"]}, {"key": "effective_date", "label": "In force from", "kind": "date", "required": false, "derived": false, "multiple": false}, {"key": "status", "label": "Status", "kind": "choice", "required": false, "derived": false, "multiple": false, "choices": [{"key": "proposed", "label": "Proposed"}, {"key": "in_force", "label": "In force"}, {"key": "expired", "label": "Expired"}]}, {"key": "scope", "label": "Applies to", "kind": "place", "required": false, "derived": false, "multiple": true}]'::jsonb, 7),
    ('indicator', 'Indicator', 'Indicators', 'gauge', 'type-indicator', 'A KPI time series, such as inflation or a fuel price.', '[{"key": "unit", "label": "Unit", "kind": "text", "required": false, "derived": false, "multiple": false}, {"key": "frequency", "label": "Frequency", "kind": "choice", "required": false, "derived": false, "multiple": false, "choices": [{"key": "daily", "label": "Daily"}, {"key": "weekly", "label": "Weekly"}, {"key": "monthly", "label": "Monthly"}, {"key": "quarterly", "label": "Quarterly"}, {"key": "annual", "label": "Annual"}]}, {"key": "source", "label": "Source", "kind": "text", "required": false, "derived": false, "multiple": false}]'::jsonb, 8),
    ('story', 'Story', 'Stories', 'newspaper', 'neutral', 'A real-world event from the news, or a possible future impact.', '[{"key": "kind", "label": "Kind", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "event", "label": "Event"}, {"key": "projected", "label": "Possible impact"}]}, {"key": "event_type", "label": "Event type", "kind": "text", "required": false, "derived": true, "multiple": false}, {"key": "impact", "label": "Impact", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "risk", "label": "Risk"}, {"key": "opportunity", "label": "Opportunity"}, {"key": "neutral", "label": "Neutral"}]}, {"key": "direction", "label": "Direction", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "up", "label": "Up"}, {"key": "down", "label": "Down"}]}, {"key": "magnitude", "label": "Magnitude", "kind": "number", "required": false, "derived": true, "multiple": false, "min": 1, "max": 5}, {"key": "horizon", "label": "Horizon", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "now", "label": "Now"}, {"key": "weeks", "label": "Within weeks"}, {"key": "months", "label": "Within months"}]}, {"key": "confidence", "label": "Confidence", "kind": "number", "required": false, "derived": true, "multiple": false, "unit": "%", "min": 0, "max": 100}, {"key": "importance", "label": "Importance", "kind": "number", "required": false, "derived": true, "multiple": false, "min": 0, "max": 100}, {"key": "first_seen", "label": "First seen", "kind": "date", "required": false, "derived": true, "multiple": false}, {"key": "sectors", "label": "Sectors", "kind": "entity", "required": false, "derived": true, "multiple": true, "entity_types": ["sector"]}, {"key": "region", "label": "Region", "kind": "place", "required": false, "derived": true, "multiple": false}]'::jsonb, 9),
    ('forecast', 'Crowd forecast', 'Crowd forecasts', 'users', 'forecast', 'A crowd forecast question with its probability over time.', '[{"key": "provider", "label": "Provider", "kind": "text", "required": false, "derived": true, "multiple": false}, {"key": "category", "label": "Category", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "economy", "label": "Economy"}, {"key": "finance", "label": "Finance"}, {"key": "policy", "label": "Policy"}, {"key": "politics", "label": "Politics"}, {"key": "geopolitics", "label": "Geopolitics"}, {"key": "trade", "label": "Trade"}, {"key": "tech", "label": "Tech"}, {"key": "commodities", "label": "Commodities"}, {"key": "energy", "label": "Energy"}]}, {"key": "probability", "label": "Chance of yes", "kind": "number", "required": false, "derived": true, "multiple": false, "unit": "%", "min": 0, "max": 100}, {"key": "end_date", "label": "Closes", "kind": "date", "required": false, "derived": true, "multiple": false}, {"key": "status", "label": "Status", "kind": "choice", "required": false, "derived": true, "multiple": false, "choices": [{"key": "open", "label": "Open"}, {"key": "closed", "label": "Closed"}, {"key": "resolved", "label": "Resolved"}]}, {"key": "volume", "label": "Volume", "kind": "number", "required": false, "derived": true, "multiple": false, "unit_key": "volume_unit", "min": 0}, {"key": "volume_unit", "label": "Volume unit", "kind": "text", "required": false, "derived": true, "multiple": false}]'::jsonb, 10),
    ('user_entity', 'Your business', 'Your business', 'briefcase-business', 'type-user', 'The viewer''s own business (kept in per-viewer storage, not the world graph).', '[]'::jsonb, 11)
on conflict (key) do update set label = excluded.label, plural = excluded.plural, icon = excluded.icon, tone = excluded.tone, description = excluded.description, properties = excluded.properties, ord = excluded.ord;
-- END `wg schema sql --only node_types`

-- node.type references the registry (it was a CHECK list of the same 11).
alter table node drop constraint node_type_check;
alter table node add constraint node_type_fkey foreign key (type) references node_type (key);

-- Typed property values, checked against node_type.properties.
alter table node add column properties jsonb not null default '{}'
    check (jsonb_typeof(properties) = 'object');

-- ---------------------------------------------------------------------------
-- Validation. The same rules are in Python (worldgraph/schema/registry.py),
-- with the same messages; tests/test_schema.py runs both on the same cases.
-- ---------------------------------------------------------------------------

-- "YYYY", "YYYY-MM" or "YYYY-MM-DD", and a real date.
create or replace function api._valid_date(p_text text) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare
    v_parts text[];
    v_month integer;
    v_day integer;
begin
    if p_text is null or p_text !~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then
        return false;
    end if;
    v_parts := string_to_array(p_text, '-');
    if cardinality(v_parts) = 1 then
        return v_parts[1]::integer >= 1;
    end if;
    v_month := v_parts[2]::integer;
    if v_parts[1]::integer < 1 or v_month not between 1 and 12 then
        return false;
    end if;
    if cardinality(v_parts) = 2 then
        return true;
    end if;
    v_day := v_parts[3]::integer;
    return v_day between 1 and extract(day from (make_date(v_parts[1]::integer, v_month, 1)
                                                 + interval '1 month - 1 day'))::integer;
end
$$;

-- Why one value doesn't fit a property definition (null when it does).
create or replace function api._prop_value_problem(p_def jsonb, p_value jsonb) returns text
language plpgsql stable set search_path = public, extensions as $$
declare
    v_kind text := p_def ->> 'kind';
    v_type text := jsonb_typeof(p_value);
    v_text text := p_value #>> '{}';
    v_found text;
begin
    if v_kind = 'text' then
        if v_type is distinct from 'string' or btrim(v_text, E' \t\r\n') = '' then
            return 'must be text';
        end if;
        if char_length(v_text) > 300 then
            return 'must be at most 300 characters';
        end if;
        if p_def ? 'pattern' and v_text !~ (p_def ->> 'pattern') then
            return 'is not in the expected format';
        end if;
        return null;
    elsif v_kind = 'number' then
        if v_type is distinct from 'number' then
            return 'must be a number';
        end if;
        if p_def ? 'min' and v_text::numeric < (p_def ->> 'min')::numeric then
            return 'must be at least ' || (p_def ->> 'min');
        end if;
        if p_def ? 'max' and v_text::numeric > (p_def ->> 'max')::numeric then
            return 'must be at most ' || (p_def ->> 'max');
        end if;
        return null;
    elsif v_kind = 'date' then
        if v_type is distinct from 'string' or not api._valid_date(v_text) then
            return 'must be a date (YYYY, YYYY-MM or YYYY-MM-DD)';
        end if;
        return null;
    elsif v_kind = 'choice' then
        if v_type is distinct from 'string' or not exists (
            select 1 from jsonb_array_elements(p_def -> 'choices') c where c ->> 'key' = v_text) then
            return 'must be one of: ' || (
                select string_agg(c ->> 'key', ', ' order by o)
                from jsonb_array_elements(p_def -> 'choices') with ordinality as x(c, o));
        end if;
        return null;
    elsif v_kind = 'url' then
        if v_type is distinct from 'string' or char_length(v_text) > 500 or v_text !~ '^https?://\S+$' then
            return 'must be an http(s) link';
        end if;
        return null;
    elsif v_kind in ('place', 'entity') then
        if v_type is distinct from 'string' or v_text !~ '^[a-z_]+:[a-z0-9][a-z0-9.-]*$' then
            return case when v_kind = 'place' then 'must be a place id' else 'must be an entity id' end;
        end if;
        select n.type into v_found from node n where n.id = v_text;
        if v_kind = 'place' then
            return case when v_found = 'region' then null else 'unknown place ' || v_text end;
        end if;
        if v_found is null then
            return 'unknown entity ' || v_text;
        end if;
        if jsonb_typeof(p_def -> 'entity_types') = 'array'
           and jsonb_array_length(p_def -> 'entity_types') > 0
           and not (p_def -> 'entity_types') ? v_found then
            return 'must be one of these types: ' || (
                select string_agg(t, ', ' order by o)
                from jsonb_array_elements_text(p_def -> 'entity_types') with ordinality as x(t, o));
        end if;
        return null;
    end if;
    return 'unknown kind ' || coalesce(v_kind, '?');
end
$$;

-- Every problem with a node's properties, in definition order ({} when
-- valid). Unknown keys are allowed (the owner's review list shows them);
-- derived properties can't be stored.
create or replace function api._property_problems(p_type text, p_properties jsonb) returns text[]
language plpgsql stable set search_path = public, extensions as $$
declare
    v_defs jsonb;
    v_def jsonb;
    v_key text;
    v_value jsonb;
    v_el jsonb;
    v_problem text;
    v_out text[] := '{}';
begin
    select nt.properties into v_defs from node_type nt where nt.key = p_type;
    if not found then
        return array['unknown type ' || coalesce(p_type, '?')];
    end if;
    if jsonb_typeof(p_properties) is distinct from 'object' then
        return array['properties must be an object'];
    end if;
    for v_def in select d from jsonb_array_elements(v_defs) with ordinality as x(d, o) order by o loop
        v_key := v_def ->> 'key';
        v_value := p_properties -> v_key;
        if jsonb_typeof(v_value) = 'null' then
            v_value := null;
        end if;
        if coalesce((v_def ->> 'derived')::boolean, false) then
            if v_value is not null then
                v_out := v_out || (v_key || ': is read-only (worked out automatically)');
            end if;
            continue;
        end if;
        if v_value is null then
            if coalesce((v_def ->> 'required')::boolean, false) then
                v_out := v_out || (v_key || ': is required');
            end if;
            continue;
        end if;
        if coalesce((v_def ->> 'multiple')::boolean, false) then
            if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) = 0 then
                v_out := v_out || (v_key || ': must be a list');
                continue;
            end if;
            for v_el in select e from jsonb_array_elements(v_value) with ordinality as x(e, o) order by o loop
                v_problem := api._prop_value_problem(v_def, v_el);
                if v_problem is not null then
                    v_out := v_out || (v_key || ': ' || v_problem);
                    exit;
                end if;
            end loop;
        else
            v_problem := api._prop_value_problem(v_def, v_value);
            if v_problem is not null then
                v_out := v_out || (v_key || ': ' || v_problem);
            end if;
        end if;
    end loop;
    return v_out;
end
$$;

-- A property value from free text (a fact label's value), or null when it
-- can't be read as that kind. Places and entities match an id, or one
-- node's exact name.
create or replace function api._property_coerce(p_def jsonb, p_text text) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_kind text := p_def ->> 'kind';
    v_text text := btrim(coalesce(p_text, ''));
    v_value jsonb;
    v_types text[];
    v_ids text[];
begin
    if v_text = '' then
        return null;
    end if;
    if v_kind = 'number' then
        if replace(v_text, ',', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then
            v_value := to_jsonb(replace(v_text, ',', '')::numeric);
        end if;
    elsif v_kind = 'choice' then
        select to_jsonb(c ->> 'key') into v_value
        from jsonb_array_elements(p_def -> 'choices') c
        where lower(c ->> 'key') = lower(v_text) or lower(c ->> 'label') = lower(v_text)
        limit 1;
    elsif v_kind in ('place', 'entity') then
        v_types := case when v_kind = 'place' then array['region']
                        when jsonb_array_length(coalesce(p_def -> 'entity_types', '[]')) > 0
                        then array(select jsonb_array_elements_text(p_def -> 'entity_types')) end;
        select array_agg(n.id) into v_ids
        from node n
        where (n.id = v_text or lower(n.name) = lower(v_text))
          and (v_types is null or n.type = any(v_types));
        if cardinality(v_ids) = 1 then
            v_value := to_jsonb(v_ids[1]);
        end if;
    else
        v_value := to_jsonb(v_text);
    end if;
    if v_value is null then
        return null;
    end if;
    if coalesce((p_def ->> 'multiple')::boolean, false) then
        v_value := jsonb_build_array(v_value);
    end if;
    if (select cardinality(array_remove(array(
            select api._prop_value_problem(p_def, e)
            from jsonb_array_elements(case when jsonb_typeof(v_value) = 'array' then v_value
                                           else jsonb_build_array(v_value) end) e), null))) > 0 then
        return null;
    end if;
    return v_value;
end
$$;

-- ---------------------------------------------------------------------------
-- Derived (read-only) values for regions, sectors, stories and forecasts,
-- from their side tables. Other types have none.
-- ---------------------------------------------------------------------------
create or replace function api._derived_properties(p_id text, p_type text default null) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_type text := p_type;
    v_out jsonb;
begin
    if v_type is null then
        select n.type into v_type from node n where n.id = p_id;
    end if;
    if v_type = 'region' then
        select jsonb_strip_nulls(jsonb_build_object(
                   'level', r.level,
                   'iso_code', case when r.level in ('country', 'bloc') then r.iso2
                                    when r.level = 'state' then r.code end,
                   'parent', r.parent_id,
                   'country', case when r.level = 'city' then r.country_id end,
                   'population', r.population,
                   'continent', r.continent,
                   'subregion', r.subregion))
        into v_out
        from region r where r.node_id = p_id;
    elsif v_type = 'sector' then
        select jsonb_build_object('entity_count', count(*)) into v_out
        from edge e where e.dst = p_id and e.type = 'in_sector';
    elsif v_type = 'story' then
        select jsonb_strip_nulls(jsonb_build_object(
                   'kind', s.kind,
                   'event_type', s.event_type,
                   'impact', s.impact,
                   'direction', s.direction,
                   'magnitude', s.magnitude,
                   'horizon', s.horizon,
                   'confidence', round(s.confidence::numeric * 100),
                   'importance', round(s.importance::numeric, 1),
                   'first_seen', to_char(s.first_seen at time zone 'UTC', 'YYYY-MM-DD'),
                   'sectors', case when cardinality(s.sectors) > 0
                                   then to_jsonb(array(select 'sector:' || x from unnest(s.sectors) as x)) end,
                   'region', s.primary_region))
        into v_out
        from story s where s.node_id = p_id;
    elsif v_type = 'forecast' then
        select jsonb_strip_nulls(jsonb_build_object(
                   'provider', fp.name,
                   'category', f.category,
                   'probability', round(l.probability::numeric * 100),
                   'end_date', to_char(f.end_date at time zone 'UTC', 'YYYY-MM-DD'),
                   'status', f.status,
                   'volume', l.volume,
                   'volume_unit', f.volume_unit))
        into v_out
        from forecast f
        join forecast_provider fp on fp.id = f.provider
        left join lateral (
            select fs.probability, fs.volume from forecast_snapshot fs
            where fs.forecast_id = f.node_id order by fs.ts desc limit 1
        ) l on true
        where f.node_id = p_id;
    end if;
    return coalesce(v_out, '{}'::jsonb);
end
$$;

-- Every property value of a node: stored ones and derived ones.
create or replace function api._node_values(p_id text) returns jsonb
language sql stable set search_path = public, extensions as $$
    select n.properties || api._derived_properties(n.id, n.type) from node n where n.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Display
-- ---------------------------------------------------------------------------

-- 1234567 → "1,234,567"; 2.50 → "2.5".
create or replace function api._fmt_number(p_value numeric) returns text
language sql immutable set search_path = pg_catalog as $$
    select case
        when p_value is null then null
        when p_value = trunc(p_value) then to_char(p_value, 'FM999,999,999,999,999,999,990')
        else rtrim(rtrim(to_char(round(p_value, 3), 'FM999,999,999,999,999,999,990.999'), '0'), '.')
    end
$$;

-- "2024" → "2024", "2024-03" → "Mar 2024", "2024-03-05" → "5 Mar 2024".
create or replace function api._fmt_date(p_text text) returns text
language sql immutable set search_path = pg_catalog as $$
    select case
        when p_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then to_char(p_text::date, 'FMDD Mon YYYY')
        when p_text ~ '^[0-9]{4}-[0-9]{2}$' then to_char((p_text || '-01')::date, 'Mon YYYY')
        else p_text
    end
$$;

-- One Property for api.entity: {key, label, kind, value, display, unit,
-- derived, entity, entities}. `entity` is the node a single place or
-- entity value names; `entities` lists them for a multiple one.
create or replace function api._property_item(p_def jsonb, p_value jsonb, p_values jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_kind text := p_def ->> 'kind';
    v_multiple boolean := coalesce((p_def ->> 'multiple')::boolean, false);
    v_unit text := coalesce(p_def ->> 'unit', p_values ->> (p_def ->> 'unit_key'));
    v_elements jsonb := case when jsonb_typeof(p_value) = 'array' then p_value
                             else jsonb_build_array(p_value) end;
    v_display text;
    v_refs jsonb;
begin
    if p_value is null or jsonb_typeof(p_value) = 'null' then
        return null;
    end if;
    select string_agg(
               case
                   when v_kind = 'number' and jsonb_typeof(e) = 'number' then
                       api._fmt_number((e #>> '{}')::numeric)
                       || case when v_unit is null then ''
                               when v_unit = '%' then '%'
                               else ' ' || v_unit end
                   when v_kind = 'date' then api._fmt_date(e #>> '{}')
                   when v_kind = 'choice' then coalesce(
                       (select c ->> 'label' from jsonb_array_elements(p_def -> 'choices') c
                        where c ->> 'key' = e #>> '{}' limit 1),
                       e #>> '{}')
                   when v_kind = 'url' then regexp_replace(e #>> '{}', '^https?://(www\.)?([^/?#]+).*$', '\2')
                   when v_kind in ('place', 'entity') then coalesce(
                       (select n.name from node n where n.id = e #>> '{}'), e #>> '{}')
                   else e #>> '{}'
               end, ', ' order by o)
    into v_display
    from jsonb_array_elements(v_elements) with ordinality as x(e, o);

    if v_kind in ('place', 'entity') then
        select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'type', n.type) order by x.o),
                        '[]'::jsonb)
        into v_refs
        from jsonb_array_elements_text(v_elements) with ordinality as x(id, o)
        join node n on n.id = x.id;
    end if;

    return jsonb_build_object(
        'key', p_def ->> 'key',
        'label', p_def ->> 'label',
        'kind', v_kind,
        'value', p_value,
        'display', coalesce(v_display, ''),
        'unit', case when v_kind = 'number' then v_unit end,
        'derived', coalesce((p_def ->> 'derived')::boolean, false),
        'entity', case when v_kind in ('place', 'entity') and not v_multiple then v_refs -> 0 end,
        'entities', case when v_kind in ('place', 'entity') and v_multiple then v_refs end);
end
$$;

-- The Property list for a node, ordered as its type defines them (only
-- the ones with a value). Stored keys the type doesn't define are left out.
create or replace function api._entity_properties(p_id text) returns jsonb
language sql stable set search_path = public, extensions as $$
    with v as (
        select n.type, api._node_values(n.id) as vals from node n where n.id = p_id
    )
    select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
    from (
        select d.ord, api._property_item(d.def, v.vals -> (d.def ->> 'key'), v.vals) as item
        from v
        join node_type nt on nt.key = v.type
        cross join lateral jsonb_array_elements(nt.properties) with ordinality as d(def, ord)
    ) x
    where item is not null
$$;

-- ---------------------------------------------------------------------------
-- Property filters: where: [{prop, op: eq|in|gte|lte|contains, value}]
-- ---------------------------------------------------------------------------

-- Checks the conditions for one node type and returns them with each
-- property's kind (raises a readable error for anything wrong).
create or replace function api._where_conditions(p_type text, p_where jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_cond jsonb;
    v_def jsonb;
    v_prop text;
    v_op text;
    v_value jsonb;
    v_kind text;
    v_multiple boolean;
    v_want text;
    v_out jsonb := '[]'::jsonb;
begin
    if p_where is null or jsonb_typeof(p_where) = 'null' then
        return v_out;
    end if;
    if jsonb_typeof(p_where) <> 'array' then
        raise exception 'where must be a list of {prop, op, value}';
    end if;
    if jsonb_array_length(p_where) > 10 then
        raise exception 'where takes at most 10 conditions';
    end if;
    for v_cond in select c from jsonb_array_elements(p_where) with ordinality as x(c, o) order by o loop
        if jsonb_typeof(v_cond) is distinct from 'object' or jsonb_typeof(v_cond -> 'prop') is distinct from 'string' then
            raise exception 'where: each condition needs prop, op and value';
        end if;
        v_prop := v_cond ->> 'prop';
        v_def := null;
        select d into v_def
        from node_type nt cross join lateral jsonb_array_elements(nt.properties) as d
        where nt.key = p_type and d ->> 'key' = v_prop;
        if v_def is null then
            raise exception 'Unknown property for %: %', p_type, v_prop;
        end if;
        v_op := v_cond ->> 'op';
        v_value := v_cond -> 'value';
        v_kind := v_def ->> 'kind';
        v_multiple := coalesce((v_def ->> 'multiple')::boolean, false);
        v_want := case when v_kind = 'number' then 'number' else 'string' end;
        if v_op is null or v_op not in ('eq', 'in', 'gte', 'lte', 'contains') then
            raise exception 'where: op must be eq, in, gte, lte or contains';
        end if;
        if v_value is null or jsonb_typeof(v_value) = 'null' then
            raise exception 'where: % needs a value', v_prop;
        end if;
        if v_op = 'in' then
            if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) not between 1 and 50
               or exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> v_want) then
                raise exception 'where: in needs a list of 1-50 values (% for %)',
                    case when v_want = 'number' then 'numbers' else 'text' end, v_prop;
            end if;
        elsif v_op in ('gte', 'lte') then
            if v_kind = 'number' then
                if jsonb_typeof(v_value) <> 'number' then
                    raise exception 'where: % on % needs a number', v_op, v_prop;
                end if;
            elsif v_kind = 'date' then
                if jsonb_typeof(v_value) <> 'string' or not api._valid_date(v_value #>> '{}') then
                    raise exception 'where: % on % needs a date (YYYY, YYYY-MM or YYYY-MM-DD)', v_op, v_prop;
                end if;
            else
                raise exception 'where: % works on numbers and dates only, and % is %', v_op, v_prop, v_kind;
            end if;
        elsif v_op = 'contains' then
            if not (v_kind = 'text' or v_multiple) then
                raise exception 'where: contains works on text and lists only, and % is %', v_prop, v_kind;
            end if;
            if jsonb_typeof(v_value) <> v_want then
                raise exception 'where: contains on % needs %', v_prop,
                    case when v_want = 'number' then 'a number' else 'text' end;
            end if;
        elsif jsonb_typeof(v_value) <> v_want then
            raise exception 'where: eq on % needs %', v_prop,
                case when v_want = 'number' then 'a number' else 'text' end;
        end if;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'prop', v_prop, 'op', v_op, 'value', v_value, 'kind', v_kind, 'multiple', v_multiple));
    end loop;
    return v_out;
end
$$;

-- Equal, the way a filter means it: numbers by value, text ignoring case,
-- ids and choices exactly.
create or replace function api._where_eq(p_a jsonb, p_b jsonb, p_kind text) returns boolean
language sql immutable set search_path = pg_catalog as $$
    select case
        when p_kind = 'number' then jsonb_typeof(p_a) = 'number' and jsonb_typeof(p_b) = 'number'
                                    and (p_a #>> '{}')::numeric = (p_b #>> '{}')::numeric
        when p_kind = 'text' then lower(p_a #>> '{}') = lower(p_b #>> '{}')
        else (p_a #>> '{}') = (p_b #>> '{}')
    end
$$;

-- Does one property value (a list for multiple properties) meet one condition?
create or replace function api._where_one(p_value jsonb, p_cond jsonb) returns boolean
language sql immutable set search_path = public, extensions as $$
    select case
        when p_value is null or jsonb_typeof(p_value) = 'null' then false
        else exists (
            select 1
            from jsonb_array_elements(case when jsonb_typeof(p_value) = 'array' then p_value
                                           else jsonb_build_array(p_value) end) as el
            where case p_cond ->> 'op'
                when 'eq' then api._where_eq(el, p_cond -> 'value', p_cond ->> 'kind')
                when 'in' then exists (select 1 from jsonb_array_elements(p_cond -> 'value') x
                                       where api._where_eq(el, x, p_cond ->> 'kind'))
                when 'gte' then case when p_cond ->> 'kind' = 'number'
                                     then jsonb_typeof(el) = 'number'
                                          and (el #>> '{}')::numeric >= (p_cond ->> 'value')::numeric
                                     else (el #>> '{}') collate "C" >= (p_cond ->> 'value') collate "C" end
                when 'lte' then case when p_cond ->> 'kind' = 'number'
                                     then jsonb_typeof(el) = 'number'
                                          and (el #>> '{}')::numeric <= (p_cond ->> 'value')::numeric
                                     else (el #>> '{}') collate "C" <= (p_cond ->> 'value') collate "C" end
                when 'contains' then case when p_cond ->> 'kind' = 'text'
                                          then strpos(lower(el #>> '{}'), lower(p_cond ->> 'value')) > 0
                                          else api._where_eq(el, p_cond -> 'value', p_cond ->> 'kind') end
                else false
            end)
    end
$$;

-- Do a node's values meet every condition?
create or replace function api._where_match(p_values jsonb, p_conds jsonb) returns boolean
language sql immutable set search_path = public, extensions as $$
    select coalesce(bool_and(api._where_one(p_values -> (c ->> 'prop'), c)), true)
    from jsonb_array_elements(coalesce(p_conds, '[]'::jsonb)) as c
$$;

-- The ids (in their order) of nodes of p_type that meet the conditions.
create or replace function api._where_filter(p_ids text[], p_type text, p_conds jsonb) returns text[]
language sql stable set search_path = public, extensions as $$
    select coalesce(array_agg(u.id order by u.ord), '{}')
    from unnest(p_ids) with ordinality as u(id, ord)
    join node n on n.id = u.id
    where n.type = p_type
      and api._where_match(n.properties || api._derived_properties(n.id, n.type), p_conds)
$$;

-- ===========================================================================
-- Backfill
-- ===========================================================================

-- (1) Facts whose label names a property (props.facts as {label: value} or
-- [{label, value}]) move into properties when the value fits the
-- property's kind. Everything else stays in props.facts, and `wg kg
-- review` lists it in docs/kg-review.md.
create temporary table _kg_fact_map (type text, label text, key text) on commit drop;
insert into _kg_fact_map (type, label, key) values
    ('organization', 'sector', 'sector'),
    ('organization', 'headquarters', 'headquarters'),
    ('organization', 'hq', 'headquarters'),
    ('organization', 'head office', 'headquarters'),
    ('organization', 'size', 'size'),
    ('organization', 'founded', 'founded'),
    ('organization', 'established', 'founded'),
    ('organization', 'website', 'website'),
    ('organization', 'web site', 'website'),
    ('organization', 'ticker', 'ticker'),
    ('organization', 'stock ticker', 'ticker'),
    ('person', 'role', 'role'),
    ('person', 'organisation', 'organization'),
    ('person', 'organization', 'organization'),
    ('commodity', 'unit', 'unit'),
    ('commodity', 'benchmark', 'benchmark'),
    ('commodity', 'hs code', 'hs_code'),
    ('commodity', 'hs', 'hs_code'),
    ('infrastructure', 'kind', 'kind'),
    ('infrastructure', 'type', 'kind'),
    ('infrastructure', 'capacity', 'capacity'),
    ('infrastructure', 'capacity unit', 'capacity_unit'),
    ('infrastructure', 'operator', 'operator'),
    ('infrastructure', 'operated by', 'operator'),
    ('infrastructure', 'place', 'place'),
    ('infrastructure', 'location', 'place'),
    ('policy', 'issuer', 'issuer'),
    ('policy', 'issued by', 'issuer'),
    ('policy', 'effective date', 'effective_date'),
    ('policy', 'in force from', 'effective_date'),
    ('policy', 'status', 'status'),
    ('policy', 'applies to', 'scope'),
    ('policy', 'scope', 'scope'),
    ('indicator', 'unit', 'unit'),
    ('indicator', 'frequency', 'frequency'),
    ('indicator', 'source', 'source');

do $$
declare
    r record;
    v_moved text[];
begin
    for r in
        with facts as (
            select n.id, n.type, f.label, f.value
            from node n
            cross join lateral (
                select e.k as label, e.v #>> '{}' as value
                from jsonb_each(case when jsonb_typeof(n.props -> 'facts') = 'object'
                                     then n.props -> 'facts' else '{}'::jsonb end) as e(k, v)
                where jsonb_typeof(e.v) in ('string', 'number')
                union all
                select x ->> 'label', x ->> 'value'
                from jsonb_array_elements(case when jsonb_typeof(n.props -> 'facts') = 'array'
                                               then n.props -> 'facts' else '[]'::jsonb end) as x
                where jsonb_typeof(x) = 'object'
            ) f
            where n.props ? 'facts'
        ),
        matched as (
            select f.id, f.label, m.key, api._property_coerce(d.def, f.value) as value
            from facts f
            join _kg_fact_map m on m.type = f.type and m.label = lower(btrim(f.label))
            join node_type nt on nt.key = f.type
            cross join lateral jsonb_array_elements(nt.properties) as d(def)
            where d.def ->> 'key' = m.key
        )
        select id, jsonb_object_agg(key, value) as props, array_agg(label) as labels
        from (select distinct on (id, key) id, key, value, label
              from matched where value is not null order by id, key, label) ok
        group by id
    loop
        update node n set
            properties = r.props || n.properties,
            props = case
                when jsonb_typeof(n.props -> 'facts') = 'object' then
                    case when (n.props -> 'facts') - r.labels = '{}'::jsonb then n.props - 'facts'
                         else jsonb_set(n.props, '{facts}', (n.props -> 'facts') - r.labels) end
                else
                    case when (select count(*) from jsonb_array_elements(n.props -> 'facts') x
                               where not (x ->> 'label' = any(r.labels))) = 0 then n.props - 'facts'
                         else jsonb_set(n.props, '{facts}', (
                             select jsonb_agg(x) from jsonb_array_elements(n.props -> 'facts') x
                             where not (coalesce(x ->> 'label', '') = any(r.labels)))) end
            end
        where n.id = r.id;
    end loop;
end
$$;

-- (2) Values the graph already holds in structured form (the sample-data
-- build fills the same ones; see seed/build.py `_auto_properties`).
-- Existing values win.
update node n set properties = jsonb_strip_nulls(jsonb_build_object(
        'sector', (
            select jsonb_agg('sector:' || s.v order by s.o)
            from jsonb_array_elements_text(case when jsonb_typeof(n.props -> 'sectors') = 'array'
                                                then n.props -> 'sectors' else '[]'::jsonb end)
                 with ordinality as s(v, o)
            where exists (select 1 from node sn where sn.id = 'sector:' || s.v and sn.type = 'sector')),
        'headquarters', (
            select to_jsonb(e.dst) from edge e join node r on r.id = e.dst and r.type = 'region'
            where e.src = n.id and e.type = 'located_in' order by e.id limit 1)
    )) || n.properties
where n.type = 'organization';

update node n set properties = jsonb_strip_nulls(jsonb_build_object(
        'hs_code', case when n.props ->> 'hs' ~ '^[0-9]{2,10}$' then to_jsonb(n.props ->> 'hs') end
    )) || n.properties
where n.type = 'commodity';

update node n set properties = jsonb_strip_nulls(jsonb_build_object(
        'kind', (
            select to_jsonb(c ->> 'key')
            from node_type nt cross join lateral jsonb_array_elements(nt.properties) as d(def)
            cross join lateral jsonb_array_elements(d.def -> 'choices') as c
            where nt.key = 'infrastructure' and d.def ->> 'key' = 'kind' and c ->> 'key' = n.subtype),
        'place', (
            select to_jsonb(e.dst) from edge e join node r on r.id = e.dst and r.type = 'region'
            where e.src = n.id and e.type = 'located_in' order by e.id limit 1)
    )) || n.properties
where n.type = 'infrastructure';

update node n set properties = jsonb_strip_nulls(jsonb_build_object(
        'scope', (
            select jsonb_agg(e.dst order by e.id) from edge e join node r on r.id = e.dst and r.type = 'region'
            where e.src = n.id and e.type = 'about')
    )) || n.properties
where n.type = 'policy';

update node n set properties = jsonb_strip_nulls(jsonb_build_object(
        'unit', nullif(btrim(i.unit), ''),
        'frequency', i.frequency,
        'source', nullif(btrim(i.source_name), '')
    )) || n.properties
from indicator_series i
where i.node_id = n.id and n.type = 'indicator';

-- ===========================================================================
-- The check: wrong kinds, unknown choices, broken entity references and
-- missing required values are refused (SQLSTATE 23514, check_violation).
-- ===========================================================================
create or replace function public.node_properties_valid() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_problems text[];
begin
    -- Fast path: nothing stored and nothing required (every story and
    -- forecast the pipeline writes).
    if new.properties = '{}'::jsonb and not exists (
        select 1 from node_type nt cross join lateral jsonb_array_elements(nt.properties) as d
        where nt.key = new.type and coalesce((d ->> 'required')::boolean, false)) then
        return new;
    end if;
    v_problems := api._property_problems(new.type, new.properties);
    if cardinality(v_problems) > 0 then
        raise exception 'Invalid properties for % (%): %', new.id, new.type, array_to_string(v_problems, '; ')
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger node_properties_valid
    before insert or update of type, properties on node
    for each row execute function public.node_properties_valid();

-- ===========================================================================
-- The website's read-only role (0014's pattern) reads the new tables.
-- ===========================================================================
do $$
declare
    t text;
begin
    foreach t in array array['app_flag', 'node_type'] loop
        execute format('grant select on public.%I to wg_web_reader', t);
        execute format('drop policy if exists web_reader_read on public.%I', t);
        execute format(
            'create policy web_reader_read on public.%I for select to wg_web_reader using (true)', t);
    end loop;
end
$$;
grant execute on all functions in schema api to wg_web_reader;
