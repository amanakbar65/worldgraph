# App bugs for Phase A screens part 2 (found by the e2e suite, 29 Oct)

Each is marked test.fail() in frontend/e2e; fix it and remove the marker.

1. Phone: an open details sheet blocks every tap outside it. vaul 1.1.2 leaves `pointer-events: none` on body. Fix: after open, `requestAnimationFrame(() => document.body.style.pointerEvents = "")`. Files: frontend/src/app/PanelHost.tsx. Tests: search.spec.ts (4 phone tests).
2. The logo pressed on another screen lands on the globe but doesn't start the slow turn (the home request arrives before map load; IdleSpin.home() is dropped while `allowed` is false). Fix: keep a pending home request and replay it on load. Files: features/globe/GlobeMap.tsx, idle-spin.ts. Tests: home.spec.ts.
3. The status pill says "Sample data" while Sample data is off. Fix: `showingSample = sample !== "off" && meta.showing_sample`. File: app/StatusBar.tsx. Tests: settings.spec.ts.
4. Phone: Escape in the cascade evidence closes the whole sheet. Fix: `onEscapeKeyDown={(e) => e.preventDefault()}` on Drawer.Content (the app's own Escape steps back one panel). File: app/PanelHost.tsx. Tests: story-cascade.spec.ts.
5. Loading placeholders put aria-label on a div with no role (axe aria-prohibited-attr, serious). Fix: role="status" on the ~31 aria-busy blocks (StoryPanel, PanelHost, CascadePanel, EntityPanel, GraphView, OpportunityRadar, AffectsFeed…). Tests: a11y.spec.ts "accessibility while loading".
6. Desktop: the cascade's story card opens with its last line under the diagram key (bottom margin 24 px vs key ~46 px). File: features/story/cascade-layout.ts.
7. A sample forecast says "on any trading day": change to "on any business day" in backend/src/worldgraph/seed/storylines/brazil-coffee-frost.yaml.
8. Test link, Sample data on, connector missing or not allowed: a story the snapshot lacks says "This view needs live data" instead of the connector's own fix. Make LiveWithSnapshot rethrow the live error when the snapshot lacks the call (src/api/client.ts).

Also: remove the unused deps h3-js and @deck.gl/aggregation-layers; fix the stale "hex heat" comment at contract.ts ~263.
