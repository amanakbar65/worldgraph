/** The graph screen with the Phase A flags on: relation and property filters, named and tappable links. */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName, SchemaResponse } from "@/api/contract";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { GRAPH, LOCAL, link } from "./fixtures";
import { useGraphState } from "./graph-state";
import GraphView from "./GraphView";
import { fakeQuery, stubElementSize, stubMatchMedia } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name]);
  },
}));

// The canvas library: one button per node and per link, so taps can be tested.
vi.mock("react-force-graph-2d", () => {
  type FakeLink = { id: string; source: unknown; target: unknown };
  type Props = {
    graphData: { nodes: { id: string; name: string; x?: number; y?: number }[]; links: FakeLink[] };
    onNodeClick: (node: unknown) => void;
    onLinkClick: (link: unknown) => void;
  };
  const FakeGraph = forwardRef<unknown, Props>(function FakeGraph(props, ref) {
    useImperativeHandle(ref, () => ({
      d3Force: () => ({ strength: () => {}, distanceMax: () => {}, distance: () => {} }),
      zoom: () => 1,
      centerAt: () => {},
      graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
    }));
    const byId = new Map(props.graphData.nodes.map((n) => [n.id, n]));
    props.graphData.nodes.forEach((n, i) => {
      n.x ??= i * 10;
      n.y ??= i * 10;
    });
    // Like the real library, swap ids for the node objects.
    props.graphData.links.forEach((l) => {
      if (typeof l.source === "string") l.source = byId.get(l.source);
      if (typeof l.target === "string") l.target = byId.get(l.target);
    });
    return (
      <div data-testid="force-graph">
        {props.graphData.links.map((l) => (
          <button key={l.id} type="button" onClick={() => props.onLinkClick(l)}>
            link {l.id}
          </button>
        ))}
      </div>
    );
  });
  return { default: FakeGraph };
});

const SCHEMA: SchemaResponse = {
  types: [
    {
      key: "organization",
      label: "Organisation",
      plural: "Organisations",
      icon: "building",
      tone: "type-organization",
      description: "Companies and bodies.",
      count: 110,
      properties: [
        {
          key: "size",
          label: "Size",
          kind: "choice",
          required: false,
          derived: false,
          multiple: false,
          choices: [
            { key: "small", label: "Small" },
            { key: "large", label: "Large" },
          ],
          unit: null,
          unit_key: null,
          entity_types: null,
          pattern: null,
          min: null,
          max: null,
          description: null,
        },
        {
          key: "founded",
          label: "Founded",
          kind: "date",
          required: false,
          derived: false,
          multiple: false,
          choices: null,
          unit: null,
          unit_key: null,
          entity_types: null,
          pattern: null,
          min: null,
          max: null,
          description: null,
        },
      ],
    },
  ],
  relations: [
    {
      key: "located_in",
      label: "Located in",
      inverse_label: "Home to",
      icon: "map-pin",
      causal: false,
      symmetric: false,
      src_types: ["organization"],
      dst_types: ["region"],
      description: "Where something is.",
      count: 145,
      by_pair: [],
    },
    {
      key: "drives",
      label: "Drives",
      inverse_label: "Driven by",
      icon: "arrow-right",
      causal: true,
      symmetric: false,
      src_types: [],
      dst_types: [],
      description: "Cause and effect.",
      count: 236,
      by_pair: [],
    },
    {
      key: "regulates",
      label: "Regulates",
      inverse_label: "Regulated by",
      icon: "scale",
      causal: false,
      symmetric: false,
      src_types: [],
      dst_types: [],
      description: "Sets the rules.",
      count: 0,
      by_pair: [],
    },
  ],
};

const FLAGS_ON = {
  flags: { "kg.properties": true, "kg.relations": true, "kg.provenance": false, "kg.history": false, "kg.schema_map": true },
};

/** The fixture graph with the 0022 link fields: the causal link raises, with a delay. */
const NAMED = {
  ...GRAPH,
  links: GRAPH.links.map((l) =>
    l.causal ? { ...l, id: 9, relation: "drives", polarity: 1 as const, strength: 0.8, delayed: true } : { ...l, relation: l.type },
  ),
};

const lastArgs = (name: string) => mocks.calls.filter((c) => c.name === name && c.enabled).at(-1)?.args;
const initialGraphState = useGraphState.getState();

beforeEach(() => {
  mocks.responses = { graph: NAMED, local_graph: { ...LOCAL, links: NAMED.links }, search: { results: [] }, meta: FLAGS_ON, schema: SCHEMA };
  mocks.calls = [];
  stubMatchMedia(() => true);
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

async function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
  return screen.findByRole("dialog");
}

describe("GraphView with named relations and properties", () => {
  it("filters by relation with chips from the schema (only relations that have links)", async () => {
    render(<GraphView />);
    const dialog = await openFilters();
    const group = within(dialog).getByRole("region", { name: "Relations" });
    expect(within(group).queryByRole("button", { name: /Regulates/ })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: /Located in/ }));
    fireEvent.click(within(group).getByRole("button", { name: /Drives/ }));
    expect(lastArgs("graph")).toMatchObject({ relations: ["drives", "located_in"] });
    fireEvent.click(within(group).getByRole("button", { name: "Every relation" }));
    expect(lastArgs("graph")).not.toHaveProperty("relations");
  });

  it("offers a kind's properties only when exactly one kind is chosen, and sends them as where", async () => {
    render(<GraphView />);
    const dialog = await openFilters();
    expect(within(dialog).queryByRole("region", { name: "Organisation properties" })).toBeNull();
    expect(within(dialog).getByText("Choose one kind to filter by its properties.")).toBeTruthy();
    act(() => useGraphState.getState().setTypes(["organization"]));
    const props = within(dialog).getByRole("region", { name: "Organisation properties" });
    fireEvent.click(within(props).getByRole("button", { name: "Large" }));
    expect(lastArgs("graph")).toMatchObject({
      types: ["organization"],
      where: [{ prop: "size", op: "in", value: ["large"] }],
    });
    const from = within(props).getByRole("spinbutton", { name: "Founded, from year" });
    fireEvent.change(from, { target: { value: "1999" } });
    fireEvent.blur(from);
    expect(lastArgs("graph")).toMatchObject({
      where: [
        { prop: "founded", op: "gte", value: "1999" },
        { prop: "size", op: "in", value: ["large"] },
      ],
    });
  });

  it("around one node, filters links by direction", async () => {
    useGraphState.getState().showAround({ id: "commodity:crude-oil", name: "Crude oil" }, 1);
    render(<GraphView />);
    const dialog = await openFilters();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Only links arriving at it" }));
    expect(lastArgs("local_graph")).toEqual({ id: "commodity:crude-oil", depth: 1, limit: 300, direction: "in" });
  });

  it("opens a card for a tapped link, naming the relation from the source with ▲ raises and the delay", () => {
    render(<GraphView />);
    const canvas = screen.getByTestId("force-graph");
    fireEvent.click(within(canvas).getByText("link story:red-sea-attacks|story:freight-rates-rise|inferred"));
    const card = screen.getByRole("dialog", { name: /^Link: Drives, raises, delayed: Red Sea attacks/ });
    expect(within(card).getByText("Drives")).toBeTruthy();
    expect(within(card).getByText("▲")).toBeTruthy();
    expect(within(card).getByText("raises")).toBeTruthy();
    expect(within(card).getByText("Delayed")).toBeTruthy();
    expect(useGraphState.getState().selectedLink).toBe("story:red-sea-attacks|story:freight-rates-rise|inferred");
    fireEvent.click(within(card).getByRole("button", { name: "Close link details" }));
    expect(useGraphState.getState().selectedLink).toBeNull();
  });

  it("names plain links by relation too", () => {
    render(<GraphView />);
    fireEvent.click(within(screen.getByTestId("force-graph")).getByText("link infra:mundra-port|region:in|located_in"));
    expect(screen.getByRole("dialog", { name: "Link: Located in: Mundra Port to India." })).toBeTruthy();
  });

  it("reaches every link from the list view by keyboard", () => {
    render(<GraphView />);
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    const list = screen.getByRole("list", { name: "Nodes, most connected first" });
    const india = within(list).getByRole("list", { name: "Connections of India" });
    const homeTo = within(india).getByRole("button", { name: "Link details: India, home to, Mundra Port" });
    fireEvent.click(homeTo);
    expect(homeTo.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Link: Located in: Mundra Port to India." })).toBeTruthy();
    const red = within(list).getByRole("list", { name: "Connections of Red Sea attacks push shipping onto longer routes" });
    expect(within(red).getByRole("button", { name: /, drives, Freight rates/ })).toBeTruthy();
    expect(within(red).getByText("raises")).toBeTruthy();
  });

  it("keeps the old graph when the flags are off", async () => {
    mocks.responses.meta = { flags: {} };
    render(<GraphView />);
    expect(screen.queryByRole("radio", { name: "Schema" })).toBeNull();
    const dialog = await openFilters();
    expect(within(dialog).queryByRole("region", { name: "Relations" })).toBeNull();
    fireEvent.click(within(screen.getByTestId("force-graph")).getByText("link infra:mundra-port|region:in|located_in"));
    expect(screen.queryByRole("dialog", { name: /^Link:/ })).toBeNull();
  });
});

describe("trust at a glance in the graph", () => {
  it("marks weak cause-and-effect links with ? in the list", () => {
    mocks.responses.graph = {
      ...NAMED,
      links: [...NAMED.links, link("story:freight-rates-rise", "region:in", "inferred", { confidence: null })],
    };
    render(<GraphView />);
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getAllByRole("img", { name: "Weak link: under 50% sure, or no source" }).length).toBeGreaterThan(0);
  });

  it("says the shared legend words", () => {
    render(<GraphView />);
    const key = screen.getByRole("list", { name: "How sure a link is" });
    expect(within(key).getByText("Thicker line: stronger effect")).toBeTruthy();
    expect(within(key).getByText("Fainter line: less certain")).toBeTruthy();
    expect(within(key).getByText("Under 50% sure, or no source")).toBeTruthy();
    expect(within(key).getByText("Raises or lowers what it leads to")).toBeTruthy();
  });
});
