import { describe, expect, it, vi } from "vitest";

import {
  MAX_OUTPUT_TOKENS,
  costUsd,
  handleAi,
  replyCost,
  worstCaseCostUsd,
  type AiDb,
  type AiDeps,
} from "../../server/ai";
import { WEB_PROMPTS } from "../../server/prompts.generated";

interface UsageRow {
  id: number;
  purpose: string;
  model: string;
  input: number;
  output: number;
  cost: number;
  reserved: boolean;
}

/**
 * A fake llm_usage table behind api._ai_reserve and api._ai_settle
 * (migration 0015; the SQL itself is tested in backend/tests/test_ai_budget.py).
 * `spent` is what other calls already spent today.
 */
function fakeDb(spent = 0) {
  const rows: UsageRow[] = [];
  let nextId = 1;
  const total = () => spent + rows.reduce((sum, r) => sum + r.cost, 0);
  const db: AiDb = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (text.includes("api._ai_reserve(")) {
        const [purpose, model, estimate, budget] = params as [string, string, number, number];
        if (total() + estimate > budget) return { rows: [{ id: null }] };
        const id = nextId++;
        rows.push({ id, purpose, model, input: 0, output: 0, cost: estimate, reserved: true });
        return { rows: [{ id: String(id) }] }; // bigint arrives as a string
      }
      if (text.includes("api._ai_settle(")) {
        const [id, model, input, output, cost] = params as [number, string | null, number, number, number];
        const row = rows.find((r) => r.id === id && r.reserved);
        if (row) Object.assign(row, { model: model ?? row.model, input, output, cost, reserved: false });
        return { rows: [{ found: Boolean(row) }] };
      }
      throw new Error(`unexpected query: ${text}`);
    }) as AiDb["query"],
  };
  return { db, rows, total };
}

const claudeReply = (body: Record<string, unknown>, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const answer = { status: "answered", bullets: [], cascade: [], forecasts: [], follow_up: [] };
const message = {
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(answer) }],
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};

function deps(overrides: Partial<AiDeps> = {}): AiDeps {
  return {
    db: fakeDb().db,
    env: { ANTHROPIC_API_KEY: "test-key" },
    prompts: WEB_PROMPTS,
    fetch: claudeReply(message) as unknown as typeof fetch,
    ...overrides,
  };
}

const body = (task: string, input: unknown = { q: "oil", context: {} }) => JSON.stringify({ task, input });

describe("POST /api/ai", () => {
  it("answers Ask with the Claude API and logs the cost", async () => {
    const { db, rows } = fakeDb(0.5);
    const fetchMock = claudeReply(message);
    const result = await handleAi(body("ask"), deps({ db, fetch: fetchMock as unknown as typeof fetch }));
    expect(result).toEqual({ status: 200, body: { data: answer } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const request = JSON.parse(String(init.body));
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.system).toEqual([
      { type: "text", text: WEB_PROMPTS.ask.prompt, cache_control: { type: "ephemeral" } },
    ]);
    expect(request.messages).toEqual([{ role: "user", content: JSON.stringify({ q: "oil", context: {} }) }]);
    expect(request.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: WEB_PROMPTS.ask.schema },
    });
    expect(request.output_config.format.schema.$comment).toBeUndefined();
    expect(request.max_tokens).toBe(MAX_OUTPUT_TOKENS);

    // Reserved first, then settled at the real cost.
    expect(rows).toEqual([
      {
        id: 1,
        purpose: "ask",
        model: "claude-opus-5-5",
        input: 1000,
        output: 500,
        cost: costUsd("claude-opus-5-5", message.usage),
        reserved: false,
      },
    ]);
  });

  it("reserves the worst case before calling Claude", async () => {
    const { db } = fakeDb();
    const order: string[] = [];
    const query = db.query;
    db.query = (async (text: string, params?: unknown[]) => {
      order.push(text.includes("_ai_reserve") ? "reserve" : "settle");
      return query(text, params);
    }) as AiDb["query"];
    const fetchMock = vi.fn(async () => {
      order.push("claude");
      return new Response(JSON.stringify(message));
    });
    await handleAi(body("ask"), deps({ db, fetch: fetchMock as unknown as typeof fetch }));
    expect(order).toEqual(["reserve", "claude", "settle"]);
  });

  it("lets concurrent calls pass the cap only while their worst cases fit", async () => {
    // $1 already spent of $2: twenty calls at once.
    const { db, rows, total } = fakeDb(1);
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify(message));
    });
    const d = deps({ db, fetch: fetchMock as unknown as typeof fetch });
    const results = await Promise.all(Array.from({ length: 20 }, () => handleAi(body("ask"), d)));
    const reserve = worstCaseCostUsd("claude-opus-5-5", 3000, true);
    const served = results.filter((r) => r.status === 200).length;
    expect(served).toBeGreaterThan(0);
    expect(served).toBeLessThanOrEqual(Math.floor(1 / reserve));
    expect(fetchMock).toHaveBeenCalledTimes(served);
    expect(results.filter((r) => r.status === 402)).toHaveLength(20 - served);
    expect(rows.every((r) => !r.reserved)).toBe(true);
    expect(total()).toBeLessThanOrEqual(2);
  });

  it("stops before the cap when each answer costs a lot", async () => {
    // A long answer: about $0.28 a call (the reviewer's case), budget $2.
    const pricey = { ...message, usage: { input_tokens: 9000, output_tokens: 12000 } };
    const { db, total } = fakeDb();
    const fetchMock = claudeReply(pricey);
    const d = deps({ db, fetch: fetchMock as unknown as typeof fetch });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await handleAi(body("ask"), d)).status);
    expect(statuses).toContain(402);
    expect(total()).toBeLessThanOrEqual(2);
  });

  it("keeps the worst case for a call that timed out (Claude may still bill it)", async () => {
    const { db, rows } = fakeDb();
    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const result = await handleAi(body("ask"), deps({ db, fetch: timeout as unknown as typeof fetch }));
    expect(result.status).toBe(503);
    expect(rows).toHaveLength(1);
    expect(rows[0].reserved).toBe(true);
    expect(rows[0].cost).toBeGreaterThan(0.15);
  });

  it("keeps the worst case when the reply can't be read", async () => {
    const { db, rows } = fakeDb();
    const broken = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    expect((await handleAi(body("ask"), deps({ db, fetch: broken as unknown as typeof fetch }))).status).toBe(
      503,
    );
    expect(rows[0].reserved).toBe(true);
  });

  it("releases the reservation when Claude answers with an error (nothing billed)", async () => {
    const { db, rows } = fakeDb();
    const busy = claudeReply({ error: {} }, 429);
    expect((await handleAi(body("ask"), deps({ db, fetch: busy as unknown as typeof fetch }))).status).toBe(
      429,
    );
    expect(rows).toEqual([expect.objectContaining({ cost: 0, reserved: false })]);
  });

  it("fails closed: no reservation, no Claude call", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const fetchMock = vi.fn();
    const db: AiDb = {
      query: vi.fn(async () => {
        throw new Error("permission denied for function _ai_reserve");
      }) as AiDb["query"],
    };
    const result = await handleAi(body("ask"), deps({ db, fetch: fetchMock }));
    expect(result.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers when settling fails, and the reservation keeps its worst case", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const { db, rows } = fakeDb();
    const query = db.query;
    db.query = (async (text: string, params?: unknown[]) => {
      if (text.includes("_ai_settle")) throw new Error("connection lost");
      return query(text, params);
    }) as AiDb["query"];
    expect((await handleAi(body("ask"), deps({ db }))).status).toBe(200);
    expect(rows[0].reserved).toBe(true);
  });

  it("puts a follow-up's earlier turns before the data, as user and assistant messages", async () => {
    const fetchMock = claudeReply(message);
    const history = [
      { question: "What's driving fuel costs?", answer: "- Brent is up on tighter supply." },
      { question: "And for airlines?", answer: "- Jet fuel costs more." },
    ];
    const input = { question: "What about India?", context: {} };
    const result = await handleAi(
      JSON.stringify({ task: "ask", input, history }),
      deps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    expect(result.status).toBe(200);
    const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(request.messages).toEqual([
      { role: "user", content: "What's driving fuel costs?" },
      { role: "assistant", content: "- Brent is up on tighter supply." },
      { role: "user", content: "And for airlines?" },
      { role: "assistant", content: "- Jet fuel costs more." },
      { role: "user", content: JSON.stringify(input) },
    ]);
    // The prompt stays the cached system prompt.
    expect(request.system[0].text).toBe(WEB_PROMPTS.ask.prompt);
  });

  it("refuses history that doesn't fit, before spending anything", async () => {
    const fetchMock = vi.fn();
    const d = deps({ fetch: fetchMock });
    const send = (history: unknown, task = "ask") =>
      handleAi(JSON.stringify({ task, input: { question: "Oil?", context: {} }, history }), d);
    const turn = { question: "Oil?", answer: "- Up." };
    expect((await send("not a list")).status).toBe(400);
    expect((await send(Array.from({ length: 7 }, () => turn))).status).toBe(400);
    expect((await send([{ question: "Oil?" }])).status).toBe(400);
    expect((await send([{ question: "Oil?", answer: "x".repeat(1001) }])).status).toBe(400);
    expect((await send([turn], "projection")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the model setting", async () => {
    const fetchMock = claudeReply({ ...message, model: "claude-sonnet-5-5" });
    await handleAi(
      body("projection"),
      deps({
        env: { ANTHROPIC_API_KEY: "k", WG_AI_MODEL: "claude-sonnet-5-5" },
        fetch: fetchMock as unknown as typeof fetch,
      }),
    );
    const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.system[0].text).toBe(WEB_PROMPTS.projection.prompt);
  });

  it("refuses story analysis (the pipeline does it) and unknown tasks", async () => {
    const fetchMock = vi.fn();
    expect((await handleAi(body("analysis"), deps({ fetch: fetchMock }))).status).toBe(403);
    expect((await handleAi(body("poem"), deps({ fetch: fetchMock }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the request before spending anything", async () => {
    const fetchMock = vi.fn();
    const d = deps({ fetch: fetchMock });
    expect((await handleAi("not json", d)).status).toBe(400);
    expect((await handleAi(body("ask", "a string"), d)).status).toBe(400);
    expect((await handleAi(body("ask", { big: "x".repeat(60_000) }), d)).status).toBe(413);
    expect((await handleAi("x".repeat(70_000), d)).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unavailable without an API key", async () => {
    expect((await handleAi(body("ask"), deps({ env: {} }))).status).toBe(503);
  });

  it("stops at the daily budget (US$2 by default, shared with analysis)", async () => {
    const fetchMock = vi.fn();
    const spentAlmostAll = fakeDb(1.95).db;
    const result = await handleAi(body("ask"), deps({ db: spentAlmostAll, fetch: fetchMock }));
    expect(result.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
    // Analysis stops at 75%, so Ask still runs with $1.50 spent…
    expect((await handleAi(body("ask"), deps({ db: fakeDb(1.5).db }))).status).toBe(200);
    // …and a bigger budget setting lifts the cap.
    const bigger = deps({
      db: fakeDb(1.95).db,
      env: { ANTHROPIC_API_KEY: "k", WG_AI_DAILY_BUDGET_USD: "5" },
    });
    expect((await handleAi(body("ask"), bigger)).status).toBe(200);
  });

  it.each([
    [429, 429],
    [529, 503],
    [500, 503],
    [400, 500],
  ])("maps a Claude API %i to %i", async (apiStatus, status) => {
    const result = await handleAi(
      body("ask"),
      deps({ fetch: claudeReply({ error: {} }, apiStatus) as unknown as typeof fetch }),
    );
    expect(result.status).toBe(status);
  });

  it("logs usage even when the answer can't be used", async () => {
    const { db, rows } = fakeDb();
    const refusal = claudeReply({ ...message, stop_reason: "refusal", content: [] });
    expect(
      (await handleAi(body("ask"), deps({ db, fetch: refusal as unknown as typeof fetch }))).status,
    ).toBe(502);
    const garbled = claudeReply({ ...message, content: [{ type: "text", text: "not json" }] });
    expect(
      (await handleAi(body("ask"), deps({ db, fetch: garbled as unknown as typeof fetch }))).status,
    ).toBe(422);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.reserved, r.cost])).toEqual([
      [false, costUsd("claude-opus-5-5", message.usage)],
      [false, costUsd("claude-opus-5-5", message.usage)],
    ]);
  });

  it("prices every attempt after a refusal fallback", () => {
    const usage = {
      input_tokens: 2000,
      output_tokens: 400,
      iterations: [
        { type: "message", input_tokens: 2000, output_tokens: 0 },
        { type: "fallback_message", input_tokens: 2000, output_tokens: 400 },
      ],
    };
    const got = replyCost("claude-opus-5-5", "claude-opus-5", usage);
    expect(got.input).toBe(4000);
    expect(got.output).toBe(400);
    // The declined attempt at Opus 5.5 rates, the fallback at Opus 5 rates.
    expect(got.cost).toBeCloseTo(
      costUsd("claude-opus-5-5", { input_tokens: 2000 }) +
        costUsd("claude-opus-5", { input_tokens: 2000, output_tokens: 400 }),
      5,
    );
    // Without iterations, the top-level usage at the serving model's rates.
    expect(replyCost("claude-opus-5-5", "claude-opus-5-5", message.usage).cost).toBe(
      costUsd("claude-opus-5-5", message.usage),
    );
  });

  it("prices the worst case as a full-length answer plus every byte sent", () => {
    // 2,000 bytes ≈ at most 1,000 tokens at the cache-write price, plus 8,000 output tokens.
    expect(worstCaseCostUsd("claude-opus-5-5", 2000, false)).toBeCloseTo(
      (1000 * 4 * 1.25 + MAX_OUTPUT_TOKENS * 20) / 1e6,
      5,
    );
    // With fallbacks: input twice, at the dearer fallback model's prices.
    expect(worstCaseCostUsd("claude-opus-5-5", 2000, true)).toBeCloseTo(
      (2 * 1000 * 5 * 1.25 + MAX_OUTPUT_TOKENS * 25) / 1e6,
      5,
    );
    // Always at least what a real reply of that size can cost.
    const real = costUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: MAX_OUTPUT_TOKENS });
    expect(worstCaseCostUsd("claude-opus-5-5", 4000, true)).toBeGreaterThan(real);
  });

  it("prices tokens like the pipeline", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000 })).toBe(4);
    expect(costUsd("claude-opus-5-5", { output_tokens: 100_000 })).toBe(2);
    expect(costUsd("claude-opus-5-5", { cache_creation_input_tokens: 1_000_000 })).toBe(5);
    expect(costUsd("claude-opus-5-5", { cache_read_input_tokens: 1_000_000 })).toBe(0.2);
    expect(costUsd("unknown-model", { input_tokens: 1_000_000 })).toBe(4);
  });
});
