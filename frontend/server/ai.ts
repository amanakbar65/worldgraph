/**
 * The website's AI endpoint: POST /api/ai {task, input, history?} → {data} | {error}.
 * Used by the Netlify function (netlify/functions/ai.mts).
 *
 * - `history` (Ask only): the conversation's earlier turns, oldest first, at
 *   most 6 {question, answer} (src/ai/history.ts has the limits). They go to
 *   Claude as earlier user and assistant messages before the data, so a
 *   follow-up such as "what about India?" reads against the last question.
 * - Only "ask" and "projection" run here. "analysis" belongs to the
 *   pipeline job (backend/src/worldgraph/pipeline/analysis.py) and is refused.
 * - A daily budget (WG_AI_DAILY_BUDGET_USD, default US$2, UTC days) covers
 *   every AI call; analysis stops at 75% of it, so Ask and projections always
 *   keep at least the remaining 25%. Spend lives in the llm_usage table, like
 *   the pipeline's. Before calling Claude, api._ai_reserve logs the call at
 *   its worst-case cost, under a lock, and refuses it if that would pass the
 *   budget; after the reply, api._ai_settle swaps in the real cost (migration
 *   0015). A call that times out keeps its worst-case cost, and if the
 *   reservation can't be written, Claude isn't called (fail closed).
 * - Claude API via fetch (the SDK isn't a dependency): the shared prompt as
 *   a cached system prompt, the data as the user message, and the JSON
 *   schema as the structured-output format, at low effort.
 *
 * Status codes the browser engine understands: 402 budget, 429 busy,
 * 503 unavailable, 422 unreadable answer, 4xx/5xx otherwise failed.
 */

import { MAX_TURNS, parseHistory } from "../src/ai/history";

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
/**
 * The longest answer one call may produce. An Ask or projection answer is a
 * few hundred tokens of JSON; the rest leaves room for low-effort thinking,
 * which counts against max_tokens. It also bounds the worst-case cost.
 */
export const MAX_OUTPUT_TOKENS = 8000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INPUT_BYTES = 48 * 1024;
const API_URL = "https://api.anthropic.com/v1/messages";

/** US dollars per million tokens: input, output, cache read (cache writes cost 1.25 × input). */
export const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4.0, 20.0, 0.2],
  "claude-sonnet-5-5": [2.0, 10.0, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  // Where the server-side refusal fallback may send a declined request.
  "claude-opus-5": [5.0, 25.0, 0.5],
  "claude-opus-4-8": [5.0, 25.0, 0.5],
};
/** The dearest fallback model's prices (claude-opus-5 / claude-opus-4-8). */
const FALLBACK_PRICES: [number, number, number] = [5.0, 25.0, 0.5];

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** With refusal fallbacks: one entry per attempt (the source of truth for billing). */
  iterations?: (Usage & { type?: string; model?: string })[] | null;
}

/** Cost of one attempt in US dollars, rounded to 5 places (as analysis.py). */
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

const inputTokens = (u: Usage) =>
  (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

/**
 * What a reply cost in total. After a refusal fallback, the top-level usage
 * covers only the attempt that answered, so each attempt in
 * `usage.iterations` is priced at its own model's rates: the declined one at
 * the requested model's, the fallback at the model that answered.
 */
export function replyCost(
  requested: string,
  servedBy: string,
  usage: Usage,
): { cost: number; input: number; output: number } {
  const attempts = Array.isArray(usage.iterations) && usage.iterations.length > 0 ? usage.iterations : null;
  if (!attempts) {
    return { cost: costUsd(servedBy, usage), input: inputTokens(usage), output: usage.output_tokens ?? 0 };
  }
  let cost = 0;
  let input = 0;
  let output = 0;
  for (const a of attempts) {
    const model = a.model || (a.type === "fallback_message" ? servedBy : requested);
    cost += costUsd(model, a);
    input += inputTokens(a);
    output += a.output_tokens ?? 0;
  }
  return { cost: Math.round(cost * 1e5) / 1e5, input, output };
}

/**
 * The most one call can cost, reserved before calling. Every byte sent
 * counts as half a token (real text runs 3–4 bytes per token) at the
 * cache-write price, and the answer at its full MAX_OUTPUT_TOKENS. With
 * refusal fallbacks, a declined first attempt can bill its input once more
 * and the fallback model may be dearer, so the dearer prices apply.
 */
export function worstCaseCostUsd(model: string, requestBytes: number, fallbacks: boolean): number {
  const own = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const inPrice = fallbacks ? Math.max(own[0], FALLBACK_PRICES[0]) : own[0];
  const outPrice = fallbacks ? Math.max(own[1], FALLBACK_PRICES[1]) : own[1];
  const tokensIn = Math.ceil(requestBytes / 2);
  const dollars = ((fallbacks ? 2 : 1) * tokensIn * inPrice * 1.25 + MAX_OUTPUT_TOKENS * outPrice) / 1e6;
  return Math.ceil(dollars * 1e5) / 1e5;
}

/** Models that take the server-side refusal fallback ("default" form). */
const takesFallbacks = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * Reserve a call's worst-case cost against today's budget (api._ai_reserve,
 * migration 0015). Returns the reservation's id, or null when it doesn't fit.
 */
export async function reserveBudget(
  db: AiDb,
  task: WebAiTask,
  model: string,
  estimate: number,
  budget: number,
): Promise<number | null> {
  const { rows } = await db.query<{ id: string | number | null }>(
    "select api._ai_reserve($1::text, $2::text, $3::numeric, $4::numeric) as id",
    [task, model, estimate, budget],
  );
  const id = rows[0]?.id;
  return id === null || id === undefined ? null : Number(id);
}

/** Replace a reservation's worst-case cost with the real one (api._ai_settle). */
export async function settleBudget(
  db: AiDb,
  id: number,
  model: string | null,
  input: number,
  output: number,
  cost: number,
): Promise<void> {
  await db.query(
    "select api._ai_settle($1::bigint, $2::text, $3::integer, $4::integer, $5::numeric) as found",
    [id, model, input, output, cost],
  );
}

/** Settle without changing the answer if the write fails: the reservation then keeps its worst case. */
async function settleQuietly(
  db: AiDb,
  id: number,
  model: string | null,
  input: number,
  output: number,
  cost: number,
): Promise<void> {
  try {
    await settleBudget(db, id, model, input, output, cost);
  } catch (error) {
    console.error("WorldGraph AI: couldn't settle AI usage; it stays counted at its worst case.", error);
  }
}

const fail = (status: number, error: string): AiResult => ({ status, body: { error } });

export async function handleAi(rawBody: string, deps: AiDeps): Promise<AiResult> {
  if (byteLength(rawBody) > MAX_BODY_BYTES) return fail(413, "Request too large.");
  let parsed: { task?: unknown; input?: unknown; history?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { task?: unknown; input?: unknown; history?: unknown };
  } catch {
    return fail(400, "Body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object") return fail(400, "Body must be a JSON object.");
  const { task, input } = parsed;
  if (task === "analysis") return fail(403, "Story analysis runs in the pipeline, not here.");
  if (task !== "ask" && task !== "projection") return fail(400, "Unknown task.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail(400, "Input must be an object.");
  const history = parseHistory(parsed.history);
  if (history === null)
    return fail(400, `History must be at most ${MAX_TURNS} short {question, answer} turns.`);
  if (history.length > 0 && task !== "ask") return fail(400, "Only Ask takes earlier turns.");
  const data = JSON.stringify(input);
  if (byteLength(data) > MAX_INPUT_BYTES) return fail(413, "Too much data for one question.");

  const apiKey = deps.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "WorldGraph AI isn't set up yet.");
  const model = deps.env.WG_AI_MODEL?.trim() || DEFAULT_MODEL;
  const budgetRaw = Number(deps.env.WG_AI_DAILY_BUDGET_USD);
  const budget = Number.isFinite(budgetRaw) && budgetRaw >= 0 ? budgetRaw : DEFAULT_DAILY_BUDGET_USD;

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
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
    // Earlier turns first (a follow-up), then the data with the new question.
    messages: [
      ...history.flatMap((t) => [
        { role: "user", content: t.question },
        { role: "assistant", content: t.answer },
      ]),
      { role: "user", content: data },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    ...(fallbacks ? { fallbacks: "default" } : {}),
  };

  const requestBody = JSON.stringify(request);

  // Reserve the worst case first; no reservation, no call (fail closed).
  let reservation: number | null;
  try {
    reservation = await reserveBudget(
      deps.db,
      task,
      model,
      worstCaseCostUsd(model, byteLength(requestBody), fallbacks),
      budget,
    );
  } catch (error) {
    console.error("WorldGraph AI: couldn't reserve the AI budget, so Claude wasn't called.", error);
    return fail(503, "WorldGraph AI isn't available right now.");
  }
  if (reservation === null) {
    return fail(402, "Today's AI allowance is used up. It resets at midnight UTC.");
  }

  let response: Response;
  try {
    response = await deps.fetch(API_URL, {
      method: "POST",
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 25_000),
    });
  } catch {
    // Claude may still bill a call we stopped waiting for: keep the worst case.
    return fail(503, "WorldGraph AI didn't answer in time. Try again.");
  }
  if (!response.ok) {
    // An error status means nothing was generated or billed: release the reservation.
    await settleQuietly(deps.db, reservation, null, 0, 0, 0);
    if (response.status === 429) return fail(429, "WorldGraph AI is busy. Try again in a minute.");
    if (response.status >= 500) return fail(503, "WorldGraph AI isn't available right now.");
    return fail(500, "WorldGraph AI couldn't answer this request.");
  }

  const message = (await response.json().catch(() => null)) as {
    model?: string;
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: Usage;
  } | null;
  // Unreadable, so its cost is unknown: the worst case stays.
  if (!message) return fail(503, "WorldGraph AI isn't available right now.");

  const servedBy = message.model || model;
  if (message.usage) {
    const spent = replyCost(model, servedBy, message.usage);
    await settleQuietly(deps.db, reservation, servedBy, spent.input, spent.output, spent.cost);
  }
  if (message.stop_reason === "refusal") return fail(502, "The AI declined this question.");
  if (message.stop_reason === "max_tokens")
    return fail(502, "The answer was too long. Ask something narrower.");
  const text = (message.content ?? []).find((b) => b.type === "text")?.text ?? "";
  try {
    return { status: 200, body: { data: JSON.parse(text) as unknown } };
  } catch {
    return fail(422, "The AI answer couldn't be read.");
  }
}
