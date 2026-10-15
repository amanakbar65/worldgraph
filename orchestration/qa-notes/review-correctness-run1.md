# review:correctness — findings recovered from the interrupted run (15 Oct, wf_fe3c223c-34c)

Recovered from the agent's transcript after the 11:50 UTC session limit; each was reproduced by the reviewer before it was cut off.

- Setup: backend tests need `uv sync --group pipeline` (plain `uv sync` + pytest fails with ImportError feedparser in tests/pipeline/test_sources.py). The CLAUDE.md command omits the group. Checks otherwise: tsc OK, eslint OK, vitest 820/820, pytest 440 passed.

1. [major][story-cascade, forecasts, business] StoryPanel.tsx:56, ForecastPanel.tsx:68, StoryPanel.tsx:268 (CausesEffects) and AffectsFeed.tsx:397 use `if (query.isError)` without `&& !query.data`: one failed 60 s background poll replaces a loaded card with "The data is taking a moment". Reproduced by routing the API to 503 after load.
2. [major][shell] An unknown item id turns the status pill into "Not found: story:does-not-exist" with a warning icon instead of "Sample data"/"Live data", and the request is retried once because server/rpc.ts returns 500 for "Not found" and HttpSource maps 500 to the retryable "unavailable".
