# WorldGraph: knowledge graph upgrade

This file adds features to the knowledge graph described in BUILD_BRIEF.md (the "Knowledge graph", "Entity pages" and cascade sections). Build on what already exists; don't replace it. If anything here conflicts with BUILD_BRIEF.md, ask me before choosing.

## Goal

Make the knowledge graph easy to see all at once, quick to dig into, and trustworthy. Three ideas run through every feature:

1. **Store once, view many ways.** Graph, table, canvas, timeline and globe all read the same nodes and edges. No copies.
2. **Every link means something and can be checked.** Links have a named relation, a source and a confidence.
3. **AI suggests, people approve.** Nothing AI-generated enters a user's graph without review, and AI-inferred links in the world graph stay clearly marked.

## Before you build

1. Read BUILD_BRIEF.md first, especially "How to work with me", the data model and the LLM cost controls. Those rules apply here too.
2. Explore the code. For each feature below, report whether it already exists, partly exists or is missing, and which files are involved.
3. Reuse the existing data model, graph store and renderer. Map new fields onto what's there instead of creating parallel tables.
4. Add this work to PLAN.md as new phases (A to E below). Wait for my approval before writing code.
5. Build one phase at a time. After each phase: run the build and tests, show me how to try it with sample data, update PLAN.md, then stop for my review.

## Rules for every new feature

- Database migrations are additive and reversible. Existing nodes and edges keep working with sensible defaults (relation = "related to", confidence = unknown).
- Put each feature behind a feature flag so it can be switched off.
- Follow the design rules in BUILD_BRIEF.md: visual-first, little text, calm, colour-blind-safe. Prefer chips, icons and line styles over paragraphs.
- Never show meaning with colour alone. Pair it with an icon, shape or line style.
- Keep the existing link styles: solid = reported, dashed = inferred, dotted = projected. Unaccepted AI suggestions get their own style (faint and thin, with a small "+" marker) and stay hidden unless "Suggestions" is switched on.
- Keep personal and world data separate. User actions (notes, canvases, accepted suggestions, imports) only change that user's private graph. The shared world graph changes only through the data pipeline.
- No new paid API or service without asking me first. AI features must use the existing cost controls (caching, batching, daily budget).
- Write tests for the data logic: type properties, relation rules, provenance, loop detection, what-if spreading and "as of" queries.

## Data model additions (sketch: adapt names to the existing schema)

- **Node types:** key, label, icon, colour, and property definitions (name; kind: text, number, date, choice, URL, place or entity link; required or not).
- **Nodes:** add `properties` (validated against the node's type) and `aliases`.
- **Relation types:** key, label, inverse label (for example "supplies" / "supplied by"), whether it's causal, and which node types it can connect.
- **Edges:** add `relation`; for causal links, `polarity` (+ increases, − decreases), `strength` (0 to 1) and an optional `delay` flag; plus `valid_from` and `valid_to`.
- **Provenance on every node and edge:** sources (source id, snippet, date), confidence (0 to 1), link kind (reported, inferred, projected, user or AI-suggested), created by, created at, updated at.
- **Change log** (append-only): entity, entity id, operation, before, after, time, actor.
- **Saved lenses:** owner, name, lens type, filters, focus node, time range, layout.
- **Canvases** and **canvas items:** canvas id, node id, position, size, collapsed.
- **Suggestions** (review queue): kind (node, edge or merge), payload, sources, confidence, status (pending, accepted or rejected).
- **Clusters:** level, label, member count, computed at; plus which nodes belong to which cluster at each level.

---

## Phase A — Structure and trust

Everything else depends on this phase, so build it first.

### A1. Properties for each node type (upgrade, like Tana supertags)
- Each node type gets its own fields. Examples: Company (sector, HQ, size), Commodity (unit, benchmark price), Policy (issuer, effective date).
- Entity pages show properties as key-fact chips. Filters and the table lens (B3) use them.
- **Done when:** properties validate against their type, appear on entity pages and can be filtered.

### A2. Named relations (upgrade)
- Replace free-text link labels with relation types. Each has an inverse label so the link reads naturally from both ends.
- Causal relations carry polarity (+/−) and an optional delay flag. Keep the short mechanism label from the brief as display text.
- Map existing labels to the closest relation type. Anything unmatched becomes "related to" and goes on a list for me to review.
- **Done when:** every edge has a relation type, entity pages group links by relation, and links can be filtered by relation.

### A3. Sources on everything (upgrade)
- Extend the cascade view's "evidence on tap" to every node and edge in the graph.
- A "Why is this here?" panel shows sources, snippet, date, confidence, link kind and what added it.
- Unsourced or low-confidence items get a subtle badge. The minimum-confidence filter works in every lens.
- **Done when:** tapping any node or edge shows its provenance, and new items can't be saved without it.

### A4. History and "as of" dates (new)
- Record every change in the change log.
- Add an API that returns the graph, or part of it, as it was on a given date, using the change log and each edge's valid dates.
- **Done when:** tests confirm an "as of" query matches the graph on that date, and undo works for user edits.

### A5. Schema map (new, small)
- A small view showing node types as bubbles and relation types as links between them, with counts.
- **Done when:** it reflects the live schema and each type opens its table (B3).

---

## Phase B — Lenses: same data, different views

### B1. Focus mode (upgrade of the local graph, like TheBrain)
- The selected node sits in the centre with its neighbours around it, and each link shows its relation.
- Tap a neighbour to re-centre with a smooth animation. Back and forward buttons. Keep the 1 to 3 depth slider.
- Filter by relation type and direction (incoming or outgoing). Pin nodes so they stay in place.
- **Done when:** re-centring feels instant (under about 300 ms) and never shows more than the chosen depth.

### B2. Semantic zoom for the global graph (new)
- Group nodes into clusters on the server at 2 or 3 levels (Leiden or Louvain), refreshed on a schedule.
- Zoomed out: labelled cluster bubbles, sized by how many nodes they hold. Halfway: hub nodes. Zoomed in: every node with labels.
- Tap a cluster to zoom into it. Labels come from each cluster's top members; an optional AI-written label is cached.
- **Done when:** the global graph stays readable at every zoom level with the full dataset loaded.

### B3. Table lens (new, like Obsidian Bases or Notion)
- Pick a node type to see all its nodes as a table, one column per property.
- Sort, filter and group. Edit fields the user owns inline. Tap a row to open it in focus mode.
- **Done when:** 10,000 rows scroll smoothly and the filters match the graph's filters.

### B4. Canvas lens (new, like Heptabase)
- Personal whiteboards where users drag entity cards around and arrange them.
- Cards are live references to nodes, not copies, so edits show up everywhere.
- Drawing a line between two cards creates an edge in the user's personal graph, with a relation picker.
- **Done when:** users can create, rename and delete boards, and everything persists.

### B5. Timeline lens (new)
- Show any selection on a zoomable timeline: events by date, relationships by the period they were true.
- Selecting a time range filters the other lenses.
- **Done when:** the timeline and graph stay in sync in both directions.

### B6. Globe link (new)
- "Show on globe" for any graph selection, using each node's place.
- Selecting a region on the globe filters the graph to that region.
- **Done when:** selections stay in sync between globe and graph.

### B7. Saved lenses (new, like Tana search nodes)
- Save the current lens with its filters, focus node, time range and layout as a named view that updates live as data changes.
- Saved lenses appear in a sidebar and can be shared as read-only links.
- **Done when:** reopening a saved lens restores it exactly, with fresh data.

---

## Phase C — Cause and effect (extends cascades, like Kumu)

### C1. Feedback loops (new)
- Find cycles among causal links. An even number of "−" links makes a reinforcing loop; an odd number makes a balancing loop.
- Show loops as chips on entity pages and in the cascade view. Tapping a chip highlights the loop.
- **Done when:** detection is tested on known examples and runs quickly on the full causal graph.

### C2. What-if explorer (new)
- Pick a node and a direction (up or down). Spread the effect along causal links using polarity and strength, fading at each step, for up to 4 steps.
- Highlight affected nodes with an arrow (↑ or ↓) and a strength, and show the chain of links behind each effect.
- Label it clearly as a scenario, not a forecast. If it reaches a My Business node, show it in "Affects you".
- **Done when:** results match hand-checked examples in tests, and every highlighted node can show its chain.

### C3. Guided stories (new, optional)
- Build a short tour: a sequence of focus views, each with a one-line caption.
- Play it step by step, or share it as a read-only link.

---

## Phase D — AI helpers (people approve, costs controlled)

### D1. Add from documents (new)
- Paste a link, text or PDF. AI pulls out possible entities and relations, each tied to the snippet it came from.
- Match them against existing nodes (names, aliases, embedding similarity) to avoid duplicates, and propose merges.
- Everything lands in a review queue: accept, edit or reject. Accepted items join the user's personal graph with their sources.
- **Done when:** nothing reaches the graph without approval, and tests show duplicates being caught.

### D2. Ask the graph (upgrade of "Ask about this region")
- Answer questions from the graph: find relevant nodes (search plus embeddings), expand their neighbourhood, then answer.
- Every claim cites the nodes, links and sources it used, and that part of the graph is highlighted in the current lens.
- If the graph doesn't support an answer, say so.
- **Done when:** every answer's citations point to real nodes or sources.

### D3. Gaps and contradictions (new, like InfraNodus)
- An Insights panel listing: unsourced or low-confidence links; conflicting claims (sources disagree, or opposite-polarity links between the same pair); clusters on related topics with few links between them; items not updated for a set time.
- Each insight links straight to the items involved.
- **Done when:** each insight type is tested with sample data.

### D4. Suggested links (new)
- Suggest likely links from co-occurrence and embedding similarity, shown in the suggestion style only when "Suggestions" is on.
- One tap to accept (choosing a relation type) or dismiss. Never added automatically.

### D5. Summaries and mind maps (new, like NotebookLM)
- One-tap summary of a cluster, selection or region, with citations.
- A collapsible mind-map view of any cluster.
- Cache results and regenerate only when the underlying data changes.

---

## Phase E — Convenience, speed and access

### E1. Command palette (new)
- Ctrl+K opens fuzzy search across titles, aliases and properties, plus commands: focus on…, open lens…, show on globe, add note.

### E2. Time slider (upgrade of the time-lapse)
- Drag to any date to see the graph as it was then (uses A4). Play and pause.

### E3. Quick capture (new)
- Add a note or entity from anywhere, including on mobile.
- Optional voice note: transcribe it, then send it through the D1 review queue.

### E4. Import and export (new)
- Import an Obsidian vault into the personal graph: [[links]] become edges, frontmatter becomes properties.
- Export the personal graph or any saved lens as Markdown, CSV, JSON or GraphML.

### E5. Performance (ongoing)
- Smooth interaction with 10,000 visible nodes; usable with 100,000 in total.
- If the current renderer can't keep up, switch to a WebGL one. Run layout in a web worker, show labels by zoom level, load neighbourhoods on demand and virtualise long lists.

### E6. Accessibility (ongoing)
- Every visual lens has a list or table version.
- Full keyboard navigation, screen-reader labels and a reduced-motion setting.

### E7. Flag a problem (new)
- Users can flag a wrong link or fact in the world graph. Flags go to a moderation queue, and flagged items get a subtle marker until reviewed.

---

## Suggested order

A → B1, B2, B3 → C1, C2 → D1, D2, D3 → everything else.
