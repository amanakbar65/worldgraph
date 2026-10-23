# Knowledge graph upgrade: what exists today (22 Oct 2026)

Checked against `docs/KNOWLEDGE_GRAPH_UPGRADE.md`. Key: ✅ exists, 🟡 partly, ❌ missing.
Paths: M = `backend/src/worldgraph/db/migrations`, F = `frontend/src`, G = `F/features/graph`, S = `F/features/story`.

**Current graph size**
- Live data: 5,448 entities. Of those, 5,317 are regions (gazetteer); there are 110 organisations, 29 commodities, 35 infrastructure, 13 policies and 9 sectors, plus about 4,500 live stories (pruned after 14 days).
- Seed (sample) edges: part_of 5,079, mentions 1,508, about 294, in_sector 279, located_in 145, produces 74, member_of 39, relates_to 26, owns 7, competes_with 6, depends_on 3.
- Causal links in the seed: 236.
- The graph is rich in places and stories but thin in companies, trade and ownership.

## Phase A: structure and trust
| # | Feature | Status | Where | Notes |
|---|---|---|---|---|
| A1 | Node types with properties | 🟡 | M/0001 `node.type` CHECK (11 types); F/lib/icons.ts `ENTITY_TYPE_ICONS`, F/lib/meaning.ts `ENTITY_TYPE_TONES`, G/graph-data.ts `TYPE_NAMES`; `node.props` (hs, icon, facts) | There is no type registry or property definitions in the database, and no validation (only the seed's Pydantic). The entity page shows up to 8 free-text "Key facts". `node.aliases` exists. |
| A2 | Named relations | 🟡 | M/0001 `edge.type` CHECK (14 types); G/graph-data.ts `RELATIONS` [label, inverse]; G/entity-data.ts `backlinkRelation`; M/0001 `causal_link` | Edge types are a fixed list. Labels and inverse labels exist only in TypeScript. No causal flag or endpoint rules. Causal links (story → story) have mechanism text, `direction`, `lag_days` and `confidence`, but no polarity or strength. The entity page groups only incoming links ("Linked from"). There is no relation filter. |
| A3 | Sources on everything | 🟡 | M/0001 `evidence` (causal links only), `article`, `source`; S/EvidenceDetails.tsx; G/GraphHoverCard.tsx | Only causal links have evidence. Edges have no source, confidence, created_by or updated_at. Graph links are hover-only (not tappable). There is no "Why is this here?". A minimum-confidence filter exists in the graph only (the globe has a fixed 0.5 floor; the cascade has none). |
| A4 | History and "as of" | ❌ | `edge.valid_from/valid_to` exist but are never used; P/prune.py hard-deletes | No change log, as-of API or undo. |
| A5 | Schema map | ❌ | | |

## Phase B: lenses
| # | Feature | Status | Where | Notes |
|---|---|---|---|---|
| B1 | Focus mode | 🟡 | G/GraphView.tsx `ScopeBar` (depth 1–3), G/GraphCanvas.tsx `centerNow`, F/state/nav.ts | Neighbourhood view and depth exist. Tapping opens a panel and does not re-centre. Scope is not in back/forward history. No relation or direction filter, and no pinning. |
| B2 | Semantic zoom | ❌ | G/GraphCanvas.tsx (react-force-graph-2d, canvas, main-thread d3-force) | Labels already scale with zoom. Caps: 250 nodes (100 on phones), up to 1,000. There is no clustering, and a WebGL renderer will be needed. |
| B3 | Table lens | 🟡 | G/GraphList.tsx | An accessible list (top 40, with "show more"). No table or virtualisation. |
| B4 | Canvas | ❌ | | React Flow is already a dependency (cascade). |
| B5 | Timeline | 🟡 | G/EntityPanel.tsx `TimelineSection`; G/use-timelapse.ts | Per-entity timeline and a graph time-lapse scrubber exist; there is no timeline lens. |
| B6 | Globe link | 🟡 | G/use-graph-nav.ts `showOnMap` | Entity → map works one way. A globe region doesn't filter the graph. Time window and sectors are shared. |
| B7 | Saved lenses | 🟡 | F/state/nav.ts hash deep links | Deep links exist, but graph scope and filters aren't in them. No saved views. |

## Phase C: cause and effect
| # | Feature | Status | Where | Notes |
|---|---|---|---|---|
| C1 | Feedback loops | ❌ | M/0005 `api.cascade` (1–3 hops, ≤60 nodes); M/0006 `save_analysis` guards only 2-cycles | Links are story → story, and stories expire after 14 days. |
| C2 | What-if | 🟡 | M/0006 `api.affects` (2 hops, 0.85 fade, unsigned); F/features/business/AffectsFeed.tsx | The fading spread and the "Affects you" rendering exist. Signs (polarity) are missing. |
| C3 | Guided stories | ❌ | | |

## Phase D: AI helpers
| # | Feature | Status | Where | Notes |
|---|---|---|---|---|
| D1 | Add from documents | ❌ | P/analysis.py, P/entities.py `EntityMatcher` (names and aliases) | Pipeline extraction exists, but there is no user upload and no review queue (AI output is published, labelled). |
| D2 | Ask the graph | 🟡 | M/0019 `api.ask_context` (lexical); prompts/ask.md; F/features/ask/* | Answers cite stories and say "not enough evidence" when true. They can't cite nodes or links, and nothing is highlighted in a lens. |
| D3 | Gaps and contradictions | ❌ | | |
| D4 | Suggested links | ❌ | P/embed.py (local, free, stories only) | |
| D5 | Summaries and mind maps | ❌ | M/0004 `api.brief` (rule-based) | |

## Phase E: convenience
| # | Feature | Status | Where | Notes |
|---|---|---|---|---|
| E1 | Command palette | 🟡 | F/features/search/CommandSearch.tsx (cmdk + api.search) | Searches names, aliases and ISO codes; commands: screens, Ask, theme, settings. Doesn't search properties; no "focus on", "show on globe" or "add note". |
| E2 | Time slider | 🟡 | G/use-timelapse.ts, globe replay | Replays loaded data; there's no "as of". |
| E3 | Quick capture | 🟡 | G/EntityNotes.tsx (private notes with [[links]]) | Notes exist per entity only. Their [[links]] don't become edges. |
| E4 | Import and export | 🟡 | brief `briefAsText` only | |
| E5 | Performance | 🟡 | caps and label budget | Canvas renderer, main-thread layout, no virtual lists. |
| E6 | Accessibility | 🟡 | GraphList, calm setting | List alternative exists. No keyboard moves between nodes. |
| E7 | Flag a problem | ❌ | | |

**Cross-cutting**
- **Feature flags:** none yet. There is only the build-time `__WG_TARGET__`.
- **Personal data:** lives in per-viewer storage (Artifact `data/users/<id>`, or the browser on the website), not in Postgres.
- **AI costs:** web reserve-then-settle at $2 a day (M/0015, `frontend/server/ai.ts`); the pipeline uses 75% of it, batched, with prompt caching. There is no result cache yet.
