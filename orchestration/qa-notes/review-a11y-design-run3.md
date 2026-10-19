# review:a11y-design findings, QA run 3 (wf_5401d9b0-dd2), recovered from the agent's transcript

The reviewer was stopped by a usage limit on 15 Oct before it reported. Notes as last written at 2026-10-15T17:11:35.095Z. Each was reproduced by the reviewer, but it never finished checking them all, so re-verify before fixing.

# review:a11y-design findings (working notes)

- axe wcag2a/aa: 0 violations on globe, graph, forecasts, opportunities, business, brief at 1440 and 390, dark and light.
- Text sizes: 12/14/26 px only on every screen (radar SVG labels scale with viewBox).
- 390 px: no horizontal overflow on the 6 screens.
- [shell, major] Desktop panel open does not move focus; Settings -> 18 Tabs to reach panel (panels-kb.mjs). Close panel button -> focus to <body>.
- [search, major?] Ctrl+K then Escape -> focus to <body>, not back to prior element.
- [shell, minor] Status pill floats over scrolling content at 390 (forecasts-390-light.png covers first row ring).
- [graph, nit] Key: Projected and Conditional swatches identical (dotted).

## Also from the reviewer's messages (checked and passing)
- Colour literals are confined to tokens.css; no stray Tailwind palette classes.
- Motion: the globe turns by default and stops fully under reduced motion and under the calm setting (verified by diffing frames).
- Text contrast passes AA everywhere measured, including dark globe labels against real pixels.
- Panels are axe-clean (those it reached). The phone "More" menu and bottom sheet were checked.
- Search focus loss cause: the dialog content unmounts with no Radix trigger to return focus to.

## Not finished (redo these only)
1. Desktop cascade text after fit-to-view looked very small: measure the rendered px size.
2. Status pill: confirm whether it covers the last content at scroll end on the scrolling screens (390 px).
3. Touch targets under 40 px at phone width (count `::before` hit-area extensions).
4. Keyboard walk of the graph screen: is its list alternative reachable?
