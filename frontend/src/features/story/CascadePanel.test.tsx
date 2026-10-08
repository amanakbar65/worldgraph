import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { AiError } from "@/ai/engine";
import { useNav } from "@/state/nav";

import CascadePanel from "./CascadePanel";
import { CASCADE, EMPTY_CASCADE, FOCUS_ID } from "./fixtures";
import { fakeQuery, installFlowMocks } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  desktop: false,
  engine: { kind: "artifact", label: "Your Claude account" } as { kind: string; label: string },
  runAi: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName) => fakeQuery(mocks.responses[name]),
}));

vi.mock("@/lib/hooks", () => ({
  useIsDesktop: () => mocks.desktop,
  useMediaQuery: () => mocks.desktop,
}));

vi.mock("@/ai/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/engine")>();
  return {
    ...actual,
    getAiEngine: () => Promise.resolve(mocks.engine),
    runAi: (...args: unknown[]) => mocks.runAi(...args),
  };
});

const PROJECTION = {
  effects: [
    {
      headline: "Air freight demand may rise for urgent parts",
      so_what: "Manufacturers with tight schedules would pay more to fly components.",
      impact: "risk",
      direction: "up",
      sectors: ["logistics-trade"],
      region_id: "region:cn-sh",
      mechanism: "shifts urgent cargo",
      lag_days: 10,
      confidence: 0.45,
    },
    {
      headline: "Turkish suppliers may win more European orders",
      so_what: "Buyers seeking shorter routes could move orders to nearer suppliers.",
      impact: "opportunity",
      direction: "up",
      sectors: ["manufacturing"],
      region_id: null,
      mechanism: "favours nearer suppliers",
      lag_days: 90,
      confidence: 0.35,
    },
  ],
};

const top = () => useNav.getState().panels.at(-1);

beforeAll(installFlowMocks);
beforeEach(() => {
  mocks.responses = { cascade: CASCADE };
  mocks.desktop = false;
  mocks.engine = { kind: "artifact", label: "Your Claude account" };
  mocks.runAi.mockReset();
  useNav.setState({ panels: [{ kind: "story", id: FOCUS_ID }, { kind: "cascade", id: FOCUS_ID }] });
});
afterEach(cleanup);

async function renderPanel() {
  const view = render(<CascadePanel panel={{ kind: "cascade", id: FOCUS_ID }} />);
  // Let the AI engine lookup settle.
  await act(async () => {});
  return view;
}

describe("CascadePanel as a list (phones, and the accessible alternative)", () => {
  it("reads causes, the story, then effects step by step", async () => {
    await renderPanel();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.map((h) => h?.replace(/\d+$/, ""))).toEqual([
      "What led to it",
      "This story",
      "What it leads to",
      "2 steps on",
    ]);
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getByText(/7 linked stories within 2 steps/)).toBeTruthy();
  });

  it("shows each link's mechanism, type, confidence and forecast branch", async () => {
    await renderPanel();
    expect(screen.getByText("Lengthens voyage times")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Confidence 90%, reported link" })).toBeTruthy();
    expect(screen.getAllByText("If YES · 31%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("If NO · 69%").length).toBeGreaterThan(0);
  });

  it("opens the evidence for a link inline, in plain words", async () => {
    await renderPanel();
    const red = screen.getByRole("button", { name: /^Cause, 1 step back: Red Sea attacks/ }).closest("li")!;
    const toggle = within(red).getByRole("button", { name: "Evidence" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(red).getByText("A news source reports that one led to the other.")).toBeTruthy();
    expect(within(red).getByText("High confidence (90%)")).toBeTruthy();
    // Sample evidence is labelled and never links out.
    expect(within(red).getByText("Sample source")).toBeTruthy();
    expect(within(red).queryByRole("link")).toBeNull();
  });

  it("explains a conditional link with its crowd forecast", async () => {
    await renderPanel();
    const item = screen.getByRole("button", { name: /^Effect, 1 step on: Surcharges and long transits/ }).closest("li")!;
    const toggles = within(item).getAllByRole("button", { name: "Evidence" });
    fireEvent.click(toggles[toggles.length - 1]);
    expect(within(item).getByText(/Happens only if the crowd forecast resolves NO\. The crowd puts that at 69%\./)).toBeTruthy();
    expect(within(item).getByText("Depends on this crowd forecast")).toBeTruthy();
    expect(within(item).getByText("Source: Sample")).toBeTruthy();
  });

  it("opens a story in place of the cascade", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^Effect, 1 step on: Rotterdam berths/ }));
    expect(top()).toEqual({ kind: "story", id: "story:rotterdam-congestion" });
    expect(useNav.getState().panels).toHaveLength(2);
  });

  it("says so when a story has no causes or effects yet", async () => {
    mocks.responses = { cascade: EMPTY_CASCADE };
    await renderPanel();
    expect(screen.getByText("No causes or effects yet")).toBeTruthy();
  });
});

describe("CascadePanel as a flow (desktop)", () => {
  beforeEach(() => {
    mocks.desktop = true;
  });

  it("draws every story as a card the keyboard can reach, one tab stop at a time", async () => {
    const { container } = await renderPanel();
    const cards = container.querySelectorAll("[data-cascade-node]");
    expect(cards).toHaveLength(8);
    const tabbable = container.querySelectorAll('[data-cascade-node][tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("data-cascade-node")).toBe(FOCUS_ID);
    expect(tabbable[0].getAttribute("aria-label")).toMatch(/^This story: Asia–Europe container rates jump/);
  });

  it("groups If YES and If NO effects in labelled lanes with the crowd's odds", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: /Suez transits recover within six months: crowd forecast from Sample/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "If YES: 31% crowd forecast" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "If NO: 69% crowd forecast" })).toBeTruthy();
    expect(screen.getAllByText("If YES · 31%").length).toBeGreaterThan(0);
  });

  it("offers the list view", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "View as list" }));
    expect(screen.getByText("What led to it")).toBeTruthy();
  });
});

describe("Project next effects (AI)", () => {
  it("runs only on request and shows labelled projections that aren't saved", async () => {
    mocks.runAi.mockResolvedValue(PROJECTION);
    await renderPanel();
    expect(mocks.runAi).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Project next effects" }));
    });
    expect(mocks.runAi).toHaveBeenCalledTimes(1);
    const [task, input] = mocks.runAi.mock.calls[0] as [string, Record<string, unknown>];
    expect(task).toBe("projection");
    expect(input.story).toMatchObject({ headline: expect.stringMatching(/container rates jump/), impact: "risk" });
    expect(input.known_effects).toHaveLength(5);
    expect((input.regions as { id: string }[])[0]).toEqual({ id: "region:cn-sh", name: "Shanghai" });

    await waitFor(() => expect(screen.getByText(/2 AI projections added/)).toBeTruthy());
    const section = screen.getByRole("region", { name: /AI projection/ });
    expect(within(section).getAllByText("Projection, not news")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Clear the AI projections/ })).toBeTruthy();
  });

  it("explains when Claude is declined, and offers to try again", async () => {
    mocks.runAi.mockRejectedValue(new AiError("declined", "Claude isn't allowed for this page."));
    await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Project next effects" }));
    });
    expect(screen.getByText(/Claude isn't allowed for this page yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("hides the button and says why when AI isn't available", async () => {
    mocks.engine = { kind: "none", label: "AI unavailable" };
    await renderPanel();
    expect(screen.queryByRole("button", { name: "Project next effects" })).toBeNull();
    expect(screen.getByLabelText("AI projection unavailable. AI isn't available here.")).toBeTruthy();
  });
});
