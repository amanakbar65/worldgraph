import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import BriefView from "./BriefView";
import { BRIEF, CASCADE, DRAFT, EFFECT, EMPTY_BRIEF, FOCUS, NOW, OPEC_FORECAST, PROFILE, RISK } from "./fixtures";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
  refetch: vi.fn(),
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
      refetch: mocks.refetch,
    };
  },
}));

const briefCalls = () => mocks.calls.filter((c) => c.name === "brief").map((c) => c.args);
const top = () => useNav.getState().panels.at(-1);
const card = (name: string) => screen.getByRole("region", { name });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.responses = { brief: BRIEF, cascade: CASCADE };
  mocks.errors = {};
  mocks.calls = [];
  mocks.refetch.mockReset();
  useNav.setState({ panels: [], view: "brief", focus: null, window: "7d", sectors: [] });
  useSettings.setState({ sample: "auto" });
  localStorage.clear();
  storage.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BriefView", () => {
  it("shows the date, the source note and the six cards in order", async () => {
    render(<BriefView />);
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Daily brief" })).toBeTruthy();
    expect(screen.getByText("Generated from stored data")).toBeTruthy();
    expect(screen.getByText(/Thursday/)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Top risks",
      "Top opportunities",
      "Most reported",
      "Crowd forecasts that moved",
      "Cascade to watch",
      "Region spotlight",
    ]);
  });

  it("asks for the first-frame shape when no profile is saved", async () => {
    render(<BriefView />);
    await flush();
    expect(briefCalls()[0]).toEqual({ sample: undefined });
    expect(briefCalls().every((a) => !("profile" in (a as object)))).toBe(true);
  });

  it("passes the sample setting through", async () => {
    useSettings.setState({ sample: "off" });
    render(<BriefView />);
    await flush();
    expect(briefCalls().at(-1)).toEqual({ sample: false });
  });

  it("tunes to the saved business profile (read only)", async () => {
    localStorage.setItem("worldgraph.user.profile", JSON.stringify(PROFILE));
    render(<BriefView />);
    await flush();
    expect(briefCalls().at(-1)).toEqual({ profile: { ...PROFILE, name: null }, sample: undefined });
    expect(screen.getByText("Tuned to your business")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("worldgraph.user.profile")!)).toEqual(PROFILE);
  });

  it("opens a story from any card", async () => {
    render(<BriefView />);
    await flush();
    fireEvent.click(within(card("Top risks")).getByRole("button", { name: (name) => name.includes(RISK.headline) }));
    expect(top()).toEqual({ kind: "story", id: RISK.id });
  });

  it("shows drafts with their source headline and a draft label, never a so-what", async () => {
    render(<BriefView />);
    await flush();
    const movers = card("Most reported");
    expect(within(movers).getByText(DRAFT.headline)).toBeTruthy();
    expect(within(movers).getByText(/Draft/)).toBeTruthy();
    expect(within(movers).queryByText(DRAFT.so_what!)).toBeNull();
  });

  it("shows crowd forecasts with provider, volume and update time, and opens them", async () => {
    render(<BriefView />);
    await flush();
    const odds = card("Crowd forecasts that moved");
    expect(within(odds).getAllByText("Crowd forecast")).toHaveLength(2);
    expect(within(odds).getByText("Manifold")).toBeTruthy();
    expect(within(odds).getByText("52.3K MANA volume")).toBeTruthy();
    expect(within(odds).getAllByText(/Updated/).length).toBeGreaterThan(0);
    fireEvent.click(within(odds).getAllByRole("button")[0]);
    expect(top()).toEqual({ kind: "forecast", id: OPEC_FORECAST.id });
  });

  it("previews the cascade's effects with link type and confidence, and opens the cascade", async () => {
    render(<BriefView />);
    await flush();
    const cascade = card("Cascade to watch");
    expect(within(cascade).getByText(FOCUS.headline)).toBeTruthy();
    expect(within(cascade).getByText(EFFECT.headline)).toBeTruthy();
    expect(within(cascade).getByText("Inferred")).toBeTruthy();
    expect(within(cascade).getByText("Sets off 6 linked effects")).toBeTruthy();
    fireEvent.click(within(cascade).getByRole("button", { name: "Open the cascade" }));
    expect(top()).toEqual({ kind: "cascade", id: FOCUS.id });
  });

  it("opens the spotlight region and flies the globe there", async () => {
    render(<BriefView />);
    await flush();
    fireEvent.click(within(card("Region spotlight")).getByRole("button", { name: "Open India" }));
    expect(top()).toEqual({ kind: "region", id: "region:in" });
    expect(useNav.getState().focus).toMatchObject({ regionId: "region:in" });
  });

  it("labels sample items and explains the label when the brief is mixed", async () => {
    render(<BriefView />);
    await flush();
    expect(screen.getByText(/Items marked with the flask are illustrative sample data/)).toBeTruthy();
  });

  it("copies the brief as text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<BriefView />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toMatch(/^WorldGraph daily brief · /);
    expect(text).toContain("TOP RISKS");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("explains an empty brief and suggests a next tap", async () => {
    mocks.responses = { brief: EMPTY_BRIEF };
    render(<BriefView />);
    await flush();
    expect(screen.getByText("Nothing to brief on yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(top()).toEqual({ kind: "settings" });
    expect(screen.queryByRole("button", { name: "Copy as text" })).toBeNull();
  });

  it("shows a friendly error with a retry", async () => {
    mocks.responses = {};
    mocks.errors = { brief: new DataError("unavailable", "timeout", true) };
    render(<BriefView />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("The data is taking a moment");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("shows skeletons while loading", async () => {
    mocks.responses = {};
    render(<BriefView />);
    await flush();
    expect(screen.getByLabelText("Loading the brief")).toBeTruthy();
  });
});
