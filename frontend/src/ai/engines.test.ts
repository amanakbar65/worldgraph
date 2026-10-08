import { afterEach, describe, expect, it, vi } from "vitest";

import { AiError } from "./engine";
import {
  artifactEngine,
  buildPrompt,
  httpEngine,
  httpStatusToAiError,
  MODEL_TIER,
  resolveEngine,
  sampleErrorToAiError,
} from "./engines";
import { PROMPTS } from "./prompts";

const capability = vi.hoisted(() => vi.fn());
vi.mock("@/platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/runtime")>()),
  capability,
}));

/** A stand-in for the `sample` capability: `json` is what the engine calls. */
function fakeSample(json: (input: unknown, options?: unknown) => Promise<unknown>) {
  const fn = Object.assign(vi.fn(), { json: vi.fn(json), limits: vi.fn() });
  return fn as unknown as typeof Claude.sample & { json: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  capability.mockReset();
});

describe("artifact engine", () => {
  it("sends one user turn: the shared prompt, then the data", async () => {
    const sample = fakeSample(async () => ({ effects: [] }));
    const engine = artifactEngine(sample);
    expect(engine.kind).toBe("artifact");
    expect(engine.label).toBe("Your Claude account");
    const controller = new AbortController();
    await expect(
      engine.complete("projection", { focus: "story:a" }, { signal: controller.signal }),
    ).resolves.toEqual({
      effects: [],
    });
    const [prompt, options] = sample.json.mock.calls[0] as [string, Claude.sample.SampleOptions];
    expect(prompt).toBe(`${PROMPTS.projection}\n\n## Data\n\n{"focus":"story:a"}`);
    expect(prompt).toBe(buildPrompt("projection", { focus: "story:a" }));
    expect(options.modelTier).toBe(MODEL_TIER.projection);
    expect(options.signal).toBe(controller.signal);
  });

  it("picks a model tier for every task", () => {
    expect(MODEL_TIER).toEqual({ analysis: "default", ask: "default", projection: "default" });
  });

  it.each([
    ["not_granted", "declined"],
    ["rate_limited", "rate_limited"],
    ["cancelled", "cancelled"],
    ["sampling_disabled", "unavailable"],
    ["capability_disabled", "unavailable"],
    ["session_expired", "unavailable"],
    ["invalid_json", "invalid"],
    ["empty_completion", "invalid"],
    ["refused", "failed"],
    ["prompt_too_large", "failed"],
    ["upstream_error", "failed"],
    ["something_new", "failed"],
  ])("maps the %s error to %s", async (code, kind) => {
    const sample = fakeSample(() => Promise.reject({ code, message: "x" }));
    const error = await artifactEngine(sample)
      .complete("ask", {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe(kind);
    expect(sample.json).toHaveBeenCalledTimes(1); // never retried
  });

  it("refuses data over the platform's size limit without calling Claude", async () => {
    const sample = fakeSample(async () => ({}));
    const error = await artifactEngine(sample)
      .complete("ask", { blob: "x".repeat(300_000) })
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("failed");
    expect(sample.json).not.toHaveBeenCalled();
  });

  it("treats non-sample errors as a plain failure", () => {
    expect(sampleErrorToAiError(new Error("boom")).kind).toBe("failed");
    const existing = new AiError("budget", "x");
    expect(sampleErrorToAiError(existing)).toBe(existing);
  });
});

describe("website engine", () => {
  const ok = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );

  it("posts the task and input to /api/ai and returns the data", async () => {
    const fetchImpl = vi.fn(() => ok({ data: { status: "answered" } }));
    const engine = httpEngine("/api/ai", fetchImpl as unknown as typeof fetch);
    expect(engine.kind).toBe("api");
    expect(engine.label).toBe("WorldGraph AI");
    await expect(engine.complete("ask", { q: "oil" })).resolves.toEqual({ status: "answered" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ task: "ask", input: { q: "oil" } });
  });

  it.each([
    [402, "budget"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [404, "unavailable"],
    [422, "invalid"],
    [500, "failed"],
    [400, "failed"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const fetchImpl = vi.fn(() => ok({ error: "nope" }, status));
    const error = await httpEngine("/api/ai", fetchImpl as unknown as typeof fetch)
      .complete("ask", {})
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe(kind);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(httpStatusToAiError(status).kind).toBe(kind);
  });

  it("reports network failures and Stop", async () => {
    const offline = httpEngine("/api/ai", (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch);
    expect(((await offline.complete("ask", {}).catch((e: unknown) => e)) as AiError).kind).toBe(
      "unavailable",
    );
    const abort = new DOMException("Aborted", "AbortError");
    const stopped = httpEngine("/api/ai", (() => Promise.reject(abort)) as typeof fetch);
    expect(((await stopped.complete("ask", {}).catch((e: unknown) => e)) as AiError).kind).toBe("cancelled");
  });
});

describe("resolveEngine", () => {
  it("uses Claude on the viewer's account inside claude.ai", async () => {
    capability.mockResolvedValue(fakeSample(async () => ({})));
    const engine = await resolveEngine("artifact");
    expect(engine.kind).toBe("artifact");
    expect(capability).toHaveBeenCalledWith("sample");
  });

  it("has no AI inside claude.ai when sample isn't available", async () => {
    capability.mockResolvedValue(null);
    const engine = await resolveEngine("artifact");
    expect(engine.kind).toBe("none");
    await expect(engine.complete("ask", {})).rejects.toBeInstanceOf(AiError);
  });

  it("uses WorldGraph AI on the website", async () => {
    const engine = await resolveEngine("web");
    expect(engine.kind).toBe("api");
    expect(capability).not.toHaveBeenCalled();
  });
});
