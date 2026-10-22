-- Ask: "How does the Red Sea affect Indian exporters?" found the Sudanese
-- state called Red Sea and missed the Red Sea shipping story, because the
-- shipping route (infra:bab-el-mandeb) had no "Red Sea" alias and a stray
-- "sea" ("air and sea bookings") counted as much as the phrase. Now:
--
-- 1. infra:bab-el-mandeb is also known as "Red Sea" and "Red Sea route"
--    (here for the live database, and in seed/entities/infrastructure.yaml,
--    which the live entity matcher also reads);
-- 2. a state or city drops out of the entities when another kind of entity
--    matched the same words at least as well (the route beats the state);
-- 3. words that are part of a matched multi-word name ("red sea") match a
--    story's text only as that phrase, not one by one.
--
-- Everything else is api.ask_context as in 0006.

update node
set aliases = aliases || array['Red Sea', 'Red Sea route']
where id = 'infra:bab-el-mandeb' and not ('Red Sea' = any (aliases));

create or replace function api.ask_context(args jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
    v_qn text := btrim(regexp_replace(lower(left(coalesce(args ->> 'q', ''), 500)), '[^[:alnum:]]+', ' ', 'g'));
    v_limit integer := api._c_int(args -> 'limit', 12, 1, 25);
    v_sample boolean := api._use_sample(args);
    v_viewer text := api._viewer_country(args);
    v_words text[];
    v_res text[];
    v_queries tsquery[];
    v_ent_ids text[];
    v_ent_words text[];
    v_phrases text[];
    v_story_ids text[];
    v_stories jsonb;
    v_links jsonb;
    v_forecasts jsonb;
    v_pool_ids text[];
    v_pool_volume double precision[];
begin
    select coalesce(array_agg(t.w order by t.pos), '{}') into v_words
    from (
        select x.w, min(x.pos) as pos
        from regexp_split_to_table(v_qn, ' ') with ordinality as x(w, pos)
        where char_length(x.w) >= 3
          and x.w ~ '[[:alpha:]]'
          and x.w <> all(api._c_stop_words())
        group by x.w
        order by min(x.pos)
        limit 12
    ) t;
    if cardinality(v_words) = 0 then
        return jsonb_build_object('entities', '[]'::jsonb, 'stories', '[]'::jsonb,
                                  'links', '[]'::jsonb, 'forecasts', '[]'::jsonb);
    end if;
    -- Per word: a whole-word pattern (singular and plural) for names and
    -- titles, and a full-text query (null for English stop words).
    select array_agg(api._c_word_regex(w.w) order by w.ord),
           array_agg(case when length(to_tsvector('english'::regconfig, w.w)) > 0
                          then plainto_tsquery('english'::regconfig, w.w) end order by w.ord)
      into v_res, v_queries
    from unnest(v_words) with ordinality as w(w, ord);

    -- Forecasts this viewer may see.
    select coalesce(array_agg(p.id), '{}'), coalesce(array_agg(p.volume), '{}')
      into v_pool_ids, v_pool_volume
    from api._c_forecast_pool(v_viewer, v_sample) p;

    -- Entities: names or aliases that match a word, scored per (entity, word):
    --   1.0  the name equals the word, or a multi-word name appears in the question
    --   0.9  the word is the name plus a short ending ("indian" → India)
    --   0.8  the name's first word is the word ("crude" → Crude oil)
    --   0.6  the name contains the word ("oil" → Palm oil)
    --   0.4–0.7  the name starts with the word (four letters or more)
    --   similarity × 0.7  trigram similarity (candidates from pg_trgm's 0.3,
    --        kept from 0.4: below that they are mostly unrelated place names)
    -- For each word only the matches close to its best one are kept (within
    -- 0.2), so "red sea" keeps Red Sea and drops Redbridge. Each entity
    -- remembers the words it matched, and the multi-word names it matched as
    -- a phrase. A state or city is left out when an entity of another kind
    -- matched the same words at least as well ("Red Sea": the shipping route
    -- through Bab-el-Mandeb, not Sudan's Red Sea state).
    with words as (
        select * from unnest(v_words, v_res) as w(w, re)
    ),
    labels as (
        select n.id, n.name as label
        from words w
        join node n on n.type not in ('story', 'forecast')
                   and (n.name ilike w.w || '%' or n.name % w.w or n.name ~* w.re)
        union
        select n.id, a.alias
        from node n
        cross join lateral unnest(n.aliases) as a(alias)
        where n.aliases <> '{}'
          and n.type not in ('story', 'forecast')
          and exists (select 1 from words w
                      where a.alias ilike w.w || '%' or a.alias % w.w or a.alias ~* w.re)
    ),
    norm as (
        select l.id, btrim(regexp_replace(lower(l.label), '[^[:alnum:]]+', ' ', 'g')) as label
        from labels l
        join node n on n.id = l.id
        where n.type not in ('story', 'forecast', 'user_entity', 'indicator')
          and (v_sample or not n.is_sample)
    ),
    pairs as (
        select nm.id, w.w, nm.label,
               (position(' ' in nm.label) > 0
                and strpos(' ' || v_qn || ' ', ' ' || nm.label || ' ') > 0
                and strpos(' ' || nm.label || ' ', ' ' || w.w || ' ') > 0) as phrase,
               case
                   when nm.label = w.w then 1.0
                   when position(' ' in nm.label) > 0
                        and strpos(' ' || v_qn || ' ', ' ' || nm.label || ' ') > 0
                        and strpos(' ' || nm.label || ' ', ' ' || w.w || ' ') > 0 then 1.0
                   when char_length(nm.label) >= 4 and starts_with(w.w, nm.label)
                        and char_length(w.w) - char_length(nm.label) <= 3 then 0.9
                   when starts_with(nm.label, w.w || ' ') then 0.8
                   when strpos(' ' || nm.label || ' ', ' ' || w.w || ' ') > 0 then 0.6
                   when char_length(w.w) >= 4 and starts_with(nm.label, w.w)
                       then round(0.4 + 0.3 * char_length(w.w)::numeric
                                        / char_length(split_part(nm.label, ' ', 1)), 3)
                   when similarity(nm.label, w.w) >= 0.4
                       then round(similarity(nm.label, w.w)::numeric * 0.7, 3)
                   else 0
               end as score
        from norm nm
        cross join words w
    ),
    kept as (
        select p.id, p.w, p.label, p.phrase, p.score
        from (
            select p.*, max(p.score) over (partition by p.w) as best
            from pairs p
            where p.score > 0
        ) p
        where p.score > p.best - 0.2
    ),
    ranked as (
        select k.id, max(k.score) as score, array_agg(distinct k.w) as words,
               array_remove(array_agg(distinct case when k.phrase then k.label end), null) as phrases
        from kept k
        group by k.id
    ),
    typed as (
        select r.*, n.type, n.name, rg.level,
               coalesce(rg.level in ('state', 'city'), false) as local
        from ranked r
        join node n on n.id = r.id
        left join region rg on rg.node_id = n.id
    ),
    picked as (
        select t.id, t.words, t.phrases,
               row_number() over (order by t.score desc,
                                  case when t.level = 'country' then 0
                                       when t.type in ('commodity', 'organization', 'infrastructure', 'policy') then 1
                                       when t.level = 'bloc' then 1
                                       when t.type = 'sector' then 2
                                       when t.level = 'state' then 3
                                       else 4 end,
                                  length(t.name), t.id) as ord
        from typed t
        where not (t.local and exists (
            select 1 from typed o
            where not o.local and o.score >= t.score and o.words @> t.words))
    )
    select coalesce(array_agg(p.id order by p.ord), '{}'),
           coalesce(array_agg(array_to_string(p.words, ' ') order by p.ord), '{}'),
           coalesce((select array_agg(distinct x.phrase)
                     from picked q cross join lateral unnest(q.phrases) as x(phrase)
                     where q.ord <= 8), '{}')
      into v_ent_ids, v_ent_words, v_phrases
    from picked p
    where p.ord <= 8;

    -- A word inside a matched multi-word name matches story text only as
    -- that phrase: "red" and "sea" count for "Red Sea", not "sea bookings".
    if cardinality(v_phrases) > 0 then
        select array_agg(coalesce(
                   (select phraseto_tsquery('english'::regconfig, ph.p)
                    from unnest(v_phrases) as ph(p)
                    where strpos(' ' || ph.p || ' ', ' ' || w.w || ' ') > 0
                      and numnode(phraseto_tsquery('english'::regconfig, ph.p)) > 0
                    order by length(ph.p) desc, ph.p
                    limit 1),
                   w.q) order by w.ord)
          into v_queries
        from unnest(v_words, v_queries) with ordinality as w(w, q, ord);
    end if;

    -- Stories: hits per (story, word), ranked by words matched + importance / 100.
    -- Each hit carries the story's ranking columns, so only the page of
    -- winners is looked up again. Sample stories are excluded through the
    -- small set of sample ids.
    with ent as (
        select * from unnest(v_ent_ids, v_ent_words) as e(id, words)
    ),
    ent_hits(story_id, ent_id, importance, first_seen, status) as (
        select s.node_id, e.dst, s.importance, s.first_seen, s.analysis_status
        from edge e
        join story s on s.node_id = e.src
        where e.dst = any(v_ent_ids) and e.type = 'mentions'
        union all
        select s.node_id, s.country_id, s.importance, s.first_seen, s.analysis_status
        from story s where s.country_id = any(v_ent_ids)
        union all
        select s.node_id, s.admin1_id, s.importance, s.first_seen, s.analysis_status
        from story s where s.admin1_id = any(v_ent_ids)
        union all
        select s.node_id, s.primary_region, s.importance, s.first_seen, s.analysis_status
        from story s where s.primary_region = any(v_ent_ids)
    ),
    hits(story_id, w, importance, first_seen) as (
        select h.story_id, unnest(string_to_array(en.words, ' ')), h.importance, h.first_seen
        from ent_hits h
        join ent en on en.id = h.ent_id
        where h.status <> 'skipped'
        union all
        select s.node_id, w.w, s.importance, s.first_seen
        from unnest(v_words, v_queries) as w(w, q)
        join story s
          on to_tsvector('english'::regconfig, s.headline || ' ' || coalesce(s.so_what, '')) @@ w.q
        where w.q is not null
          and s.analysis_status <> 'skipped'
    ),
    story_rank as (
        select d.story_id, count(*) + max(d.importance)::numeric / 100 as rank, max(d.first_seen) as first_seen
        from (select distinct h.story_id, h.w, h.importance, h.first_seen from hits h) d
        group by d.story_id
    )
    select array_agg(t.story_id order by t.rank desc, t.first_seen desc nulls last, t.story_id)
      into v_story_ids
    from (
        select r.story_id, r.rank, r.first_seen
        from story_rank r
        where v_sample or r.story_id not in (select n.id from node n where n.is_sample)
        order by r.rank desc, r.first_seen desc nulls last, r.story_id
        limit v_limit
    ) t;
    v_story_ids := coalesce(v_story_ids, '{}');

    -- Stories with their newest sources (at most 3) and actions.
    select coalesce(jsonb_agg(c.card || jsonb_build_object(
               'sources', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'source_name', a.source_name, 'title', a.title, 'url', a.url,
                              'published_at', a.published_at)
                          order by a.published_at desc nulls last, a.id desc), '[]'::jsonb)
                   from (select * from article a
                         where a.story_id = i.id
                         order by a.published_at desc nulls last, a.id desc
                         limit 3) a),
               'actions', to_jsonb(s.actions))
           order by i.ord), '[]'::jsonb)
    into v_stories
    from unnest(v_story_ids) with ordinality as i(id, ord)
    join story s on s.node_id = i.id
    join api.story_card c on c.id = i.id;

    -- Causal links touching the returned stories: links between them first.
    with touching as (
        select cl.id from causal_link cl where cl.src_story = any(v_story_ids)
        union
        select cl.id from causal_link cl where cl.dst_story = any(v_story_ids)
    ),
    ok as (
        select cl.*,
               (cl.src_story = any(v_story_ids) and cl.dst_story = any(v_story_ids)) as inner_link
        from touching t
        join causal_link cl on cl.id = t.id
        join story ss on ss.node_id = cl.src_story
        join node sn on sn.id = cl.src_story
        join story ds on ds.node_id = cl.dst_story
        join node dn on dn.id = cl.dst_story
        where ss.analysis_status <> 'skipped'
          and ds.analysis_status <> 'skipped'
          and (v_sample or (not sn.is_sample and not dn.is_sample))
          and (cl.forecast_id is null or cl.forecast_id = any(v_pool_ids))
        order by inner_link desc, cl.confidence desc, cl.id
        limit 20
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ok.id,
               'src', ok.src_story,
               'dst', ok.dst_story,
               'link_type', ok.link_type,
               'mechanism', ok.mechanism,
               'direction', ok.direction,
               'confidence', round(ok.confidence::numeric, 3),
               'lag_days', ok.lag_days,
               'forecast_id', ok.forecast_id,
               'outcome', ok.outcome,
               'evidence', coalesce((
                   select jsonb_agg(jsonb_build_object(
                              'source_name', ev.source_name, 'url', ev.url,
                              'published_at', ev.published_at, 'snippet', ev.snippet,
                              'is_sample', ev.is_sample)
                          order by ev.published_at desc nulls last, ev.id)
                   from evidence ev where ev.causal_link_id = ok.id), '[]'::jsonb))
           order by ok.inner_link desc, ok.confidence desc, ok.id), '[]'::jsonb)
    into v_links
    from ok;

    -- Forecasts about the entities, or whose title or question uses the words.
    select api._c_cards(coalesce(array_agg(t.id order by t.ord), '{}')) into v_forecasts
    from (
        select p.id,
               row_number() over (order by h.about_hits + h.word_hits desc, p.volume desc nulls last, p.id) as ord
        from unnest(v_pool_ids, v_pool_volume) as p(id, volume)
        join forecast f on f.node_id = p.id
        cross join lateral (
            select (select count(distinct e.dst) from edge e
                    where e.src = p.id and e.type = 'about' and e.dst = any(v_ent_ids)) as about_hits,
                   (select count(*) from unnest(v_res) as w(re)
                    where f.short_title ~* w.re or f.question ~* w.re) as word_hits
        ) h
        where h.about_hits > 0 or h.word_hits > 0
    ) t
    where t.ord <= 6;

    return jsonb_build_object(
        'entities', api._c_entity_refs_ordered(v_ent_ids),
        'stories', v_stories,
        'links', v_links,
        'forecasts', v_forecasts);
end
$$;
