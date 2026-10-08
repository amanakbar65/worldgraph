import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";

import { REGION_AHMEDABAD, REGION_INDIA } from "./fixtures";
import RegionPanel from "./RegionPanel";
import { fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    mocks.calls.push({ name, args });
    if (options?.enabled === false) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
}));

const top = () => useNav.getState().panels.at(-1);

beforeEach(() => {
  mocks.responses = { region: REGION_INDIA };
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ panels: [{ kind: "region", id: "region:in" }], focus: null, sectors: [], window: "7d", view: "globe" });
  localStorage.clear();
  storage.reset();
});
afterEach(cleanup);

function renderPanel(id = "region:in") {
  return render(<RegionPanel panel={{ kind: "region", id }} />);
}

describe("RegionPanel (a country)", () => {
  it("asks for the region in the current window", () => {
    renderPanel();
    expect(mocks.calls).toContainEqual({ name: "region", args: { id: "region:in", window: "7d", sample: undefined } });
  });

  it("shows the name, level and the sample label, with no breadcrumb for a country", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: "India" })).toBeTruthy();
    expect(screen.getByText("Country")).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.queryByRole("navigation", { name: "Where this is" })).toBeNull();
  });

  it("shows four KPI tiles that open the indicator", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Key numbers" });
    expect(within(section).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(within(section).getByRole("button", { name: /^Inflation: 3.4%/ }));
    expect(top()).toEqual({ kind: "entity", id: "indicator:in-cpi" });
    expect(within(section).queryByText(/as a whole/)).toBeNull();
  });

  it("shows nine sector tiles; tapping one turns its lens on", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Sector pulse" });
    const tiles = within(section).getAllByRole("button");
    expect(tiles).toHaveLength(9);
    const energy = within(section).getByRole("button", { name: /^Energy: 7 stories, mostly opportunity, more than/ });
    expect(energy.getAttribute("aria-pressed")).toBe("false");
    expect(energy.textContent).toContain("▲");
    fireEvent.click(energy);
    expect(useNav.getState().sectors).toEqual(["energy"]);
    expect(within(section).getByRole("button", { name: /^Energy:/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(section).getByRole("button", { name: /^Tech: no stories/ })).toBeTruthy();
  });

  it("lists top stories; drafts show the source headline and no so-what", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Top stories" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(5);
    const draft = within(section).getByRole("button", { name: /Mundra port handles record container volumes.*Draft, awaiting analysis/ });
    expect(within(draft).getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(within(draft).queryByText(/Neutral|Risk|Opportunity/)).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Show all 6" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(within(section).getByRole("button", { name: /first-stage US–India trade deal/ }));
    expect(top()).toEqual({ kind: "story", id: "story:trade-deal" });
  });

  it("shows decisions ahead as crowd forecasts, not facts", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Decisions ahead" });
    expect(within(section).getByText(/Crowd forecasts about India, soonest first. Not facts/)).toBeTruthy();
    expect(within(section).getAllByText(/Source: Manifold/).length).toBe(2);
    expect(within(section).getAllByText(/MANA volume/).length).toBe(2);
    fireEvent.click(within(section).getByRole("button", { name: /RBI cuts the repo rate at its next review, crowd forecast/ }));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:rbi-cut" });
  });

  it("lists states busiest first and opens one on the globe", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: /States and provinces/ });
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(within(section).getByRole("button", { name: "Show all" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(7);
    fireEvent.click(within(section).getByRole("button", { name: "Delhi: 2 opportunity, 3 risk." }));
    expect(top()).toEqual({ kind: "region", id: "region:in-dl" });
    expect(useNav.getState().focus?.regionId).toBe("region:in-dl");
  });

  it("draws the connections and opens what you tap", () => {
    renderPanel();
    const graph = screen.getByRole("group", { name: "Connections of India: 6 of 6 shown" });
    fireEvent.click(within(graph).getByRole("button", { name: "Rice, commodity" }));
    expect(top()).toEqual({ kind: "entity", id: "commodity:rice" });
    fireEvent.click(within(graph).getByRole("button", { name: "India signals rice export curbs, story, risk, sample data" }));
    expect(top()).toEqual({ kind: "story", id: "story:rice-curbs" });
    fireEvent.click(within(graph).getByRole("button", { name: "Will the RBI cut the repo rate?, crowd forecast, sample data" }));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:rbi-cut" });
    fireEvent.click(within(graph).getByRole("button", { name: "Gujarat, region" }));
    expect(top()).toEqual({ kind: "region", id: "region:in-gj" });
    fireEvent.click(screen.getByRole("button", { name: "Open full page" }));
    expect(top()).toEqual({ kind: "entity", id: "region:in" });
  });

  it("asks about the region and starts a comparison", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Ask about this region" }));
    expect(top()).toEqual({ kind: "ask", scope: "region:in" });
    fireEvent.click(screen.getByRole("button", { name: "Compare India with other regions" }));
    expect(top()).toEqual({ kind: "compare", ids: ["region:in"] });
  });

  it("adds the region to the watchlist and takes it off again", async () => {
    renderPanel();
    const watch = screen.getByRole("button", { name: "Watch India" });
    expect(watch.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect((watch as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(watch);
    expect(screen.getByRole("button", { name: "Watch India" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("India added to your watchlist.")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("worldgraph.user.watchlist") ?? "[]")).toEqual(["region:in"]));
    fireEvent.click(screen.getByRole("button", { name: "Watch India" }));
    expect(screen.getByText("India removed from your watchlist.")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("worldgraph.user.watchlist") ?? "[]")).toEqual([]));
  });

  it("starts fresh when it moves on to another place", () => {
    const view = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Show all 6" }));
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
    mocks.responses = { region: { ...REGION_INDIA, region: { ...REGION_INDIA.region, id: "region:pk", name: "Pakistan" } } };
    view.rerender(<RegionPanel panel={{ kind: "region", id: "region:pk" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Pakistan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 6" })).toBeTruthy();
  });

  it("changes the window from the panel", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(useNav.getState().window).toBe("30d");
  });
});

describe("RegionPanel (a city with national figures and a quiet week)", () => {
  beforeEach(() => {
    mocks.responses = { region: REGION_AHMEDABAD };
    useNav.setState({ panels: [{ kind: "region", id: "region:in-gj.ahmedabad" }] });
  });

  it("shows the path down from the country; tapping a step flies there", () => {
    renderPanel("region:in-gj.ahmedabad");
    const crumbs = screen.getByRole("navigation", { name: "Where this is" });
    expect(within(crumbs).getByText("Ahmedabad").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText(/City · Population 5.4M/)).toBeTruthy();
    fireEvent.click(within(crumbs).getByRole("button", { name: "Gujarat" }));
    expect(top()).toEqual({ kind: "region", id: "region:in-gj" });
    expect(useNav.getState().focus?.regionId).toBe("region:in-gj");
  });

  it("says when the key numbers are the country's", () => {
    renderPanel("region:in-gj.ahmedabad");
    expect(screen.getByText("Figures for India as a whole")).toBeTruthy();
  });

  it("suggests a longer window when there are no stories, and forecasts when no decisions", () => {
    renderPanel("region:in-gj.ahmedabad");
    expect(screen.getByText("No stories in the last 7 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 30 days" }));
    expect(useNav.getState().window).toBe("30d");
    expect(screen.getByText("No upcoming decisions tracked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Browse forecasts" }));
    expect(useNav.getState().view).toBe("forecasts");
    expect(screen.queryByRole("region", { name: /Cities|States/ })).toBeNull();
    expect(screen.getByText("No connections yet")).toBeTruthy();
  });
});

describe("RegionPanel states", () => {
  it("shows a skeleton while loading", () => {
    mocks.responses = {};
    renderPanel();
    expect(screen.getByLabelText("Loading region").getAttribute("aria-busy")).toBe("true");
  });

  it("explains a region that no longer exists", () => {
    mocks.responses = {};
    mocks.errors = { region: new DataError("server_error", "Not found: region:zz") };
    renderPanel("region:zz");
    expect(screen.getByText("No longer available")).toBeTruthy();
  });

  it("offers a retry when the database is asleep", () => {
    mocks.responses = {};
    mocks.errors = { region: new DataError("unavailable", "timeout", true) };
    renderPanel();
    expect(screen.getByText("The data is taking a moment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
