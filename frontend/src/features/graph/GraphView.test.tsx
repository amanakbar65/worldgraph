import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { GRAPH, LOCAL } from "./fixtures";
import { useGraphState } from "./graph-state";
import GraphView from "./GraphView";
import { fakeQuery, stubElementSize, stubMatchMedia } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
  desktop: true,
  drawn: [] as { nodes: number; links: number }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
}));

// The canvas library: one button per node, so taps can be tested.
vi.mock("react-force-graph-2d", () => {
  type Props = {
    graphData: { nodes: { id: string; name: string; x?: number; y?: number }[]; links: unknown[] };
    onNodeClick: (node: unknown) => void;
    onNodeHover: (node: unknown) => void;
  };
  const FakeGraph = forwardRef<unknown, Props>(function FakeGraph(props, ref) {
    useImperativeHandle(ref, () => ({
      d3Force: () => ({ strength: () => {}, distanceMax: () => {}, distance: () => {} }),
      zoom: () => 1,
      centerAt: () => {},
      zoomToFit: () => {},
      graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
    }));
    mocks.drawn.push({ nodes: props.graphData.nodes.length, links: props.graphData.links.length });
    // Like the real layout, give every node a place.
    props.graphData.nodes.forEach((n, i) => {
      n.x ??= i * 10;
      n.y ??= i * 10;
    });
    return (
      <div data-testid="force-graph">
        {props.graphData.nodes.map((n) => (
          <button key={n.id} type="button" onClick={() => props.onNodeClick(n)} onMouseEnter={() => props.onNodeHover(n)}>
            {n.name}
          </button>
        ))}
      </div>
    );
  });
  return { default: FakeGraph };
});

const lastGraphArgs = () => mocks.calls.filter((c) => c.name === "graph" && c.enabled).at(-1)?.args;
const top = () => useNav.getState().panels.at(-1);
const initialGraphState = useGraphState.getState();

beforeEach(() => {
  mocks.responses = { graph: GRAPH, local_graph: LOCAL, search: { results: [] } };
  mocks.errors = {};
  mocks.calls = [];
  mocks.drawn = [];
  mocks.desktop = true;
  stubMatchMedia(() => mocks.desktop);
  stubElementSize();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useNav.setState({ view: "graph", panels: [], window: "7d", sectors: [], minConfidence: 0.5, focus: null });
  useGraphState.setState(initialGraphState, true);
  useSettings.setState({ sample: "auto", calm: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GraphView", () => {
  it("asks for the graph in the shared window and sector lens", () => {
    useNav.setState({ window: "30d", sectors: ["energy", "consumer"] });
    render(<GraphView />);
    expect(lastGraphArgs()).toEqual({ window: "30d", limit: 250, sectors: ["consumer", "energy"], min_confidence: 0.5 });
  });

  it("draws the graph, says how big it is and labels sample data", () => {
    render(<GraphView />);
    expect(screen.getByTestId("force-graph")).toBeTruthy();
    expect(mocks.drawn.at(-1)).toEqual({ nodes: 6, links: 8 });
    expect(screen.getByText("6 items · 8 links")).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /^Knowledge graph: 6 nodes and 8 links: 2 stories/ })).toBeTruthy();
  });

  it("opens the right panel for each kind of node", () => {
    render(<GraphView />);
    const canvas = screen.getByTestId("force-graph");
    fireEvent.click(within(canvas).getByText("India"));
    expect(top()).toEqual({ kind: "region", id: "region:in" });
    fireEvent.click(within(canvas).getByText("Crude oil"));
    expect(top()).toEqual({ kind: "entity", id: "commodity:crude-oil" });
    fireEvent.click(within(canvas).getByText("Freight rates to Europe climb"));
    expect(top()).toEqual({ kind: "story", id: "story:freight-rates-rise" });
    fireEvent.click(within(canvas).getByText("Will OPEC+ extend its output cuts?"));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:opec-cut" });
  });

  it("shows what a hovered node is", () => {
    render(<GraphView />);
    fireEvent.mouseEnter(within(screen.getByTestId("force-graph")).getByText("Mundra Port"));
    expect(screen.getByText(/2 connections · Click to open/)).toBeTruthy();
  });

  it("switches to all time", () => {
    render(<GraphView />);
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(lastGraphArgs()).toMatchObject({ window: "all" });
    fireEvent.click(screen.getByRole("radio", { name: "Last 24 hours" }));
    expect(lastGraphArgs()).toMatchObject({ window: "24h" });
    expect(useNav.getState().window).toBe("24h");
  });

  it("reads as a list: nodes with their links, cause and effect with type and confidence", () => {
    render(<GraphView />);
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.queryByTestId("force-graph")).toBeNull();
    const list = screen.getByRole("list", { name: "Nodes, most connected first" });
    const red = within(list).getByRole("list", { name: "Connections of Red Sea attacks push shipping onto longer routes" });
    expect(within(red).getByText("Leads to")).toBeTruthy();
    expect(within(red).getAllByText(/Inferred/).length).toBeGreaterThan(0);
    expect(within(red).getByText(/62%/)).toBeTruthy();
    fireEvent.click(within(list).getAllByRole("button", { name: /^India/ })[0]);
    expect(top()).toEqual({ kind: "region", id: "region:in" });
  });

  it("puts the list after the toolbar in keyboard order, as on screen", () => {
    render(<GraphView />);
    const toggle = screen.getByRole("radio", { name: "List" });
    fireEvent.click(toggle);
    const firstRow = within(screen.getByRole("list", { name: "Nodes, most connected first" })).getAllByRole("button")[0];
    // Tab from the toolbar's last control goes on into the list, not out of the page.
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(toggle, firstRow)).toBe(true);
    expect(after(screen.getByRole("radio", { name: "All time" }), firstRow)).toBe(true);
  });

  it("finds a node and keeps it lit", () => {
    render(<GraphView />);
    const box = screen.getByRole("combobox", { name: "Find something in the graph" });
    fireEvent.change(box, { target: { value: "mundra" } });
    const option = screen.getByRole("option", { name: /Mundra Port/ });
    expect(option).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useGraphState.getState().pinned?.id).toBe("infra:mundra-port");
  });

  it("shows the neighbourhood of one node, and goes back to everything", () => {
    useGraphState.getState().showAround({ id: "commodity:crude-oil", name: "Crude oil" }, 2);
    render(<GraphView />);
    expect(mocks.calls).toContainEqual({
      name: "local_graph",
      args: { id: "commodity:crude-oil", depth: 2, limit: 300 },
      enabled: true,
    });
    expect(screen.getByText("Around")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Direct links only" }));
    expect(useGraphState.getState().scope).toMatchObject({ kind: "local", depth: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Back to the whole graph" }));
    expect(useGraphState.getState().scope).toEqual({ kind: "global" });
  });

  it("replays growth, in steps under reduced motion", () => {
    useSettings.setState({ calm: true });
    render(<GraphView />);
    fireEvent.click(screen.getByRole("button", { name: "Step through how the graph grew" }));
    const bar = screen.getByRole("group", { name: "Graph growth replay" });
    expect(within(bar).getByRole("button", { name: "Pause replay" })).toBeTruthy();
    expect(within(bar).getByRole("slider", { name: "Replay position" })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Close replay" }));
    expect(screen.queryByRole("group", { name: "Graph growth replay" })).toBeNull();
  });

  it("filters: kinds, confidence and the node limit", async () => {
    render(<GraphView />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Stories/ }));
    expect(lastGraphArgs()).toMatchObject({ types: ["forecast", "region", "organization", "commodity", "infrastructure", "policy", "person", "indicator"] });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Up to 500 items" }));
    expect(lastGraphArgs()).toMatchObject({ limit: 500 });
    vi.useFakeTimers();
    fireEvent.change(within(dialog).getByRole("slider", { name: "Lowest confidence to show" }), { target: { value: "60" } });
    act(() => vi.advanceTimersByTime(400));
    vi.useRealTimers();
    expect(lastGraphArgs()).toMatchObject({ min_confidence: 0.6 });
    // The graph's slider is the one shared setting: the cascade and the globe read it too.
    expect(useNav.getState().minConfidence).toBe(0.6);
    expect(screen.getByRole("button", { name: "Filters, 3 on" })).toBeTruthy();
  });

  it("follows the shared minimum confidence set elsewhere, and filters the neighbourhood by it", () => {
    useNav.setState({ minConfidence: 0.7 });
    render(<GraphView />);
    expect(lastGraphArgs()).toMatchObject({ min_confidence: 0.7 });
    cleanup();
    useGraphState.getState().showAround({ id: "commodity:crude-oil", name: "Crude oil" }, 1);
    render(<GraphView />);
    // The 62 % cause-and-effect link is under 70 %: hidden here too.
    expect(mocks.drawn.at(-1)).toEqual({ nodes: 6, links: 7 });
    act(() => useNav.getState().setMinConfidence(0.6));
    expect(mocks.drawn.at(-1)).toEqual({ nodes: 6, links: 8 });
  });

  it("says how many weaker links the shared confidence hides around a node", () => {
    useNav.setState({ minConfidence: 0.7 });
    useGraphState.getState().showAround({ id: "commodity:crude-oil", name: "Crude oil" }, 1);
    render(<GraphView />);
    expect(screen.getByText("1 weaker link hidden")).toBeTruthy();
  });

  it("doesn't blame the confidence filter for an empty graph it didn't cause", () => {
    mocks.responses.graph = { nodes: [], links: [], truncated: false };
    render(<GraphView />);
    expect(screen.queryByText(/Lower the confidence filter/)).toBeNull();
  });

  it("suggests a longer window when nothing matches", () => {
    mocks.responses.graph = { nodes: [], links: [], truncated: false };
    render(<GraphView />);
    expect(screen.getByText("Nothing matches these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all time" }));
    expect(lastGraphArgs()).toMatchObject({ window: "all" });
  });

  it("asks for a kind to show when every kind is off", () => {
    useGraphState.getState().setTypes([]);
    render(<GraphView />);
    expect(screen.getByText("Pick something to show")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the usual kinds" }));
    expect(useGraphState.getState().filters.types.length).toBeGreaterThan(0);
  });

  it("explains a failure and offers a retry", () => {
    mocks.responses.graph = undefined;
    mocks.errors.graph = new DataError("unavailable", "timeout", true);
    render(<GraphView />);
    expect(screen.getByText("The data is taking a moment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows skeletons while loading", () => {
    mocks.responses.graph = undefined;
    render(<GraphView />);
    expect(screen.getByLabelText("Loading the graph")).toBeTruthy();
  });

  it("offers more nodes when the graph was cut short", () => {
    mocks.responses.graph = { ...GRAPH, truncated: true };
    render(<GraphView />);
    fireEvent.click(screen.getByRole("button", { name: "Show up to 500" }));
    expect(lastGraphArgs()).toMatchObject({ limit: 500 });
  });

  it("opens readable on a phone: 100 items, no invitation to show more, and that isn't counted as a filter", () => {
    mocks.desktop = false;
    mocks.responses.graph = { ...GRAPH, truncated: true };
    // The store picks its starting limit for the screen it starts on.
    useGraphState.getState().resetFilters();
    render(<GraphView />);
    expect(lastGraphArgs()).toMatchObject({ limit: 100 });
    expect(screen.queryByRole("button", { name: /^Show up to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
  });

  it("keeps the phone layout compact: the key starts closed", () => {
    mocks.desktop = false;
    render(<GraphView />);
    expect(screen.getByRole("button", { name: "Key" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Replay how the graph grew" })).toBeTruthy();
  });
});
