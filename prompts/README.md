# Prompts

One set of AI instructions and output schemas, used by both AI engines:

| Engine | Where it runs | How it uses these files |
| --- | --- | --- |
| Test link (claude.ai Artifact) | The viewer's own Claude account, only while the app is open (`sample` capability) | The prompt text plus the data, as one message; the reply is parsed as JSON and checked. An Ask follow-up is a short chat instead: the prompt, the earlier questions and answers, then the data |
| Website (after deployment) | Claude API, with a daily spending cap | The prompt as the system prompt (cached), the data as the user message, and the schema as the structured-output format. An Ask follow-up puts the earlier questions and answers before the data, as user and assistant messages |

Ask is a conversation: a follow-up carries the last 6 earlier turns (each the question and a short text of the answer, trimmed; `frontend/src/ai/history.ts`), so "what about India?" reads against the question before it. The data's `about` names the place or story Ask was opened from, and the answer's `read_as` says how the question was understood.

| Task | Prompt | Output schema | Checked again by |
| --- | --- | --- | --- |
| Story analysis (headline, why it matters, actions, causes) | `analysis.md` | `analysis.schema.json` | `AnalysisItem` in `frontend/src/api/contract.ts`, `pipeline/analysis.py`, `api.save_analysis` in SQL |
| Ask (answers from stored data only, with citations) | `ask.md` | `ask.schema.json` | the Ask screen |
| Project next effects (clearly labelled projections) | `projection.md` | `projection.schema.json` | the cascade screen |

Rules shared by all prompts: use only the data given, keep facts, inferences and forecasts apart, never name private individuals, and never give investment, trading or betting advice.

Schemas keep to the JSON Schema subset that structured outputs accept, so word limits and number ranges are checked in code after each call.
