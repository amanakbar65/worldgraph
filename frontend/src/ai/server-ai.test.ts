import { describe, expect, it, vi } from "vitest";

import { costUsd, handleAi, type AiDb, type AiDeps } from "../../server/ai";
import { WEB_PROMPTS } from "../../server/prompts.generated";

/** A fake llm_usage table. */
function fakeDb(spent = 0) {
  const inserts: unknown[][] = [];
  const db: AiDb = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      if (text.startsWith("select")) return { rows: [{ spent: String(spent) }] };
      inserts.push(params ?? []);
      return { rows: [] };
    }) as AiDb["query"],
  };
  return { db, inserts };
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
    const { db, inserts } = fakeDb(0.5);
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

    expect(inserts).toEqual([
      ["claude-opus-5-5", "ask", 1000, 500, costUsd("claude-opus-5-5", message.usage)],
    ]);
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
    const { db, inserts } = fakeDb();
    const refusal = claudeReply({ ...message, stop_reason: "refusal", content: [] });
    expect(
      (await handleAi(body("ask"), deps({ db, fetch: refusal as unknown as typeof fetch }))).status,
    ).toBe(502);
    const garbled = claudeReply({ ...message, content: [{ type: "text", text: "not json" }] });
    expect(
      (await handleAi(body("ask"), deps({ db, fetch: garbled as unknown as typeof fetch }))).status,
    ).toBe(422);
    expect(inserts).toHaveLength(2);
  });

  it("prices tokens like the pipeline", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000 })).toBe(4);
    expect(costUsd("claude-opus-5-5", { output_tokens: 100_000 })).toBe(2);
    expect(costUsd("claude-opus-5-5", { cache_creation_input_tokens: 1_000_000 })).toBe(5);
    expect(costUsd("claude-opus-5-5", { cache_read_input_tokens: 1_000_000 })).toBe(0.2);
    expect(costUsd("unknown-model", { input_tokens: 1_000_000 })).toBe(4);
  });
});
