import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { AiError } from "@/ai/engine";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import AskPanel from "./AskPanel";
import { __testing as store } from "./ask-store";
import { BRENT, CONTEXT, EMPTY_CONTEXT, JET_FUEL, NOW, OPEC_FORECAST, SURCHARGE } from "./fixtures";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
  runAi: vi.fn<(task: string, input: unknown) => Promise<unknown>>(),
  engine: { kind: "artifact", label: "Your Claude account" } as { kind: string; label: string },
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown) => {
    mocks.calls.push({ name, args });
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
  bullets: [
    { text: "Brent crude is at a multi-month high on tighter supply.", cite: [BRENT.id, "story:invented"] },
    { text: "Airlines could pass higher jet fuel costs on to fares.", cite: [JET_FUEL.id, SURCHARGE.id] },
  ],
  cascade: [{ from: BRENT.id, to: JET_FUEL.id, mechanism: "lifts jet fuel prices" }],
  forecasts: [OPEC_FORECAST.id, "forecast:not-real"],
  follow_up: ["How do OPEC+ cuts affect airlines?"],
};

const askCalls = () => mocks.calls.filter((c) => c.name === "ask_context");
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const top = () => useNav.getState().panels.at(-1);

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await flush();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mocks.responses = { ask_context: CONTEXT };
  mocks.errors = {};
  mocks.calls = [];
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
  it("offers four suggested questions and spends nothing until asked", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    await flush();
    const suggestions = within(screen.getByRole("region", { name: "Try asking" })).getAllByRole("button");
    expect(suggestions).toHaveLength(4);
    expect(suggestions[0].textContent).toContain("What's driving fuel costs in India?");
    expect(screen.getByText("Uses your Claude account. Nothing is sent until you ask.")).toBeTruthy();
    expect(askCalls()).toHaveLength(0);
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("fills the box from a deep link without asking", async () => {
    render(<AskPanel panel={{ kind: "ask", q: "What moves rice prices?" }} />);
    await flush();
    expect((screen.getByLabelText("Your question") as HTMLInputElement).value).toBe("What moves rice prices?");
    expect(askCalls()).toHaveLength(0);
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("shows 'Searching WorldGraph…' while retrieving, with Stop", async () => {
    mocks.responses = {};
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    expect(screen.getByText("Searching WorldGraph…")).toBeTruthy();
    expect(askCalls().at(-1)?.args).toEqual({ q: "What's driving fuel costs?", limit: 12, sample: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Stopped. Nothing more was sent.")).toBeTruthy();
    expect(mocks.runAi).not.toHaveBeenCalled();
  });

  it("answers with cited bullets, a mini cascade, crowd forecasts and follow-ups", async () => {
    useSettings.setState({ sample: "on" });
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");

    expect(askCalls().at(-1)?.args).toMatchObject({ sample: true });
    expect(mocks.runAi).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "What's driving fuel costs?" })).toBeTruthy();

    const answer = screen.getByRole("region", { name: /^Answer/ });
    expect(within(answer).getAllByRole("listitem").filter((li) => li.querySelector("p"))).toHaveLength(2);
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
  });

  it("asks a follow-up when tapped, and keeps the earlier question in this visit's history", async () => {
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("What's driving fuel costs?");
    fireEvent.click(screen.getByRole("button", { name: "How do OPEC+ cuts affect airlines?" }));
    await flush();
    await flush();
    expect(askCalls().at(-1)?.args).toMatchObject({ q: "How do OPEC+ cuts affect airlines?" });
    const earlier = screen.getByRole("region", { name: "Earlier this visit" });
    fireEvent.click(within(earlier).getByRole("button", { name: /What's driving fuel costs\?/ }));
    expect(screen.getByRole("heading", { name: "What's driving fuel costs?" })).toBeTruthy();
  });

  it("says 'Not enough evidence' plainly for an empty context, without the AI", async () => {
    mocks.responses = { ask_context: EMPTY_CONTEXT };
    render(<AskPanel panel={{ kind: "ask" }} />);
    await ask("Who wins the cricket?");
    expect(screen.getByText("Not enough evidence")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Try asking instead" })).getAllByRole("button").length).toBe(3);
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
    expect(alert.textContent).toContain("In the test link, Ask uses your Claude account while the app is open.");
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

  it("suggests questions about a scoped region", async () => {
    mocks.responses = {
      region: {
        region: { name: "Gujarat" },
        sector_pulse: [
          { sector: "energy", count: 5 },
          { sector: "finance", count: 2 },
        ],
      },
    };
    render(<AskPanel panel={{ kind: "ask", scope: "region:in-gj" }} />);
    await flush();
    const region = screen.getByRole("region", { name: "Try asking" });
    expect(within(region).getByText("Gujarat")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "How is energy doing in Gujarat?" })).toBeTruthy();
  });
});
