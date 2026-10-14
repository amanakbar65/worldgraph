import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcArgs, RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { useForecastFilters } from "./filters-store";
import { DEFAULT_FILTERS, forecastLabel } from "./forecast-data";
import ForecastsView from "./ForecastsView";
import { DUBLIN, ECB, FED, LIST, NOW, OPEC, RICE } from "./fixtures";
import { CALL_TO_ACTION, fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
  refetch: null as null | (() => Promise<unknown>),
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    mocks.calls.push({ name, args });
    if (options?.enabled === false) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null, mocks.refetch ?? undefined);
  },
}));

const forecastCalls = () => mocks.calls.filter((c) => c.name === "forecasts").map((c) => c.args as RpcArgs["forecasts"]);
/** The list's request with these changes was sent (the movers always ask for the plain first frame). */
const expectSent = (patch: Partial<RpcArgs["forecasts"]>) =>
  expect(forecastCalls()).toContainEqual({ ...FIRST_FRAME, ...patch });
const top = () => useNav.getState().panels.at(-1);

const FIRST_FRAME = { sectors: [], regions: [], categories: [], sort: "relevance", include_thin: false };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.responses = { forecasts: { forecasts: LIST } };
  mocks.errors = {};
  mocks.calls = [];
  mocks.refetch = null;
  useNav.setState({ panels: [], focus: null, sectors: [], window: "7d", view: "forecasts" });
  useForecastFilters.setState({ ...DEFAULT_FILTERS });
  useSettings.setState({ sample: "auto" });
  localStorage.clear();
  storage.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const list = () => screen.getByRole("region", { name: /^All forecasts/ });
const rows = () =>
  within(list())
    .getAllByRole("listitem")
    .map((li) => within(li).getByRole("button"));
const rowFor = (f: typeof FED) => within(list()).getByRole("button", { name: forecastLabel(f, NOW) });

describe("ForecastsView", () => {
  it("explains what crowd forecasts are, in the words the brief asks for", () => {
    render(<ForecastsView />);
    expect(screen.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeTruthy();
    expect(
      screen.getByText("Crowd forecasts are what forecasters expect, not facts. Play-money sources are labelled."),
    ).toBeTruthy();
  });

  it("asks for the first-frame shape, once for the movers and the list together", () => {
    render(<ForecastsView />);
    const calls = forecastCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).toEqual(FIRST_FRAME);
  });

  it("passes the sample setting through", () => {
    useSettings.setState({ sample: "on" });
    render(<ForecastsView />);
    for (const args of forecastCalls()) expect(args).toEqual({ ...FIRST_FRAME, sample: true });
  });

  it("shows the three biggest moves, skipping thin markets", () => {
    render(<ForecastsView />);
    const movers = screen.getByRole("region", { name: "Biggest moves in 24 hours" });
    const cards = within(movers).getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([OPEC, ECB, FED].map((f) => forecastLabel(f, NOW)));
    expect(within(cards[0]).getByRole("img", { name: /72% crowd forecast, up 16 points/ })).toBeTruthy();
  });

  it("lists every open forecast that isn't thin, with its count", () => {
    render(<ForecastsView />);
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual([OPEC, FED, RICE, ECB].map((f) => forecastLabel(f, NOW)));
    const heading = within(list()).getByRole("heading", { name: /^All forecasts/ });
    expect(heading.textContent).toContain("4");
  });

  it("shows on each row the ring, 24-hour change, volume with unit, end, provider and the crowd label", () => {
    render(<ForecastsView />);
    const row = rowFor(ECB);
    expect(within(row).getByRole("img", { name: /35% crowd forecast/ })).toBeTruthy();
    const text = row.textContent ?? "";
    expect(text).toContain("ECB cuts rates in December?");
    expect(text).toContain("▼ 14");
    expect(text).toContain("48K MANA volume");
    expect(text).toContain("in 2 mo");
    expect(text).toContain("Manifold");
    expect(text).toContain("Play money");
    expect(text).toContain("Crowd forecast");
    expect(text).toMatch(/Updated \d+ min ago/);
  });

  it("labels sample data", () => {
    render(<ForecastsView />);
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });

  it("opens a forecast when its row is tapped, and marks the open one", () => {
    const { rerender } = render(<ForecastsView />);
    fireEvent.click(rowFor(FED));
    expect(top()).toEqual({ kind: "forecast", id: FED.id });
    rerender(<ForecastsView />);
    expect(rowFor(FED).getAttribute("aria-current")).toBe("true");
    expect(rowFor(OPEC).getAttribute("aria-current")).toBeNull();
  });

  it("filters by category, in the request and on screen", () => {
    render(<ForecastsView />);
    const group = screen.getByRole("group", { name: "Categories" });
    const finance = within(group).getByRole("button", { name: "Finance" });
    fireEvent.click(finance);
    expect(finance.getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    expectSent({ categories: ["finance"] });
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual([FED, ECB].map((f) => forecastLabel(f, NOW)));
    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(useForecastFilters.getState().categories).toEqual([]);
    expect(rows()).toHaveLength(4);
  });

  it("sorts by biggest moves, ending soon or volume", () => {
    render(<ForecastsView />);
    const sort = screen.getByRole("combobox", { name: "Sort forecasts" });
    fireEvent.change(sort, { target: { value: "moved" } });
    expectSent({ sort: "moved" });
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual([OPEC, ECB, FED, RICE].map((f) => forecastLabel(f, NOW)));
    expect(screen.getByText("Biggest 24-hour moves first.")).toBeTruthy();
    fireEvent.change(sort, { target: { value: "ending" } });
    expectSent({ sort: "ending" });
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^OPEC\+|^Will the Fed/);
    expect(rows().at(-1)?.getAttribute("aria-label")).toBe(forecastLabel(RICE, NOW));
  });

  it("includes thin markets when asked, tagged as thin", () => {
    render(<ForecastsView />);
    const toggle = screen.getByRole("switch", { name: "Include thin markets" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expectSent({ include_thin: true });
    const row = rowFor(DUBLIN);
    expect(row.textContent).toContain("Thin market");
    expect(row.getAttribute("aria-label")).toContain("thin market");
  });

  it("uses the sector lens shared with the globe, and can turn it off", () => {
    useNav.setState({ sectors: ["energy"] });
    render(<ForecastsView />);
    for (const args of forecastCalls()) expect(args.sectors).toEqual(["energy"]);
    expect(screen.getByText("Within your sector lens.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the Energy lens" }));
    expect(useNav.getState().sectors).toEqual([]);
  });

  it("filters by a place picked from the search", async () => {
    mocks.responses.search = {
      results: [{ id: "region:in", type: "region", subtype: "country", name: "India", context: "Country", score: 1 }],
    };
    render(<ForecastsView />);
    const input = screen.getByRole("combobox", { name: "Filter forecasts by place" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ind" } });
    const option = await screen.findByRole("option", { name: /India/ });
    fireEvent.click(option);
    expect(useForecastFilters.getState().regions).toEqual([{ id: "region:in", name: "India" }]);
    expectSent({ regions: ["region:in"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove India" }));
    expect(useForecastFilters.getState().regions).toEqual([]);
  });

  it("explains an empty result under filters and offers to clear them", () => {
    mocks.responses = { forecasts: { forecasts: [] } };
    useNav.setState({ sectors: ["health"] });
    useForecastFilters.setState({ categories: ["tech"] });
    render(<ForecastsView />);
    expect(screen.getByText("No forecasts match these filters")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Clear filters" }));
    expect(useForecastFilters.getState().categories).toEqual([]);
    expect(useNav.getState().sectors).toEqual([]);
  });

  it("suggests including thin markets when nothing else is open", () => {
    mocks.responses = { forecasts: { forecasts: [] } };
    render(<ForecastsView />);
    expect(screen.getByText("No forecasts to show")).toBeTruthy();
    expect(screen.getByText("No big moves in the last 24 hours. The crowd's numbers have held steady.")).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Include thin markets" }));
    expect(useForecastFilters.getState().includeThin).toBe(true);
  });

  it("offers sample data when there are no forecasts at all", () => {
    mocks.responses = { forecasts: { forecasts: [] } };
    useForecastFilters.setState({ includeThin: true });
    render(<ForecastsView />);
    expect(screen.getByText("No crowd forecasts yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show sample data" }));
    expect(useSettings.getState().sample).toBe("on");
  });

  it("shows skeletons while loading", () => {
    mocks.responses = {};
    render(<ForecastsView />);
    expect(screen.getByLabelText("Loading forecasts")).toBeTruthy();
    expect(screen.getByLabelText("Loading the biggest moves")).toBeTruthy();
  });

  it("explains a failure and retries", () => {
    const refetch = vi.fn(() => Promise.resolve());
    mocks.refetch = refetch;
    mocks.responses = {};
    mocks.errors = { forecasts: new DataError("unavailable", "timeout", true) };
    render(<ForecastsView />);
    expect(screen.getByRole("alert").textContent).toContain("The data is taking a moment");
    expect(screen.queryByRole("region", { name: "Biggest moves in 24 hours" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("never invites anyone to bet or trade", () => {
    useForecastFilters.setState({ includeThin: true });
    render(<ForecastsView />);
    for (const control of [...screen.getAllByRole("button"), ...screen.queryAllByRole("link")]) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name).not.toMatch(CALL_TO_ACTION);
    }
    expect(document.body.textContent).not.toMatch(/\b(bet|betting|wager|trading)\b/i);
  });
});

describe("ForecastsView with a business profile", () => {
  it("sends the profile for the relevance sort and says so", async () => {
    localStorage.setItem(
      "worldgraph.user.profile",
      JSON.stringify({
        name: null,
        sectors: ["finance"],
        locations: [],
        inputs: [],
        suppliers: [],
        markets: [],
        competitors: [],
        keywords: [],
      }),
    );
    render(<ForecastsView />);
    await waitFor(() => expect(forecastCalls().some((a) => a.profile?.sectors[0] === "finance")).toBe(true));
    expect(screen.getByText("Most relevant to your business first.")).toBeTruthy();
  });
});
