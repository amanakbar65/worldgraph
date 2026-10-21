import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { AiError } from "@/ai/engine";
import type { AiTurn } from "@/ai/history";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import AskPanel from "./AskPanel";
import { __testing as store, useAsk } from "./ask-store";
import { BRENT, CONTEXT, EMPTY_CONTEXT, JET_FUEL, NOW, OPEC_FORECAST, SURCHARGE } from "./fixtures";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
  runAi:
    vi.fn<
      (
        task: string,
        input: unknown,
        schema?: unknown,
        options?: { history?: readonly AiTurn[] },
      ) => Promise<unknown>
    >(),
  engine: { kind: "artifact", label: "Your Claude account" } as { kind: string; label: string },
  desktop: true,
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    mocks.calls.push({ name, args, enabled: options?.enabled !== false });
    const data = mocks.responses[name];
    const error = mocks.errors[name] ?? null;
    return {
      data,
      error,
      isPending: data === undefined && !error,
      isError: !!error,
      isFetching: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/ai/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/engine")>()),
  runAi: mocks.runAi,
  getAiEngine: () => Promise.resolve({ ...mocks.engine, complete: vi.fn() }),
}));

const ANSWER = {
  status: "answered",
  read_as: "What's driving fuel costs?",
  bullets: [
    { text: "Brent crude is at a multi-month high on tighter supply.", cite: [BRENT.id, "story:invented"] },
    { text: "Airlines could pass higher jet fuel costs on to fares.", cite: [JET_FUEL.id, SURCHARGE.id] },
  ],
  cascade: [{ from: BRENT.id, to: JET_FUEL.id, mechanism: "lifts jet fuel prices" }],
  forecasts: [OPEC_FORECAST.id, "forecast:not-real"],
  follow_up: ["How do OPEC+ cuts affect airlines?"],
};

const INDIA_ANSWER = {
  ...ANSWER,
  read_as: "What's driving fuel costs in India?",
  bullets: [{ text: "Indian airlines could raise fuel surcharges on fares.", cite: [SURCHARGE.id] }],
  cascade: [],
  forecasts: [],
  follow_up: ["Which Indian sectors use the most diesel?"],
};

const askCalls = () => mocks.calls.filter((c) => c.name === "ask_context");
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const top = () => useNav.getState().panels.at(-1);
const box = () => screen.getByLabelText("Your question") as HTMLTextAreaElement;
const log = () => screen.getByRole("log", { name: "Conversation" });

async function ask(question: string) {
  fireEvent.change(box(), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await flush();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? mocks.desktop : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mocks.responses = { ask_context: CONTEXT };
  mocks.errors = {};
  mocks.calls = [];
  mocks.desktop = true;
  mocks.runAi.mockReset();
  mocks.runAi.mockResolvedValue(ANSWER);
  mocks.engine = { kind: "artifact", label: "Your Claude account" };
  useNav.setState({ panels: [{ kind: "ask" }], view: "globe", focus: null });
  useSettings.setState({ sample: "auto" });
  localStorage.clear();
  storage.reset();
  store.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AskPanel", () => {
  it("offers four suggested questions in an empty conversation and spends nothing until asked", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    await flush();
    expect(log()).toBeTruthy();
    const suggestions = within(screen.getByRole("region", { name: "Try asking" })).getAllByRole("button");
    expect(suggestions).toHaveLength(4);
    expect(suggestions[0].textContent).toContain("What's driving fuel costs in India?");
    expect(screen.getByText("Uses your Claude account. Nothing is sent until you ask.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(askCalls()).toHaveLength(0);
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("fills the box from a deep link without asking", async () => {
    render(<AskPanel panel={{ kind: "ask", q: "What moves rice prices?" }} />);
    await flush();
    expect(box().value).toBe("What moves rice prices?");
    expect(askCalls()).toHaveLength(0);
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("shows 'Searching WorldGraph…' while retrieving; the send button becomes Stop", async () => {
    mocks.responses = {};
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    expect(within(log()).getByText("Searching WorldGraph…")).toBeTruthy();
    expect(within(log()).getByRole("article").getAttribute("aria-busy")).toBe("true");
    expect(askCalls().at(-1)?.args).toEqual({
      q: "What's driving fuel costs?",
      limit: 12,
      sample: undefined,
    });
    // While it runs, Enter doesn't send another question.
    fireEvent.change(box(), { target: { value: "What about India?" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(useAsk.getState().turns).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop the answer" }));
    expect(screen.getByText("Stopped. Nothing more was sent.")).toBeTruthy();
    expect(box().value).toBe("What about India?");
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("answers with cited bullets, a mini cascade, crowd forecasts and follow-ups", async () => {
    useSettings.setState({ sample: "on" });
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");

    expect(askCalls().at(-1)?.args).toMatchObject({ sample: true });
    expect(mocks.runAi).toHaveBeenCalledTimes(1);
    expect(within(log()).getByRole("heading", { name: "What's driving fuel costs?" })).toBeTruthy();
    expect(box().value).toBe("");

    const answer = screen.getByRole("region", { name: /^Answer/ });
    expect(
      within(answer)
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("p")),
    ).toHaveLength(2);
    // The invented citation is gone; real ones are chips that open the story.
    const chips = within(answer).getAllByRole("button", { name: /^Source story:/ });
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual([
      `Source story: ${BRENT.headline}`,
      `Source story: ${JET_FUEL.headline}`,
      `Source story: ${SURCHARGE.headline}`,
    ]);
    fireEvent.click(chips[1]);
    expect(top()).toEqual({ kind: "story", id: JET_FUEL.id });

    const cascade = screen.getByRole("region", { name: /How it connects/ });
    expect(within(cascade).getByText("Reported")).toBeTruthy();
    expect(within(cascade).getAllByRole("button")).toHaveLength(2);

    const crowd = screen.getByRole("region", { name: /What the crowd expects/ });
    expect(within(crowd).getByText("Crowd forecast")).toBeTruthy();
    expect(within(crowd).getByText("Manifold")).toBeTruthy();
    expect(within(crowd).getByText("52.3K MANA volume")).toBeTruthy();
    expect(within(crowd).getByText(/Updated/)).toBeTruthy();
    expect(within(crowd).getAllByRole("img", { name: /OPEC\+ extends output cuts/ })).toHaveLength(1);
    fireEvent.click(within(crowd).getByRole("button"));
    expect(top()).toEqual({ kind: "forecast", id: OPEC_FORECAST.id });
    // A question that stands on its own has no "Read as" line.
    expect(screen.queryByText(/^Read as/)).toBeNull();
  });

  it("keeps the conversation in one thread and sends earlier turns with a follow-up", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    mocks.runAi.mockResolvedValueOnce(INDIA_ANSWER);
    await ask("What about India?");

    // Both questions and both answers, oldest first, in the one log.
    const turns = within(log()).getAllByRole("article");
    expect(turns.map((t) => within(t).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "What's driving fuel costs?",
      "What about India?",
    ]);
    expect(within(turns[0]).getByRole("region", { name: /^Answer/ })).toBeTruthy();
    expect(within(turns[1]).getByRole("region", { name: /^Answer/ })).toBeTruthy();
    // Only the newest answer offers questions to ask next.
    expect(within(turns[0]).queryByRole("region", { name: "Ask next" })).toBeNull();
    expect(within(turns[1]).getByRole("region", { name: "Ask next" })).toBeTruthy();
    // How the follow-up was read.
    expect(within(turns[1]).getByText("Read as “What's driving fuel costs in India?”")).toBeTruthy();

    // The follow-up searched with the earlier question's words, and the AI saw the earlier turn.
    expect(askCalls().at(-1)?.args).toMatchObject({ q: "What about India? What's driving fuel costs?" });
    const [, input, , options] = mocks.runAi.mock.calls[1];
    expect((input as { question: string }).question).toBe("What about India?");
    expect(options?.history).toEqual([
      {
        question: "What's driving fuel costs?",
        answer:
          "- Brent crude is at a multi-month high on tighter supply.\n- Airlines could pass higher jet fuel costs on to fares.",
      },
    ]);
  });

  it("sends with Enter, adds a line with Shift+Enter, and asks a tapped follow-up", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    fireEvent.change(box(), { target: { value: "What's driving fuel costs?" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(useAsk.getState().turns).toHaveLength(0);
    fireEvent.keyDown(box(), { key: "Enter" });
    await flush();
    await flush();
    expect(useAsk.getState().turns).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "How do OPEC+ cuts affect airlines?" }));
    await flush();
    await flush();
    expect(askCalls().at(-1)?.args).toMatchObject({ q: "How do OPEC+ cuts affect airlines?" });
    expect(within(log()).getAllByRole("article")).toHaveLength(2);
  });

  it("keeps the conversation when the panel is closed and opened again; New chat clears it", async () => {
    const first = render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    fireEvent.change(box(), { target: { value: "half a question" } });
    first.unmount();

    render(<AskPanel panel={{ kind: "ask" }} />);
    await flush();
    expect(within(log()).getByRole("heading", { name: "What's driving fuel costs?" })).toBeTruthy();
    expect(screen.getByRole("region", { name: /^Answer/ })).toBeTruthy();
    expect(box().value).toBe("half a question");
    expect(box().placeholder).toBe("Ask a follow-up…");

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(within(log()).queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Try asking" })).toBeTruthy();
    expect(box().value).toBe("");
  });

  it("keeps the earlier answers when one fails, with a retry on the failed one only", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    mocks.runAi.mockRejectedValueOnce(new AiError("rate_limited", "Claude is busy. Try again later."));
    await ask("What about India?");
    const turns = within(log()).getAllByRole("article");
    expect(within(turns[0]).getByRole("region", { name: /^Answer/ })).toBeTruthy();
    expect(within(turns[1]).getByRole("alert").textContent).toContain("The AI is busy right now");
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);

    mocks.runAi.mockResolvedValueOnce(INDIA_ANSWER);
    fireEvent.click(within(turns[1]).getByRole("button", { name: "Try again" }));
    await flush();
    expect(within(turns[1]).getByRole("region", { name: /^Answer/ })).toBeTruthy();
    expect(mocks.runAi).toHaveBeenCalledTimes(3);
    expect(
      askCalls().filter((c) => c.args && (c.args as { q: string }).q.startsWith("What about India")),
    ).not.toHaveLength(0);
  });

  it("says 'Not enough evidence' plainly for an empty context, without the AI", async () => {
    mocks.responses = { ask_context: EMPTY_CONTEXT };
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("Who wins the cricket?");
    expect(screen.getByText("Not enough evidence")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Try asking instead" })).getAllByRole("button").length,
    ).toBe(3);
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("says 'Not enough evidence' when the AI does, with its follow-ups", async () => {
    mocks.runAi.mockResolvedValue({
      status: "not_enough_evidence",
      bullets: [],
      cascade: [],
      forecasts: [],
      follow_up: ["What's driving diesel prices?"],
    });
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("Who wins the cricket?");
    expect(screen.getByText("Not enough evidence")).toBeTruthy();
    expect(screen.getByRole("button", { name: "What's driving diesel prices?" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Closest stories/ })).toBeNull();
  });

  it("explains when the AI isn't available and still shows what WorldGraph found", async () => {
    mocks.runAi.mockRejectedValue(new AiError("unavailable", "Claude isn't available here."));
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("AI answers aren't available here");
    expect(alert.textContent).toContain(
      "In the test link, Ask uses your Claude account while the app is open.",
    );
    expect(screen.getByRole("region", { name: /Closest stories in WorldGraph/ })).toBeTruthy();
  });

  it("explains the website's engine when it is unavailable there", async () => {
    mocks.engine = { kind: "api", label: "WorldGraph AI" };
    mocks.runAi.mockRejectedValue(new AiError("unavailable", "WorldGraph AI isn't available right now."));
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    expect(screen.getByRole("alert").textContent).toContain("On the website, Ask uses WorldGraph AI");
  });

  it("asks the viewer to allow Claude when declined, and can ask again", async () => {
    mocks.runAi.mockRejectedValueOnce(new AiError("declined", "Claude isn't allowed for this page."));
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    expect(screen.getByText("Claude isn't allowed for this page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await flush();
    expect(mocks.runAi).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: /^Answer/ })).toBeTruthy();
  });

  it("shows the data error when retrieval fails", async () => {
    mocks.responses = {};
    mocks.errors = { ask_context: new Error("Database down") };
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("keeps a region it was opened about for the whole conversation, as a chip at the top", async () => {
    mocks.responses = {
      ask_context: CONTEXT,
      region: {
        region: { name: "Gujarat" },
        sector_pulse: [
          { sector: "energy", count: 5 },
          { sector: "finance", count: 2 },
        ],
      },
    };
    const first = render(<AskPanel panel={{ kind: "ask", scope: "region:in-gj" }} />);
    await flush();
    expect(within(screen.getByRole("group", { name: "Conversation subject" })).getByText("Gujarat")).toBeTruthy();
    const suggestions = screen.getByRole("region", { name: "Try asking" });
    expect(within(suggestions).getByRole("button", { name: "How is energy doing in Gujarat?" })).toBeTruthy();

    await ask("What are the risks?");
    expect(askCalls().at(-1)?.args).toMatchObject({ q: "What are the risks? Gujarat" });
    expect(mocks.runAi.mock.calls[0][1]).toMatchObject({ about: { type: "region", name: "Gujarat" } });
    expect(screen.getByRole("separator", { name: "About Gujarat" })).toBeTruthy();
    first.unmount();

    // Opened again from the header (no subject): the same conversation, still about Gujarat.
    render(<AskPanel panel={{ kind: "ask" }} />);
    await flush();
    expect(within(screen.getByRole("group", { name: "Conversation subject" })).getByText("Gujarat")).toBeTruthy();
    await ask("Where are the new opportunities in solar power?");
    expect(mocks.runAi.mock.calls[1][1]).toMatchObject({ about: { type: "region", name: "Gujarat" } });

    // The chip's × asks without it from then on.
    fireEvent.click(screen.getByRole("button", { name: "Stop asking about Gujarat" }));
    expect(useAsk.getState().scope).toBeNull();
    await ask("What moves oil prices worldwide?");
    expect((mocks.runAi.mock.calls[2][1] as { about?: unknown }).about).toBeUndefined();
    expect(screen.getByRole("separator", { name: "General questions" })).toBeTruthy();
  });

  it("on phones, doesn't pop the keyboard up when it opens", async () => {
    mocks.desktop = false;
    render(<AskPanel panel={{ kind: "ask" }} />);
    await flush();
    expect(document.activeElement).not.toBe(box());
  });
});
