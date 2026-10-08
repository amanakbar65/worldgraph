/**
 * The website's AI endpoint: POST /api/ai {task, input} → {data} | {error}.
 * Used by the Netlify function (netlify/functions/ai.mts).
 *
 * - Only "ask" and "projection" run here. "analysis" belongs to the
 *   pipeline job (backend/src/worldgraph/pipeline/analysis.py) and is refused.
 * - A daily budget (WG_AI_DAILY_BUDGET_USD, default US$2, UTC days) covers
 *   every AI call; analysis stops at 75% of it, so Ask and projections always
 *   keep at least the remaining 25%. Spend is read from and written to the
 *   llm_usage table, like the pipeline.
 * - Claude API via fetch (the SDK isn't a dependency): the shared prompt as
 *   a cached system prompt, the data as the user message, and the JSON
 *   schema as the structured-output format, at low effort.
 *
 * Status codes the browser engine understands: 402 budget, 429 busy,
 * 503 unavailable, 422 unreadable answer, 4xx/5xx otherwise failed.
 */

export type WebAiTask = "ask" | "projection";

export interface WebPrompt {
  prompt: string;
  schema: Record<string, unknown>;
}

/** The part of a pg Pool this handler uses. */
export interface AiDb {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  WG_AI_MODEL?: string;
  WG_AI_DAILY_BUDGET_USD?: string;
}

export interface AiDeps {
  db: AiDb;
  env: AiEnv;
  prompts: Record<WebAiTask, WebPrompt>;
  fetch: typeof fetch;
  /** Abort the Claude call after this long (the host's function limit is near). */
  timeoutMs?: number;
}

export interface AiResult {
  status: number;
  body: { data?: unknown; error?: string };
}

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_DAILY_BUDGET_USD = 2;
/** A conservative estimate for one Ask or projection call, checked before calling. */
export const EST_COST_PER_CALL_USD = 0.08;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INPUT_BYTES = 48 * 1024;
const API_URL = "https://api.anthropic.com/v1/messages";

/** US dollars per million tokens: input, output, cache read (cache writes cost 1.25 × input). */
export const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4.0, 20.0, 0.2],
  "claude-sonnet-5-5": [2.0, 10.0, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Cost of one call in US dollars, rounded to 5 places (as analysis.py). */
export function costUsd(model: string, usage: Usage): number {
  const [inPrice, outPrice, cachedPrice] = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const dollars =
    ((usage.input_tokens ?? 0) * inPrice +
      (usage.cache_creation_input_tokens ?? 0) * inPrice * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * cachedPrice +
      (usage.output_tokens ?? 0) * outPrice) /
    1e6;
  return Math.round(dollars * 1e5) / 1e5;
}

/** Models that take the server-side refusal fallback ("default" form). */
const takesFallbacks = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export async function spentTodayUsd(db: AiDb): Promise<number> {
  const { rows } = await db.query<{ spent: string | number }>(
    "select coalesce(sum(cost_usd), 0) as spent from llm_usage " +
      "where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'",
  );
  return Number(rows[0]?.spent ?? 0);
}

async function recordUsage(db: AiDb, model: string, task: WebAiTask, usage: Usage, cost: number): Promise<void> {
  await db.query(
    "insert into llm_usage (engine, model, purpose, input_tokens, output_tokens, cost_usd) " +
      "values ('api', $1, $2, $3, $4, $5)",
    [
      model,
      task,
      (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      usage.output_tokens ?? 0,
      cost,
    ],
  );
}

const fail = (status: number, error: string): AiResult => ({ status, body: { error } });

export async function handleAi(rawBody: string, deps: AiDeps): Promise<AiResult> {
  if (byteLength(rawBody) > MAX_BODY_BYTES) return fail(413, "Request too large.");
  let parsed: { task?: unknown; input?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { task?: unknown; input?: unknown };
  } catch {
    return fail(400, "Body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object") return fail(400, "Body must be a JSON object.");
  const { task, input } = parsed;
  if (task === "analysis") return fail(403, "Story analysis runs in the pipeline, not here.");
  if (task !== "ask" && task !== "projection") return fail(400, "Unknown task.");
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, "Input must be an object.");
  const data = JSON.stringify(input);
  if (byteLength(data) > MAX_INPUT_BYTES) return fail(413, "Too much data for one question.");

  const apiKey = deps.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "WorldGraph AI isn't set up yet.");
  const model = deps.env.WG_AI_MODEL?.trim() || DEFAULT_MODEL;
  const budgetRaw = Number(deps.env.WG_AI_DAILY_BUDGET_USD);
  const budget = Number.isFinite(budgetRaw) && budgetRaw >= 0 ? budgetRaw : DEFAULT_DAILY_BUDGET_USD;

  let spent: number;
  try {
    spent = await spentTodayUsd(deps.db);
  } catch {
    return fail(503, "WorldGraph AI isn't available right now.");
  }
  if (spent + EST_COST_PER_CALL_USD > budget) {
    return fail(402, "Today's AI allowance is used up. It resets at midnight UTC.");
  }

  const { prompt, schema } = deps.prompts[task];
  const fallbacks = takesFallbacks(model);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (fallbacks) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  const request = {
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: data }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    ...(fallbacks ? { fallbacks: "default" } : {}),
  };

  let response: Response;
  try {
    response = await deps.fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 25_000),
    });
  } catch {
    return fail(503, "WorldGraph AI didn't answer in time. Try again.");
  }
  if (response.status === 429) return fail(429, "WorldGraph AI is busy. Try again in a minute.");
  if (response.status >= 500) return fail(503, "WorldGraph AI isn't available right now.");
  if (!response.ok) return fail(500, "WorldGraph AI couldn't answer this request.");

  const message = (await response.json().catch(() => null)) as {
    model?: string;
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: Usage;
  } | null;
  if (!message) return fail(503, "WorldGraph AI isn't available right now.");

  const servedBy = message.model || model;
  if (message.usage) {
    try {
      await recordUsage(deps.db, servedBy, task, message.usage, costUsd(servedBy, message.usage));
    } catch {
      // The answer is still good; the next budget check may run slightly low.
    }
  }
  if (message.stop_reason === "refusal") return fail(502, "The AI declined this question.");
  if (message.stop_reason === "max_tokens") return fail(502, "The answer was too long. Ask something narrower.");
  const text = (message.content ?? []).find((b) => b.type === "text")?.text ?? "";
  try {
    return { status: 200, body: { data: JSON.parse(text) as unknown } };
  } catch {
    return fail(422, "The AI answer couldn't be read.");
  }
}
