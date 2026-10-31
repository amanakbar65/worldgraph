/** Entity pages with kg.provenance on: the header's info button, a mark after each link, and "?" on weak ones. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionGroup, EntityResponse, RpcName } from "@/api/contract";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";

import EntityPanel from "./EntityPanel";
import { NOW } from "./fixtures";
import { PORT } from "./fixtures-phase-a";
import { fakeQuery, stubMatchMedia } from "./test-utils";

const mocks = vi.hoisted(() => ({ entity: null as unknown, meta: {} as unknown }));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, _args: unknown, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return fakeQuery(undefined);
    if (name === "entity") return fakeQuery(mocks.entity);
    if (name === "meta") return fakeQuery(mocks.meta);
    return fakeQuery({ results: [] });
  },
}));

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const FLAGS = { "kg.properties": true, "kg.relations": true, "kg.provenance": true };

/** The port's links, each with its edge; "Operated by" is under 50 % sure. */
const CONNECTIONS: ConnectionGroup[] = PORT.connections!.map((group, g) => ({
  ...group,
  items: group.items.map((item, i) => ({
    ...item,
    edge_id: 100 * (g + 1) + i,
    ...(group.relation === "operates" ? { confidence: 0.4, weak: true } : {}),
  })),
}));
const PAGE: EntityResponse = { ...PORT, connections: CONNECTIONS };

const top = () => useNav.getState().panels.at(-1);

function renderPanel() {
  const panel = { kind: "entity" as const, id: PAGE.entity.id };
  useNav.setState({ panels: [panel] });
  return render(<EntityPanel panel={panel} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stubMatchMedia(() => true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.entity = PAGE;
  mocks.meta = { flags: FLAGS };
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

describe("EntityPanel: Why is this here?", () => {
  it("opens from the header's info button for the page itself", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Why is Jebel Ali Port here?" }));
    expect(top()).toEqual({ kind: "why", target: "node", id: "infra:jebel-ali-port" });
    // Back returns to the page.
    expect(useNav.getState().panels).toHaveLength(2);
  });

  it("puts a mark after each link that opens where it comes from", () => {
    renderPanel();
    const links = screen.getByRole("region", { name: "Links" });
    const located = within(links).getByRole("list", { name: "Located in1" });
    const why = within(located).getByRole("button", {
      name: "Why is this link here? Jebel Ali Port, located in, United Arab Emirates.",
    });
    expect(why.textContent).toBe(""); // an info mark, not "?"
    fireEvent.click(why);
    expect(top()).toEqual({ kind: "why", target: "edge", id: "300" });
  });

  it("marks a weak link with '?', which is the same button, and explains '?' once", () => {
    renderPanel();
    const links = screen.getByRole("region", { name: "Links" });
    const operated = within(links).getByRole("list", { name: "Operated by1" });
    const weak = within(operated).getByRole("button", {
      name: "Why is this link here? Jebel Ali Port, operated by, DP World. Weak: under 50% sure, or no source.",
    });
    expect(weak.textContent).toBe("?");
    fireEvent.click(weak);
    expect(top()).toEqual({ kind: "why", target: "edge", id: "200" });
    // The one legend's "?" row, once for the page.
    expect(within(links).getAllByText("Under 50% sure, or no source")).toHaveLength(1);
    // Only that one link is weak.
    expect(within(links).getAllByText("?")).toHaveLength(2); // the mark, and the legend's
  });

  it("keeps the plain '?' and no buttons while kg.provenance is off", () => {
    mocks.meta = { flags: { ...FLAGS, "kg.provenance": false } };
    renderPanel();
    expect(screen.queryByRole("button", { name: /^Why is/ })).toBeNull();
    const links = screen.getByRole("region", { name: "Links" });
    expect(within(links).getByRole("img", { name: "Weak link: under 50% sure, or no source" })).toBeTruthy();
  });

  it("leaves links without a weak verdict or a low confidence unmarked", () => {
    mocks.entity = { ...PAGE, connections: PORT.connections };
    mocks.meta = { flags: { ...FLAGS, "kg.provenance": false } };
    renderPanel();
    const links = screen.getByRole("region", { name: "Links" });
    expect(within(links).queryByText("?")).toBeNull();
    expect(within(links).queryByText("Under 50% sure, or no source")).toBeNull();
  });
});
