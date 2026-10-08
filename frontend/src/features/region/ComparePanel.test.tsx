import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { useNav } from "@/state/nav";

import ComparePanel from "./ComparePanel";
import { COMPARE, REGION_INDIA, SEARCH } from "./fixtures";
import { fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
}));

const IDS = ["region:in", "region:us", "region:in-gj"];
const top = () => useNav.getState().panels.at(-1);

beforeEach(() => {
  mocks.responses = { compare: COMPARE, region: REGION_INDIA, search: SEARCH };
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ panels: [{ kind: "compare", ids: IDS }], focus: null, sectors: [], window: "7d" });
});
afterEach(cleanup);

function renderPanel(ids = IDS) {
  return render(<ComparePanel panel={{ kind: "compare", ids }} />);
}

describe("ComparePanel with three places", () => {
  it("asks for all three in the current window", () => {
    renderPanel();
    expect(mocks.calls).toContainEqual({ name: "compare", args: { ids: IDS, window: "7d", sample: undefined }, enabled: true });
  });

  it("heads each column with the place; tapping one opens it", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Open United States of America" })).toBeTruthy();
    expect(screen.getByText("State or province")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Gujarat" }));
    expect(top()).toEqual({ kind: "region", id: "region:in-gj" });
    expect(useNav.getState().focus?.regionId).toBe("region:in-gj");
  });

  it("shows story counts with their impact split", () => {
    renderPanel();
    const stories = screen.getByRole("region", { name: "Stories" });
    expect(within(stories).getByText("17")).toBeTruthy();
    expect(within(stories).getByText("11 opportunity")).toBeTruthy();
    expect(within(stories).getByText("5 risk")).toBeTruthy();
  });

  it("lines up the same measure in one row, with a gap where a place lacks it", () => {
    renderPanel();
    const numbers = screen.getByRole("region", { name: "Key numbers" });
    const rows = within(numbers).getAllByRole("group");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Inflation",
      "Policy rate",
      "Power demand",
      "Industrial power price",
      "Currency per US dollar",
      "Diesel price",
    ]);
    const inflation = rows[0];
    expect(within(inflation).getAllByRole("button", { name: /^Inflation: 3.4%/ }).length).toBeGreaterThan(0);
    expect(within(inflation).getAllByRole("button", { name: /^Inflation: 2.8%/ }).length).toBeGreaterThan(0);
    expect(within(inflation).getByText("Gujarat: not tracked here")).toBeTruthy();
    fireEvent.click(within(inflation).getAllByRole("button", { name: /^Inflation: 2.8%/ })[0]);
    expect(top()).toEqual({ kind: "entity", id: "indicator:us-cpi" });
  });

  it("shows the sector pulse side by side for all nine sectors", () => {
    renderPanel();
    const pulse = screen.getByRole("region", { name: "Sector pulse" });
    const rows = within(pulse).getAllByRole("group");
    expect(rows).toHaveLength(9);
    expect(within(rows[0]).getByText("India: Energy: 7 stories, mostly opportunity, more than the previous 7 days.")).toBeTruthy();
    expect(within(rows[0]).getByText(/United States of America: Energy: no stories/)).toBeTruthy();
  });

  it("removes a place from its chip, keeping the panel in place", () => {
    renderPanel();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/That's the most at once/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove India" }));
    expect(top()).toEqual({ kind: "compare", ids: ["region:us", "region:in-gj"] });
    expect(useNav.getState().panels).toHaveLength(1);
  });

  it("labels sample data", () => {
    renderPanel();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });
});

describe("ComparePanel with fewer places", () => {
  it("with one place, suggests what to compare it with", () => {
    useNav.setState({ panels: [{ kind: "compare", ids: ["region:in"] }] });
    renderPanel(["region:in"]);
    expect(mocks.calls.find((c) => c.name === "compare")?.enabled).toBe(false);
    expect(screen.getByText("Add one more place")).toBeTruthy();
    expect(screen.getByText("Compare India with:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Delhi" }));
    expect(top()).toEqual({ kind: "compare", ids: ["region:in", "region:in-dl"] });
  });

  it("with none, offers a few places to start from", () => {
    useNav.setState({ panels: [{ kind: "compare", ids: [] }] });
    renderPanel([]);
    expect(screen.getByText("Pick places to compare")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add China" }));
    expect(top()).toEqual({ kind: "compare", ids: ["region:cn"] });
  });

  it("adds a place found by search, skipping ones already chosen", async () => {
    const ids = ["region:in", "region:us"];
    useNav.setState({ panels: [{ kind: "compare", ids }] });
    renderPanel(ids);
    const input = screen.getByRole("combobox", { name: "Add a region" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ger" } });
    expect(await screen.findByRole("option", { name: /Germany/ })).toBeTruthy();
    expect(mocks.calls).toContainEqual({ name: "search", args: { q: "ger", types: ["region"], limit: 8 }, enabled: true });
    expect(screen.queryByRole("option", { name: /India/ })).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Minas Gerais/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(top()).toEqual({ kind: "compare", ids: ["region:in", "region:us", "region:br-mg"] });
  });

  it("explains a failure and offers a fresh start", () => {
    mocks.responses = {};
    mocks.errors = { compare: new DataError("server_error", "Not found: region:zz") };
    renderPanel(["region:in", "region:zz"]);
    expect(screen.getByText("No longer available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(top()).toEqual({ kind: "compare", ids: [] });
  });
});
