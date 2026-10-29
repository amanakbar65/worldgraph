/** Entity pages with kg.properties and kg.relations on: key-fact chips and links grouped by relation. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";

import EntityPanel from "./EntityPanel";
import { CRUDE, NOW } from "./fixtures";
import { PORT } from "./fixtures-phase-a";
import { useGraphState } from "./graph-state";
import { fakeQuery, stubMatchMedia } from "./test-utils";

const mocks = vi.hoisted(() => ({
  entities: {} as Record<string, unknown>,
  responses: {} as Partial<Record<string, unknown>>,
  desktop: true,
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: { id?: string }, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return fakeQuery(undefined);
    if (name === "entity") return fakeQuery(mocks.entities[args.id ?? ""]);
    return fakeQuery(mocks.responses[name]);
  },
}));

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const ON = { flags: { "kg.properties": true, "kg.relations": true } };
const top = () => useNav.getState().panels.at(-1);

function renderPanel(id: string) {
  const panel = { kind: "entity" as const, id };
  useNav.setState({ panels: [panel] });
  return render(<EntityPanel panel={panel} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.desktop = true;
  stubMatchMedia(() => mocks.desktop);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.entities = { [PORT.entity.id]: PORT, [CRUDE.entity.id]: CRUDE };
  mocks.responses = { search: { results: [] }, meta: ON };
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

describe("EntityPanel key facts from typed properties", () => {
  it("shows each property as a chip with its label and value, and older facts only for what they add", () => {
    renderPanel("infra:jebel-ali-port");
    const facts = screen.getByRole("region", { name: "Key facts" });
    const chips = within(facts).getByRole("list", { name: "Properties" });
    expect(within(chips).getByTitle("Kind: Port")).toBeTruthy();
    expect(within(chips).getByTitle("Capacity: 19,300,000 TEU")).toBeTruthy();
    expect(within(chips).getByTitle("Berths: 67 berths")).toBeTruthy();
    expect(within(chips).getByTitle("Opened: 1979")).toBeTruthy();
    // The older facts: only "Depth" isn't said by a property.
    expect(within(facts).getByText("Depth")).toBeTruthy();
    expect(within(facts).getAllByText("Port")).toHaveLength(1);
  });

  it("opens an entity value's page", () => {
    renderPanel("infra:jebel-ali-port");
    fireEvent.click(screen.getByRole("button", { name: "Operator: DP World. Open organisation" }));
    expect(top()).toEqual({ kind: "entity", id: "org:dp-world" });
  });

  it("opens the map at a place value", () => {
    renderPanel("infra:jebel-ali-port");
    fireEvent.click(screen.getByRole("button", { name: "Place: United Arab Emirates. Show on the map" }));
    expect(useNav.getState().view).toBe("globe");
    expect(useNav.getState().focus).toMatchObject({ regionId: "region:ae" });
    expect(top()).toEqual({ kind: "region", id: "region:ae" });
  });

  it("gives each of several values its own chip, with the label once", () => {
    renderPanel("infra:jebel-ali-port");
    expect(screen.getByRole("button", { name: "Sector: Energy. Open sector" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sector: Logistics and Trade. Open sector" })).toBeTruthy();
  });

  it("keeps the older facts list while kg.properties is off", () => {
    mocks.responses.meta = { flags: { "kg.relations": true } };
    renderPanel("infra:jebel-ali-port");
    const facts = screen.getByRole("region", { name: "Key facts" });
    expect(within(facts).queryByRole("list", { name: "Properties" })).toBeNull();
    expect(within(facts).getByText("Operator")).toBeTruthy();
  });
});

describe("EntityPanel links grouped by relation", () => {
  it("replaces Linked from with one group per relation, read from this side", () => {
    renderPanel("infra:jebel-ali-port");
    expect(screen.queryByRole("region", { name: "Linked from" })).toBeNull();
    const links = screen.getByRole("region", { name: "Links" });
    const headings = within(links).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    // The forecast it is covered by shows in Crowd forecasts, not again here.
    expect(headings).toEqual(["In sector2", "Operated by1", "Located in1", "Needed by20"]);
    fireEvent.click(within(within(links).getByRole("list", { name: "Operated by1" })).getByRole("button", { name: "DP World, organisation" }));
    expect(top()).toEqual({ kind: "entity", id: "org:dp-world" });
  });

  it("keeps big groups short, marks sample items, and sends the rest to the graph", () => {
    renderPanel("infra:jebel-ali-port");
    const group = screen.getByRole("list", { name: "Needed by20" });
    expect(within(group).getAllByRole("button", { name: /^Sample shipper/ })).toHaveLength(8);
    expect(within(group).getAllByText("Sample data").length).toBe(8);
    fireEvent.click(within(group).getByRole("button", { name: "4 more" }));
    expect(within(group).getAllByRole("button", { name: /^Sample shipper/ })).toHaveLength(12);
    fireEvent.click(within(group).getByRole("button", { name: "See all 20 in the graph" }));
    expect(useNav.getState().view).toBe("graph");
    const graph = useGraphState.getState();
    expect(graph.scope).toMatchObject({ kind: "local", id: "infra:jebel-ali-port", depth: 1 });
    expect(graph.filters).toMatchObject({ relations: ["depends_on"], direction: "in" });
  });

  it("is shorter on phones", () => {
    mocks.desktop = false;
    renderPanel("infra:jebel-ali-port");
    const group = screen.getByRole("list", { name: "Needed by20" });
    expect(within(group).getAllByRole("button", { name: /^Sample shipper/ })).toHaveLength(4);
    expect(within(group).getByRole("button", { name: "8 more" })).toBeTruthy();
  });

  it("keeps Linked from while kg.relations is off", () => {
    mocks.responses.meta = { flags: { "kg.properties": true } };
    renderPanel("infra:jebel-ali-port");
    expect(screen.getByRole("region", { name: "Linked from" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
  });
});
