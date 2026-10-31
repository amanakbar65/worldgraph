import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { AiError } from "@/ai/engine";
import { useNav } from "@/state/nav";

import { WEAK_LINK_PROVENANCE } from "@/features/provenance/fixtures";

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
  // The full cascade: the shared minimum confidence (0.5 by default) has its own tests below.
  useNav.setState({ panels: [{ kind: "story", id: FOCUS_ID }, { kind: "cascade", id: FOCUS_ID }], minConfidence: 0 });
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
    // Forecast wording only: never betting words such as "odds".
    expect(within(item).getByText("Crowd forecast, not fact. Information only.")).toBeTruthy();
    expect(item.textContent ?? "").not.toMatch(/\bodds\b/i);
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

  it("groups If YES and If NO effects in labelled lanes with the crowd's forecast", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: /Suez transits recover within six months: crowd forecast from Sample/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "If YES: 31% crowd forecast" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "If NO: 69% crowd forecast" })).toBeTruthy();
    expect(screen.getAllByText("If YES · 31%").length).toBeGreaterThan(0);
  });

  it("credits React Flow once, quietly, in the legend rather than the canvas corner", async () => {
    const { container } = await renderPanel();
    const legend = screen.getByRole("note", { name: "Legend" });
    const credit = within(legend).getByRole("link", { name: "Diagram: React Flow" });
    expect(credit.getAttribute("href")).toBe("https://reactflow.dev");
    expect(credit.getAttribute("rel")).toContain("noopener");
    expect(credit.className).toContain("text-fg-subtle");
    expect(container.querySelector(".react-flow__attribution")).toBeNull();
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

describe("the shared minimum confidence in the cascade", () => {
  beforeEach(() => {
    useNav.setState({ minConfidence: 0.5 });
  });

  it("hides links under it but keeps a link of exactly 0.5, and says how many are hidden", async () => {
    await renderPanel();
    expect(screen.getByText("Frees up ship capacity")).toBeTruthy(); // 0.5: kept
    expect(screen.getByText("Keeps routes long")).toBeTruthy(); // 0.55
    expect(screen.queryByText("Adds bunker fuel costs")).toBeNull(); // 0.45: hidden
    expect(screen.queryByText("Delays inbound cargo")).toBeNull(); // 0.4: hidden, and its story with it
    expect(screen.queryByText(/European retailers may face restock delays/)).toBeNull();
    expect(screen.getByText("3 weaker links hidden")).toBeTruthy();
  });

  it("has a compact control bound to the one shared setting", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Lowest confidence shown: At least 50%" }));
    const slider = await screen.findByRole("slider", { name: "Lowest confidence to show" });
    fireEvent.change(slider, { target: { value: "40" } });
    // Written once the slider rests.
    await waitFor(() => expect(useNav.getState().minConfidence).toBe(0.4));
    expect(screen.getByText("Adds bunker fuel costs")).toBeTruthy();
  });

  it("explains an empty cascade by the filter, and can show weaker links", async () => {
    useNav.setState({ minConfidence: 0.95 });
    await renderPanel();
    expect(screen.getByText("No links this sure")).toBeTruthy();
    expect(screen.getByText(/Lower the confidence filter to see weaker links\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show weaker links" }));
    expect(useNav.getState().minConfidence).toBe(0);
    expect(screen.getByText("Lengthens voyage times")).toBeTruthy();
  });

  it("marks weak links with ? and, with named relations, says ▲ raises", async () => {
    useNav.setState({ minConfidence: 0 });
    mocks.responses = {
      cascade: {
        ...CASCADE,
        links: CASCADE.links.map((l) => (l.id === 174 ? { ...l, relation: "drives", polarity: 1, strength: 0.9, delayed: true } : l)),
      },
      meta: { flags: { "kg.relations": true } },
    };
    await renderPanel();
    expect(screen.getAllByRole("img", { name: "Weak link: under 50% sure, or no source" }).length).toBeGreaterThan(0);
    const red = screen.getByRole("button", { name: /^Cause, 1 step back: Red Sea attacks/ }).closest("li")!;
    expect(within(red).getByText("raises")).toBeTruthy();
    expect(within(red).getByRole("img", { name: "The effect shows after a delay" })).toBeTruthy();
  });

  it("marks a sure link with nothing to cite with ? too (the api's weak, kg.provenance)", async () => {
    mocks.responses = {
      cascade: { ...CASCADE, links: CASCADE.links.map((l) => (l.id === 174 ? { ...l, evidence: [], weak: true } : l)) },
    };
    await renderPanel();
    const red = screen.getByRole("button", { name: /^Cause, 1 step back: Red Sea attacks/ }).closest("li")!;
    expect(within(red).getByRole("img", { name: "Confidence 90%, reported link" })).toBeTruthy();
    expect(within(red).getByRole("img", { name: "Weak link: under 50% sure, or no source" })).toBeTruthy();
  });

  it("says who added a saved link and when, under its evidence (kg.provenance)", async () => {
    mocks.responses = {
      cascade: CASCADE,
      meta: { flags: { "kg.provenance": true } },
      provenance: {
        ...WEAK_LINK_PROVENANCE,
        id: 174,
        weak: false,
        confidence: 0.9,
        kind: "reported",
        added_by: "News pipeline · AI analysis · 22 Oct",
      },
    };
    await renderPanel();
    const red = screen.getByRole("button", { name: /^Cause, 1 step back: Red Sea attacks/ }).closest("li")!;
    fireEvent.click(within(red).getByRole("button", { name: "Evidence" }));
    const added = within(red).getByRole("region", { name: "Added" });
    expect(within(added).getByText("News pipeline · AI analysis · 22 Oct")).toBeTruthy();
    expect(within(added).getByText("Added by")).toBeTruthy();
  });

  it("uses the one trust legend in the flow", async () => {
    mocks.desktop = true;
    await renderPanel();
    const legend = screen.getByRole("note", { name: "Legend" });
    expect(within(legend).getByText("Thicker line: stronger effect")).toBeTruthy();
    expect(within(legend).getByText("Fainter line: less certain")).toBeTruthy();
    expect(within(legend).getByText("Under 50% sure, or no source")).toBeTruthy();
  });
});
