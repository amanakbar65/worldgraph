import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/ai/engine";
import { MAX_TURN_ANSWER, MAX_TURNS, type AiTurn } from "@/ai/history";

import type { AskAbout } from "./ask-data";
import { __testing, historyFor, MAX_TURNS_KEPT, runningTurn, useAsk } from "./ask-store";
import { BRENT, CONTEXT, EMPTY_CONTEXT } from "./fixtures";

const ai = vi.hoisted(() => ({
  runAi:
    vi.fn<
      (
        task: string,
        input: unknown,
        schema: unknown,
        options?: { signal?: AbortSignal; history?: readonly AiTurn[] },
      ) => Promise<unknown>
    >(),
}));

vi.mock("@/ai/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/engine")>()),
  runAi: ai.runAi,
}));

const turn = (id: number) => useAsk.getState().turns.find((t) => t.id === id)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const sentInput = (call = -1) =>
  ai.runAi.mock.calls.at(call)![1] as {
    question: string;
    about?: { type: string; name: string };
    context: { stories: { id: string }[] };
  };
const sentHistory = (call = -1) => ai.runAi.mock.calls.at(call)![3]?.history ?? [];

const ANSWER = {
  status: "answered",
  read_as: "What's driving fuel costs?",
  bullets: [{ text: "Brent is up on tighter supply.", cite: [BRENT.id, "story:invented"] }],
  cascade: [],
  forecasts: [],
  follow_up: [],
};

/** Ask and answer one question; returns its turn id. */
async function askAndAnswer(question: string, about: AskAbout | null = null, reply: unknown = ANSWER) {
  ai.runAi.mockResolvedValueOnce(reply);
  const id = useAsk.getState().submit(question, undefined, about);
  useAsk.getState().receiveContext(id, CONTEXT);
  await flush();
  return id;
}

const GUJARAT: AskAbout = { id: "region:in-gj", type: "region", name: "Gujarat", terms: ["Gujarat"] };

beforeEach(() => {
  __testing.reset();
  ai.runAi.mockReset();
});
afterEach(() => __testing.reset());

describe("Ask thread", () => {
  it("adds a question to the thread and starts searching, without the AI yet", () => {
    const id = useAsk.getState().submit("What moves oil?", undefined, null);
    expect(useAsk.getState().turns.map((t) => t.id)).toEqual([id]);
    expect(turn(id)).toMatchObject({
      question: "What moves oil?",
      phase: "searching",
      search: "What moves oil?",
    });
    expect(runningTurn(useAsk.getState())?.id).toBe(id);
    expect(ai.runAi).not.toHaveBeenCalled();
  });

  it("answers 'not enough evidence' for an empty context without calling the AI", () => {
    const id = useAsk.getState().submit("Cricket?", undefined, null);
    useAsk.getState().receiveContext(id, EMPTY_CONTEXT);
    expect(turn(id).phase).toBe("done");
    expect(turn(id).answer?.status).toBe("not_enough_evidence");
    expect(ai.runAi).not.toHaveBeenCalled();
  });

  it("sends the first question and the compacted context once, with no history", async () => {
    const id = await askAndAnswer("What moves oil?");
    expect(ai.runAi).toHaveBeenCalledTimes(1);
    expect(ai.runAi.mock.calls[0][0]).toBe("ask");
    const input = sentInput();
    expect(input.question).toBe("What moves oil?");
    expect(input.about).toBeUndefined();
    expect(input.context.stories.map((s) => s.id)).toEqual(CONTEXT.stories.map((s) => s.id));
    expect(JSON.stringify(input)).not.toContain("https://");
    expect(sentHistory()).toEqual([]);
    expect(turn(id).phase).toBe("done");
    expect(turn(id).answer?.bullets[0].cites.map((s) => s.id)).toEqual([BRENT.id]);
  });

  it("sends earlier turns with a follow-up, and searches with the question it leans on", async () => {
    await askAndAnswer("What's driving fuel costs?");
    ai.runAi.mockResolvedValueOnce({ ...ANSWER, read_as: "What's driving fuel costs in India?" });
    const id = useAsk.getState().submit("What about India?", undefined, null);
    // The search carries the earlier question's words: api.ask_context finds fuel stories in India.
    expect(turn(id).search).toBe("What about India? What's driving fuel costs?");
    useAsk.getState().receiveContext(id, CONTEXT);
    expect(sentInput().question).toBe("What about India?");
    expect(sentHistory()).toEqual([
      { question: "What's driving fuel costs?", answer: "- Brent is up on tighter supply." },
    ]);
    await flush();
    expect(turn(id).answer?.readAs).toBe("What's driving fuel costs in India?");

    // The next follow-up leans on that question as the AI read it.
    const next = useAsk.getState().submit("And for airlines?", undefined, null);
    expect(turn(next).search).toBe("And for airlines? What's driving fuel costs in India?");
    expect(turn(next).history.map((t) => t.question)).toEqual([
      "What's driving fuel costs?",
      "What about India?",
    ]);
  });

  it("searches a question that stands on its own by itself", async () => {
    await askAndAnswer("What's driving fuel costs?");
    const id = useAsk.getState().submit("Where are the opportunities in solar power?", undefined, null);
    expect(turn(id).search).toBe("Where are the opportunities in solar power?");
    expect(turn(id).history).toHaveLength(1);
  });

  it(`carries at most the last ${MAX_TURNS} answered turns, trimmed`, async () => {
    const long = { ...ANSWER, bullets: [{ text: "word ".repeat(400), cite: [BRENT.id] }] };
    for (let i = 0; i < MAX_TURNS + 2; i++) await askAndAnswer(`Question number ${i}?`, null, long);
    ai.runAi.mockResolvedValueOnce(ANSWER);
    const id = useAsk.getState().submit("What next?", undefined, null);
    useAsk.getState().receiveContext(id, CONTEXT);
    const history = sentHistory();
    expect(history).toHaveLength(MAX_TURNS);
    expect(history[0].question).toBe("Question number 2?");
    expect(history.at(-1)?.question).toBe(`Question number ${MAX_TURNS + 1}?`);
    for (const t of history) expect(t.answer.length).toBeLessThanOrEqual(MAX_TURN_ANSWER);
  });

  it("leaves turns without an answer out of the history", async () => {
    await askAndAnswer("What's driving fuel costs?");
    ai.runAi.mockRejectedValueOnce(new AiError("rate_limited", "Busy."));
    const failed = useAsk.getState().submit("What about India?", undefined, null);
    useAsk.getState().receiveContext(failed, CONTEXT);
    await flush();
    const stopped = useAsk.getState().submit("And Brazil?", undefined, null);
    useAsk.getState().stop(stopped);
    expect(historyFor(useAsk.getState().turns).map((t) => t.question)).toEqual([
      "What's driving fuel costs?",
    ]);
    // "Not enough evidence" is an answer too.
    const none = useAsk.getState().submit("Who wins the cricket?", undefined, null);
    useAsk.getState().receiveContext(none, EMPTY_CONTEXT);
    expect(historyFor(useAsk.getState().turns).at(-1)).toEqual({
      question: "Who wins the cricket?",
      answer: "WorldGraph didn't hold enough evidence to answer this.",
    });
  });

  it("keeps what the conversation is about with every turn: in the search and for the AI", async () => {
    useAsk.getState().setScope(GUJARAT.id);
    await askAndAnswer("What are the risks?", GUJARAT);
    expect(useAsk.getState().turns[0].search).toBe("What are the risks? Gujarat");
    expect(sentInput().about).toEqual({ type: "region", name: "Gujarat" });
    await askAndAnswer("Where are the new opportunities in solar power?", GUJARAT);
    expect(sentInput().about).toEqual({ type: "region", name: "Gujarat" });
    expect(useAsk.getState().scope).toBe(GUJARAT.id);
  });

  it("stops: aborts the AI call and ignores its late reply", async () => {
    let resolve: (v: unknown) => void = () => {};
    let signal: AbortSignal | undefined;
    ai.runAi.mockImplementation((_t, _i, _s, options) => {
      signal = options?.signal;
      return new Promise((r) => (resolve = r));
    });
    const id = useAsk.getState().submit("What moves oil?", undefined, null);
    useAsk.getState().receiveContext(id, CONTEXT);
    useAsk.getState().stop(id);
    expect(signal?.aborted).toBe(true);
    expect(turn(id).phase).toBe("stopped");
    resolve(ANSWER);
    await flush();
    expect(turn(id).phase).toBe("stopped");
    expect(turn(id).answer).toBeNull();
  });

  it("records why the AI failed, and keeps the earlier answers", async () => {
    const first = await askAndAnswer("What moves oil?");
    ai.runAi.mockRejectedValueOnce(new AiError("unavailable", "Claude isn't available here."));
    const id = useAsk.getState().submit("What about India?", undefined, null);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    expect(turn(id)).toMatchObject({
      phase: "failed",
      failure: { source: "ai", kind: "unavailable", message: "Claude isn't available here." },
    });
    expect(turn(first).phase).toBe("done");
    expect(turn(first).answer?.bullets).toHaveLength(1);
  });

  it("treats a non-AiError as a failed answer", async () => {
    ai.runAi.mockRejectedValue(new Error("boom"));
    const id = useAsk.getState().submit("What moves oil?", undefined, null);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    expect(turn(id).failure).toMatchObject({ source: "ai", kind: "failed" });
  });

  it("retries only the failed turn, with the context and history it was asked with", async () => {
    await askAndAnswer("What's driving fuel costs?");
    ai.runAi.mockRejectedValueOnce(new AiError("rate_limited", "Busy.")).mockResolvedValueOnce(ANSWER);
    const id = useAsk.getState().submit("What about India?", undefined, null);
    useAsk.getState().receiveContext(id, CONTEXT);
    await flush();
    const firstHistory = sentHistory();
    useAsk.getState().retry(id);
    expect(turn(id).phase).toBe("thinking");
    expect(sentHistory()).toEqual(firstHistory);
    await flush();
    expect(turn(id).phase).toBe("done");
    expect(ai.runAi).toHaveBeenCalledTimes(3);
    expect(useAsk.getState().turns).toHaveLength(2);
  });

  it("doesn't retry while another question is running", async () => {
    ai.runAi.mockRejectedValueOnce(new AiError("rate_limited", "Busy."));
    const failed = useAsk.getState().submit("What moves oil?", undefined, null);
    useAsk.getState().receiveContext(failed, CONTEXT);
    await flush();
    const running = useAsk.getState().submit("What about India?", undefined, null);
    useAsk.getState().retry(failed);
    expect(turn(failed).phase).toBe("failed");
    expect(turn(running).phase).toBe("searching");
  });

  it("goes back to searching on retry after a data failure", () => {
    const id = useAsk.getState().submit("What moves oil?", undefined, null);
    useAsk.getState().failContext(id, new Error("down"));
    expect(turn(id).phase).toBe("failed");
    useAsk.getState().retry(id);
    expect(turn(id).phase).toBe("searching");
  });

  it("runs one question at a time: a new one stops the last", () => {
    ai.runAi.mockReturnValue(new Promise(() => {}));
    const first = useAsk.getState().submit("First?", undefined, null);
    useAsk.getState().receiveContext(first, CONTEXT);
    const second = useAsk.getState().submit("Second?", undefined, null);
    expect(turn(first).phase).toBe("stopped");
    expect(turn(second).phase).toBe("searching");
  });

  it(`keeps the thread's last ${MAX_TURNS_KEPT} turns`, () => {
    for (let i = 0; i < MAX_TURNS_KEPT + 3; i++) useAsk.getState().submit(`Question ${i}?`, undefined, null);
    const turns = useAsk.getState().turns;
    expect(turns).toHaveLength(MAX_TURNS_KEPT);
    expect(turns.at(-1)?.question).toBe(`Question ${MAX_TURNS_KEPT + 2}?`);
  });

  it("starts a new chat: clears the thread and the draft, stops a running answer, sets the subject", async () => {
    let signal: AbortSignal | undefined;
    ai.runAi.mockImplementation((_t, _i, _s, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    useAsk.getState().setScope(GUJARAT.id);
    useAsk.getState().setDraft("half-typed");
    const id = useAsk.getState().submit("What are the risks?", undefined, GUJARAT);
    useAsk.getState().receiveContext(id, CONTEXT);
    useAsk.getState().newChat(null);
    expect(signal?.aborted).toBe(true);
    expect(useAsk.getState()).toMatchObject({ turns: [], scope: null, draft: "" });
    useAsk.getState().newChat("story:x");
    expect(useAsk.getState().scope).toBe("story:x");
  });
});
