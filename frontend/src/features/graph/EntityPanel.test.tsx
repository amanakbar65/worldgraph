import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { __testing as storage } from "@/platform/storage";
import { useNav, type Panel } from "@/state/nav";

import { SAVE_DELAY_MS } from "./entity-notes";
import EntityPanel from "./EntityPanel";
import { CRUDE, NOW, UAE, UAE_CPI } from "./fixtures";
import { useGraphState } from "./graph-state";
import { fakeQuery, stubMatchMedia } from "./test-utils";

const mocks = vi.hoisted(() => ({
  entities: {} as Record<string, unknown>,
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: { id?: string; q?: string }, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    if (mocks.errors[name]) return fakeQuery(undefined, mocks.errors[name]);
    if (name === "entity") return fakeQuery(mocks.entities[args.id ?? ""]);
    return fakeQuery(mocks.responses[name]);
  },
}));

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const top = () => useNav.getState().panels.at(-1);

function renderPanel(id: string, below: Panel[] = []) {
  const panel = { kind: "entity" as const, id };
  useNav.setState({ panels: [...below, panel] });
  return render(<EntityPanel panel={panel} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stubMatchMedia(() => true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.entities = { [CRUDE.entity.id]: CRUDE, [UAE_CPI.entity.id]: UAE_CPI, [UAE.entity.id]: UAE };
  mocks.responses = { search: { results: [] } };
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ view: "graph", panels: [], window: "7d", sectors: [], focus: null });
  localStorage.clear();
  storage.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EntityPanel", () => {
  it("shows what it is: name, kind, summary, other names and the sample label", () => {
    renderPanel("commodity:crude-oil");
    expect(screen.getByRole("heading", { level: 2, name: "Crude oil" })).toBeTruthy();
    expect(screen.getByText("Commodity")).toBeTruthy();
    expect(screen.getByText(/Unrefined petroleum/)).toBeTruthy();
    expect(screen.getByText("Also called Brent, WTI, oil")).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });

  it("lists facts, with names that open their pages", () => {
    renderPanel("commodity:crude-oil");
    const facts = screen.getByRole("region", { name: "Key facts" });
    expect(within(facts).getByText("2709")).toBeTruthy();
    expect(within(facts).queryByText("Type")).toBeNull();
    fireEvent.click(within(facts).getByRole("button", { name: "Saudi Arabia, region" }));
    expect(top()).toEqual({ kind: "region", id: "region:sa" });
  });

  it("shows key numbers that open the indicator", () => {
    renderPanel("commodity:crude-oil");
    const numbers = screen.getByRole("region", { name: "Key numbers" });
    fireEvent.click(within(numbers).getByRole("button", { name: /^Brent crude/ }));
    expect(top()).toEqual({ kind: "entity", id: "indicator:brent-crude" });
  });

  it("has a timeline: analysed stories open, drafts show their headline and no so-what", () => {
    renderPanel("commodity:crude-oil");
    const news = screen.getByRole("region", { name: /In the news/ });
    expect(within(news).getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(within(news).queryByText("Shipping costs rise for importers.")).toBeNull();
    fireEvent.click(within(news).getByRole("button", { name: /^Refinery outage reported at Jamnagar complex/ }));
    expect(top()).toEqual({ kind: "story", id: "story:refinery-outage-draft" });
    fireEvent.click(within(news).getByRole("button", { name: /^Red Sea attacks/ }));
    expect(top()).toEqual({ kind: "story", id: "story:red-sea-attacks" });
  });

  it("shows crowd forecasts with their source, volume, update time and history", () => {
    renderPanel("commodity:crude-oil");
    const section = screen.getByRole("region", { name: /Crowd forecasts/ });
    expect(within(section).getByText(/Not facts; for information only/)).toBeTruthy();
    expect(within(section).getByText("Source: Sample forecast")).toBeTruthy();
    expect(within(section).getByText("412K MANA volume")).toBeTruthy();
    expect(within(section).getByText(/^Updated/)).toBeTruthy();
    expect(within(section).getByText(/, crowd forecast/)).toBeTruthy();
    expect(within(section).getByText(/Crowd forecast history: 48% on .*, 72% now/)).toBeTruthy();
    expect(within(section).queryByRole("link")).toBeNull(); // no url, no link
    fireEvent.click(within(section).getByRole("button", { name: /OPEC\+ extends output cuts/ }));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:opec-cut" });
  });

  it("groups backlinks by kind, without repeating forecasts and numbers", () => {
    renderPanel("commodity:crude-oil");
    const section = screen.getByRole("region", { name: "Linked from" });
    expect(within(section).getByText("Places")).toBeTruthy();
    expect(within(section).getByText("Organisations")).toBeTruthy();
    expect(within(section).queryByText("Brent crude")).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "ONGC, organisation" }));
    expect(top()).toEqual({ kind: "entity", id: "org:ongc" });
  });

  it("opens the graph around it", () => {
    renderPanel("commodity:crude-oil");
    fireEvent.click(screen.getByRole("button", { name: "Show Crude oil in the knowledge graph" }));
    expect(useNav.getState().view).toBe("graph");
    expect(useGraphState.getState().scope).toEqual({ kind: "local", id: "commodity:crude-oil", name: "Crude oil", depth: 2 });
  });

  it("asks for the second ring of the local graph only when chosen", () => {
    renderPanel("commodity:crude-oil");
    expect(mocks.calls.some((c) => c.name === "local_graph" && c.enabled)).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Up to 2 steps away" }));
    expect(mocks.calls).toContainEqual({
      name: "local_graph",
      args: { id: "commodity:crude-oil", depth: 2, limit: 120 },
      enabled: true,
    });
  });

  it("saves a private note in this browser a moment after typing", async () => {
    renderPanel("commodity:crude-oil");
    const box = await waitForEnabled(screen.getByRole("textbox", { name: "Your note on Crude oil" }));
    expect(screen.getByText("Private to you. Saved in this browser only.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Watch Brent before ordering. See [[Mundra Port]]." } });
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(localStorage.getItem("worldgraph.user.notes")).toBeNull();
    await screen.findByText("Saved", undefined, { timeout: SAVE_DELAY_MS + 1000 });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("worldgraph.user.notes") ?? "{}")).toEqual({
        "commodity:crude-oil": "Watch Brent before ordering. See [[Mundra Port]].",
      }),
    );
  });

  it("brings back a saved note and turns [[links]] into chips", async () => {
    localStorage.setItem("worldgraph.user.notes", JSON.stringify({ "commodity:crude-oil": "Compare with [[Mundra Port]]" }));
    mocks.responses.search = {
      results: [{ id: "infra:mundra-port", type: "infrastructure", subtype: "port", name: "Mundra Port", context: null, score: 1 }],
    };
    renderPanel("commodity:crude-oil");
    const box = await waitForEnabled(screen.getByRole("textbox", { name: "Your note on Crude oil" }));
    expect((box as HTMLTextAreaElement).value).toBe("Compare with [[Mundra Port]]");
    const chip = await screen.findByRole("button", { name: "Mundra Port, infrastructure" });
    fireEvent.click(chip);
    expect(top()).toEqual({ kind: "entity", id: "infra:mundra-port" });
  });

  it("saves the note when leaving the page", async () => {
    const view = renderPanel("commodity:crude-oil");
    const box = await waitForEnabled(screen.getByRole("textbox", { name: "Your note on Crude oil" }));
    fireEvent.change(box, { target: { value: "Left before the timer" } });
    view.unmount();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("worldgraph.user.notes") ?? "{}")).toEqual({
        "commodity:crude-oil": "Left before the timer",
      }),
    );
  });

  it("shows how it touches your business", async () => {
    localStorage.setItem(
      "worldgraph.user.profile",
      JSON.stringify({
        name: null,
        sectors: ["energy"],
        locations: [],
        inputs: ["commodity:crude-oil"],
        suppliers: [],
        markets: [],
        competitors: [],
        keywords: [],
      }),
    );
    renderPanel("commodity:crude-oil");
    const box = await screen.findByRole("region", { name: "Impact on you" });
    expect(within(box).getByText("An input you buy")).toBeTruthy();
    expect(within(box).getByText("1 risk")).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "See what affects your business" }));
    expect(useNav.getState().view).toBe("business");
  });

  it("gives an indicator its own latest figure, from what it measures", () => {
    renderPanel("indicator:ae-cpi");
    expect(screen.getByText("Indicator · Monthly")).toBeTruthy();
    const facts = screen.getByRole("region", { name: "Key facts" });
    expect(within(facts).getByText("Measures")).toBeTruthy();
    expect(mocks.calls).toContainEqual({ name: "entity", args: { id: "region:ae" }, enabled: true });
    const figure = screen.getByRole("region", { name: "Latest figure" });
    expect(within(figure).getByText(/^Source: Sample series · as of/)).toBeTruthy();
    expect(within(figure).getByText(/^Inflation: 2.2%, up 0.1 points/)).toBeTruthy();
  });

  it("hands places, stories and forecasts to their own panels", () => {
    renderPanel("region:in", [{ kind: "story", id: "story:x" }]);
    expect(top()).toEqual({ kind: "region", id: "region:in" });
    expect(mocks.calls.some((c) => c.name === "entity" && c.enabled)).toBe(false);
    cleanup();
    renderPanel("story:red-sea-attacks");
    expect(top()).toEqual({ kind: "story", id: "story:red-sea-attacks" });
    cleanup();
    renderPanel("forecast:opec-cut");
    expect(top()).toEqual({ kind: "forecast", id: "forecast:opec-cut" });
  });

  it("shows a place's full page when its own panel asks for it", () => {
    renderPanel("region:ae", [{ kind: "region", id: "region:ae" }]);
    expect(top()).toEqual({ kind: "entity", id: "region:ae" });
    expect(screen.getByRole("heading", { level: 2, name: "United Arab Emirates" })).toBeTruthy();
  });

  it("says when an entity is no longer available", () => {
    renderPanel("commodity:gone");
    mocks.errors.entity = new Error("Not found: commodity:gone");
    cleanup();
    renderPanel("commodity:gone");
    expect(screen.getByText("No longer available")).toBeTruthy();
  });

  it("shows a skeleton while loading", () => {
    renderPanel("commodity:unknown-yet");
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });
});

async function waitForEnabled(el: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect((el as HTMLTextAreaElement).disabled).toBe(false));
  return el;
}
