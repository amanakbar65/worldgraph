import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/ai/engine";

import { __testing, MAX_HISTORY, panelKeyOf, useAsk } from "./ask-store";
import { BRENT, CONTEXT, EMPTY_CONTEXT } from "./fixtures";

const ai = vi.hoisted(() => ({
  runAi: vi.fn<(task: string, input: unknown, schema: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>>(),
}));

vi.mock("@/ai/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/engine")>()),
  runAi: ai.runAi,
}));

const KEY = panelKeyOf(undefined, undefined);
const entry = (id: number) => useAsk.getState().entries.find((e) => e.id === id)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

const ANSWER = {
  status: "answered",
  bullets: [{ text: "Brent is up on tighter supply.", cite: [BRENT.id, "story:invented"] }],
  cascade: [],
  forecasts: [],
  follow_up: [],
};

beforeEach(() => {
  __testing.reset();
  ai.runAi.mockReset();
});
afterEach(() => __testing.reset());

describe("Ask store", () => {
  it("starts searching on submit and shows the new question in that panel", () => {
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    expect(entry(id)).toMatchObject({ question: "What moves oil?", phase: "searching" });
    expect(useAsk.getState().shown[KEY]).toBe(id);
    expect(ai.runAi).not.toHaveBeenCalled();
  });

  it("answers 'not enough evidence' for an empty context without calling the AI", () => {
    const id = useAsk.getState().submit("Cricket?", undefined, KEY);
    useAsk.getState().receiveContext(id, EMPTY_CONTEXT);
    expect(entry(id).phase).toBe("done");
    expect(entry(id).answer?.status).toBe("not_enough_evidence");
    expect(ai.runAi).not.toHaveBeenCalled();
  });

  it("sends the question and the compacted context once, then shapes the reply", async () => {
    ai.runAi.mockResolvedValue(ANSWER);
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().receiveContext(id, CONTEXT);
    expect(entry(id).phase).toBe("thinking");
    expect(ai.runAi).toHaveBeenCalledTimes(1);
    const [task, input] = ai.runAi.mock.calls[0];
    expect(task).toBe("ask");
    const sent = input as { question: string; context: { stories: { id: string }[] } };
    expect(sent.question).toBe("What moves oil?");
    expect(sent.context.stories.map((s) => s.id)).toEqual(CONTEXT.stories.map((s) => s.id));
    expect(JSON.stringify(sent)).not.toContain("https://");

    await flush();
    expect(entry(id).phase).toBe("done");
    expect(entry(id).answer?.bullets[0].cites.map((s) => s.id)).toEqual([BRENT.id]);
  });

  it("stops: aborts the AI call and ignores its late reply", async () => {
    let resolve: (v: unknown) => void = () => {};
    let signal: AbortSignal | undefined;
    ai.runAi.mockImplementation((_t, _i, _s, options) => {
      signal = options?.signal;
      return new Promise((r) => (resolve = r));
    });
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().receiveContext(id, CONTEXT);
    useAsk.getState().stop(id);
    expect(signal?.aborted).toBe(true);
    expect(entry(id).phase).toBe("stopped");
    resolve(ANSWER);
    await flush();
    expect(entry(id).phase).toBe("stopped");
    expect(entry(id).answer).toBeNull();
  });

  it("records why the AI failed", async () => {
    ai.runAi.mockRejectedValue(new AiError("unavailable", "Claude isn't available here."));
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    expect(entry(id)).toMatchObject({
      phase: "failed",
      failure: { source: "ai", kind: "unavailable", message: "Claude isn't available here." },
    });
  });

  it("treats a non-AiError as a failed answer", async () => {
    ai.runAi.mockRejectedValue(new Error("boom"));
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    expect(entry(id).failure).toMatchObject({ source: "ai", kind: "failed" });
  });

  it("asks the AI again on retry, reusing the context it already has", async () => {
    ai.runAi.mockRejectedValueOnce(new AiError("rate_limited", "Busy.")).mockResolvedValueOnce(ANSWER);
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    useAsk.getState().retry(id);
    expect(entry(id).phase).toBe("thinking");
    await flush();
    expect(entry(id).phase).toBe("done");
    expect(ai.runAi).toHaveBeenCalledTimes(2);
  });

  it("goes back to searching on retry after a data failure", () => {
    const id = useAsk.getState().submit("What moves oil?", undefined, KEY);
    useAsk.getState().failContext(id, new Error("down"));
    expect(entry(id).phase).toBe("failed");
    useAsk.getState().retry(id);
    expect(entry(id).phase).toBe("searching");
  });

  it("runs one question at a time: a new one stops the last", () => {
    ai.runAi.mockReturnValue(new Promise(() => {}));
    const first = useAsk.getState().submit("First?", undefined, KEY);
    useAsk.getState().receiveContext(first, CONTEXT);
    const second = useAsk.getState().submit("Second?", undefined, KEY);
    expect(entry(first).phase).toBe("stopped");
    expect(entry(second).phase).toBe("searching");
  });

  it(`keeps this visit's last ${MAX_HISTORY} questions`, () => {
    for (let i = 0; i < MAX_HISTORY + 3; i++) useAsk.getState().submit(`Question ${i}?`, undefined, KEY);
    const entries = useAsk.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY);
    expect(entries.at(-1)?.question).toBe(`Question ${MAX_HISTORY + 2}?`);
  });
});
