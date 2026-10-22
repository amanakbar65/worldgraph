import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName, SearchResponse } from "@/api/contract";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

import { CommandSearch } from "./CommandSearch";

const RESULTS: SearchResponse["results"] = [
  { id: "region:in", type: "region", subtype: "country", name: "India", context: "Country · Southern Asia", score: 1.15 },
  {
    id: "story:india-retail-inflation",
    type: "story",
    subtype: null,
    name: "India's retail inflation rises as vegetable prices climb",
    context: "Story · India · risk",
    score: 0.9,
  },
  {
    id: "forecast:india-peak-power",
    type: "forecast",
    subtype: null,
    name: "India's peak power demand above 270 GW this season?",
    context: "Forecast · 46%",
    score: 0.85,
  },
  {
    id: "policy:india-semiconductor-mission",
    type: "policy",
    subtype: "subsidy",
    name: "India Semiconductor Mission",
    context: "Policy · Subsidy",
    score: 0.8,
  },
];

const mocks = vi.hoisted(() => ({
  results: [] as unknown[],
  /** Answers for particular queries (others get `results`). */
  byQuery: {} as Record<string, unknown[]>,
  /** Queries whose answer hasn't arrived yet: the last answer shows as a placeholder (keepPreviousData). */
  pending: new Set<string>(),
  last: undefined as unknown,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
  listeners: new Set<() => void>(),
  version: 0,
}));

vi.mock("@/api/client", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  };
  return {
    useRpc: (name: RpcName, args: { q?: string }, options?: { enabled?: boolean }) => {
      useSyncExternalStore(subscribe, () => mocks.version);
      const enabled = options?.enabled !== false;
      mocks.calls.push({ name, args, enabled });
      const q = args.q ?? "";
      if (enabled && mocks.pending.has(q)) {
        const placeholder = mocks.last;
        return {
          data: placeholder,
          error: null,
          isPending: placeholder === undefined,
          isError: false,
          isFetching: true,
          isPlaceholderData: placeholder !== undefined,
          refetch: vi.fn(),
        };
      }
      const data = enabled ? { results: mocks.byQuery[q] ?? mocks.results } : undefined;
      if (data) mocks.last = data;
      return {
        data,
        error: null,
        isPending: !data,
        isError: false,
        isFetching: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      };
    },
  };
});

/** The answer for `q` arrives. */
async function answer(q: string) {
  mocks.pending.delete(q);
  mocks.version += 1;
  await act(async () => mocks.listeners.forEach((listener) => listener()));
}

const searchCalls = () => mocks.calls.filter((c) => c.name === "search" && c.enabled).map((c) => c.args);
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const input = () => screen.getByPlaceholderText("Search places, companies, stories, forecasts…");
const top = () => useNav.getState().panels.at(-1);

async function open() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await wait(0);
}

async function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await wait(260);
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  mocks.results = RESULTS;
  mocks.byQuery = {};
  mocks.pending.clear();
  mocks.last = undefined;
  mocks.calls = [];
  useUi.setState({ searchOpen: false });
  useNav.setState({ panels: [], view: "globe", focus: null });
  useSettings.setState({ theme: "dark" });
  document.documentElement.setAttribute("data-wg-theme", "dark");
  localStorage.clear();
  storage.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandSearch", () => {
  it("opens with Ctrl+K and closes with it again", async () => {
    render(<CommandSearch />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await open();
    expect(screen.getByRole("dialog", { name: "Search WorldGraph" })).toBeTruthy();
    await open();
    expect(useUi.getState().searchOpen).toBe(false);
  });

  it("gives focus back to what had it when Escape closes the search", async () => {
    render(
      <>
        <button type="button">Settings</button>
        <CommandSearch />
      </>,
    );
    const before = screen.getByRole("button", { name: "Settings" });
    before.focus();
    await open();
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    await wait(10);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("offers quick actions before anything is typed", async () => {
    render(<CommandSearch />);
    await open();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Ask a question",
      "Go to Forecasts",
      "Open the daily brief",
      "Switch to light theme",
      "Open settings",
    ]);
    expect(searchCalls()).toHaveLength(0);
  });

  it("waits for two letters and a pause before searching", async () => {
    render(<CommandSearch />);
    await open();
    fireEvent.change(input(), { target: { value: "i" } });
    await wait(260);
    expect(screen.getByText("Keep typing: two letters or more.")).toBeTruthy();
    expect(searchCalls()).toHaveLength(0);
    fireEvent.change(input(), { target: { value: "ind" } });
    fireEvent.change(input(), { target: { value: "india" } });
    await wait(260);
    expect(searchCalls()).toEqual([{ q: "india", limit: 20 }]);
  });

  it("groups results by type with their context", async () => {
    render(<CommandSearch />);
    await open();
    await type("india");
    const groups = screen
      .getAllByRole("group")
      .map((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent);
    expect(groups).toEqual(["Places", "Stories", "Crowd forecasts", "Policies", "Actions"]);
    const story = screen.getByRole("option", { name: /retail inflation/ });
    expect(within(story).getByText("India")).toBeTruthy();
    expect(within(story).getByText("Risk")).toBeTruthy();
    expect(screen.getByRole("option", { name: /peak power/ }).textContent).toContain("46% crowd forecast");
  });

  it("opens a place with Enter, flies the globe there and remembers it", async () => {
    render(<CommandSearch />);
    await open();
    await type("india");
    fireEvent.keyDown(input(), { key: "Enter" });
    await wait(0);
    expect(top()).toEqual({ kind: "region", id: "region:in" });
    expect(useNav.getState().focus).toMatchObject({ regionId: "region:in" });
    expect(useUi.getState().searchOpen).toBe(false);

    await open();
    const recent = screen.getByRole("group", { name: /Recent/ });
    expect(within(recent).getByRole("option", { name: /India/ })).toBeTruthy();
  });

  it("moves with the arrow keys and opens stories, forecasts and entities in their panels", async () => {
    render(<CommandSearch />);
    await open();
    await type("india");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(top()).toEqual({ kind: "story", id: "story:india-retail-inflation" });

    await open();
    await type("india");
    fireEvent.click(screen.getByRole("option", { name: /Semiconductor Mission/ }));
    expect(top()).toEqual({ kind: "entity", id: "policy:india-semiconductor-mission" });

    await open();
    await type("india");
    fireEvent.click(screen.getByRole("option", { name: /peak power/ }));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:india-peak-power" });
  });

  it("does nothing on a quick Enter before results arrive, then opens the best match", async () => {
    render(<CommandSearch />);
    await open();
    fireEvent.change(input(), { target: { value: "india" } });
    await wait(0);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(top()).toBeUndefined();
    expect(useUi.getState().searchOpen).toBe(true);
    await wait(260);
    expect(screen.getByRole("option", { name: /^India/, selected: true })).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(top()).toEqual({ kind: "region", id: "region:in" });
  });

  it("never opens the previous query's top result while the new answer loads", async () => {
    const INDONESIA = { id: "region:id", type: "region", subtype: "country", name: "Indonesia", context: "Country", score: 1.2 };
    mocks.byQuery = { ind: RESULTS, indonesia: [INDONESIA] };
    render(<CommandSearch />);
    await open();
    await type("ind");
    expect(screen.getByRole("option", { name: /^IndiaCountry/, selected: true })).toBeTruthy();

    mocks.pending.add("indonesia");
    fireEvent.change(input(), { target: { value: "indonesia" } });
    await wait(0);
    // Still in the pause: the "ind" rows stay on screen but can't be opened.
    expect(screen.getAllByRole("option").every((o) => o.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(top()).toBeUndefined();

    // The search for "indonesia" has gone out but not come back: still nothing to open.
    await wait(260);
    expect(searchCalls()).toContainEqual({ q: "indonesia", limit: 20 });
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /^IndiaCountry/ }));
    expect(top()).toBeUndefined();
    expect(useUi.getState().searchOpen).toBe(true);

    // The answer arrives: its best match is highlighted and Enter opens it.
    await answer("indonesia");
    expect(screen.getByRole("option", { name: /^Indonesia/, selected: true })).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(top()).toEqual({ kind: "region", id: "region:id" });
  });

  it("offers to ask what was typed", async () => {
    render(<CommandSearch />);
    await open();
    await type("why is diesel up");
    fireEvent.click(screen.getByRole("option", { name: "Ask: “why is diesel up”" }));
    expect(top()).toEqual({ kind: "ask", q: "why is diesel up" });
  });

  it("says so when nothing matches, and still offers Ask", async () => {
    mocks.results = [];
    render(<CommandSearch />);
    await open();
    await type("zzzz");
    expect(screen.getByText("No matches for “zzzz”")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ask: “zzzz”" })).toBeTruthy();
  });

  it("runs quick actions: go to Forecasts and toggle the theme", async () => {
    render(<CommandSearch />);
    await open();
    fireEvent.click(screen.getByRole("option", { name: "Go to Forecasts" }));
    expect(useNav.getState().view).toBe("forecasts");

    await open();
    fireEvent.click(screen.getByRole("option", { name: "Switch to light theme" }));
    expect(useSettings.getState().theme).toBe("light");
  });

  it("finds actions by their keywords", async () => {
    render(<CommandSearch />);
    await open();
    await type("dark mode");
    expect(screen.getByRole("option", { name: "Switch to light theme" })).toBeTruthy();
  });
});
