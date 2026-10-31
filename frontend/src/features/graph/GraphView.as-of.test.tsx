/** The graph "as of" a past day (kg.history): the date control, the banner, the calls, and when it is off. */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConnection } from "@/api/connection";
import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { useHistoryStart } from "./as-of";
import { GRAPH, LOCAL } from "./fixtures";
import { useGraphState } from "./graph-state";
import GraphView from "./GraphView";
import { fakeQuery, stubElementSize, stubMatchMedia } from "./test-utils";

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

vi.mock("react-force-graph-2d", () => {
  type Props = { graphData: { nodes: { id: string; name: string; x?: number; y?: number }[] } };
  const FakeGraph = forwardRef<unknown, Props>(function FakeGraph(props, ref) {
    useImperativeHandle(ref, () => ({
      d3Force: () => ({ strength: () => {}, distanceMax: () => {}, distance: () => {} }),
      zoom: () => 1,
      centerAt: () => {},
      zoomToFit: () => {},
      graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
    }));
    props.graphData.nodes.forEach((n, i) => {
      n.x ??= i * 10;
      n.y ??= i * 10;
    });
    return <div data-testid="force-graph">{props.graphData.nodes.length} nodes</div>;
  });
  return { default: FakeGraph };
});

const HISTORY = { flags: { "kg.history": true }, data: { showing_sample: false } };
const AS_OF = { ...GRAPH, as_of: "2026-10-29T23:59:59.999999+00:00", history_starts: "2026-10-28T09:00:00+00:00" };
const called = (name: string) => mocks.calls.filter((c) => c.name === name && c.enabled);
const control = () => screen.getByTestId("as-of-control");
const initialGraphState = useGraphState.getState();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  mocks.responses = {
    meta: HISTORY,
    graph: GRAPH,
    local_graph: LOCAL,
    graph_as_of: AS_OF,
    local_graph_as_of: { ...LOCAL, as_of: AS_OF.as_of, history_starts: AS_OF.history_starts },
    search: { results: [] },
  };
  mocks.errors = {};
  mocks.calls = [];
  stubMatchMedia(() => true);
  stubElementSize();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useNav.setState({ view: "graph", panels: [], window: "7d", sectors: [], minConfidence: 0.5, asOf: null, focus: null });
  useGraphState.setState(initialGraphState, true);
  useSettings.setState({ sample: "off", calm: false });
  useConnection.setState({ state: { status: "live", source: "http" } });
  useHistoryStart.setState({ day: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useNav.setState({ view: "globe", asOf: null });
});

describe("the graph as of a past day", () => {
  it("isn't offered while kg.history is off", () => {
    mocks.responses.meta = { flags: {} };
    useNav.setState({ asOf: "2026-10-29" });
    render(<GraphView />);
    expect(screen.queryByTestId("as-of-control")).toBeNull();
    expect(screen.queryByTestId("as-of-banner")).toBeNull();
    expect(called("graph_as_of")).toHaveLength(0);
    expect(called("graph").length).toBeGreaterThan(0);
  });

  it("picks a day in the scope bar, reads the as-of call and says so in a banner", () => {
    render(<GraphView />);
    expect(control().getAttribute("aria-label")).toBe("Show the graph on a past date");
    fireEvent.click(control());
    const day = screen.getByLabelText("Day to show");
    expect(day.getAttribute("max")).toBe("2026-10-30");
    fireEvent.change(day, { target: { value: "2026-10-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(useNav.getState().asOf).toBe("2026-10-29");
    expect(called("graph_as_of").at(-1)?.args).toMatchObject({ at: "2026-10-29", window: "7d", sample: false });
    const banner = screen.getByTestId("as-of-banner");
    expect(within(banner).getByText("As of 29 Oct 2026")).toBeTruthy();
    expect(screen.getByText("Showing the graph as of 29 Oct 2026.")).toBeTruthy();
    expect(control().getAttribute("aria-label")).toBe("As of 29 Oct 2026. Change the date");
    // The answer says when history starts: that is the earliest day offered.
    expect(useHistoryStart.getState().day).toBe("2026-10-28");

    fireEvent.click(within(banner).getByRole("button", { name: "Back to now" }));
    expect(useNav.getState().asOf).toBeNull();
    expect(screen.queryByTestId("as-of-banner")).toBeNull();
    // The live graph again (flag reads of api.meta, e.g. for "Why is this here?" marks, aside).
    expect(mocks.calls.filter((c) => c.enabled && c.name !== "meta").at(-1)?.name).toBe("graph");
  });

  it("reads the neighbourhood of one node as of the day too", () => {
    useGraphState.getState().showAround({ id: "commodity:crude-oil", name: "Crude oil" }, 2);
    useNav.setState({ asOf: "2026-10-29" });
    render(<GraphView />);
    expect(called("local_graph_as_of").at(-1)?.args).toMatchObject({ id: "commodity:crude-oil", depth: 2, at: "2026-10-29" });
    expect(called("local_graph")).toHaveLength(0);
  });

  it("waits for meta before choosing which call a deep link needs", () => {
    mocks.responses.meta = undefined;
    useNav.setState({ asOf: "2026-10-29" });
    render(<GraphView />);
    expect(called("graph")).toHaveLength(0);
    expect(called("graph_as_of")).toHaveLength(0);
    expect(within(screen.getByTestId("as-of-banner")).getByText(/Loading/)).toBeTruthy();
  });

  it("is off with sample data, with a short reason and no error", () => {
    useSettings.setState({ sample: "on" });
    useNav.setState({ asOf: "2026-10-29" });
    render(<GraphView />);
    expect(control().getAttribute("aria-disabled")).toBe("true");
    expect(control().getAttribute("aria-label")).toBe("Past dates: Sample data has no history");
    expect(called("graph_as_of")).toHaveLength(0);
    expect(called("graph").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("as-of-banner")).getByText("Can't show 29 Oct 2026")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(control());
    expect(screen.getByText(/Turn Sample data off in Settings/)).toBeTruthy();
    expect(screen.queryByLabelText("Day to show")).toBeNull();
  });

  it("is off while the app shows sample data by itself (no live data yet)", () => {
    useSettings.setState({ sample: "auto" });
    mocks.responses.meta = { ...HISTORY, data: { showing_sample: true } };
    render(<GraphView />);
    expect(control().getAttribute("aria-label")).toBe("Past dates: Sample data has no history");
  });

  it("is off from the saved snapshot, which has no as-of answers", () => {
    useConnection.setState({ state: { status: "snapshot", reason: new DataError("offline", "No connector") } });
    render(<GraphView />);
    expect(control().getAttribute("aria-label")).toBe("Past dates: Needs live data");
    expect(control().getAttribute("title")).toBe("Needs live data");
  });

  it("before history starts, offers its first day instead of an error", () => {
    mocks.responses.graph_as_of = undefined;
    mocks.errors.graph_as_of = new DataError("server_error", "History starts on 28 Oct 2026");
    useNav.setState({ asOf: "2026-10-01" });
    render(<GraphView />);
    expect(screen.getByText("History starts on 28 Oct 2026")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useHistoryStart.getState().day).toBe("2026-10-28");
    act(() => fireEvent.click(screen.getByRole("button", { name: "Show 28 Oct 2026" })));
    expect(useNav.getState().asOf).toBe("2026-10-28");
  });

  it("keeps a chosen day within history once its start is known", () => {
    useHistoryStart.setState({ day: "2026-10-28" });
    render(<GraphView />);
    fireEvent.click(control());
    const day = screen.getByLabelText("Day to show");
    expect(day.getAttribute("min")).toBe("2026-10-28");
    expect(screen.getByText(/History starts on 28 Oct 2026/)).toBeTruthy();
    fireEvent.change(day, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(useNav.getState().asOf).toBe("2026-10-28");
  });

  it("other errors keep the usual error state", () => {
    mocks.responses.graph_as_of = undefined;
    mocks.errors.graph_as_of = new DataError("unavailable", "The database didn't answer.", true);
    useNav.setState({ asOf: "2026-10-29" });
    render(<GraphView />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
