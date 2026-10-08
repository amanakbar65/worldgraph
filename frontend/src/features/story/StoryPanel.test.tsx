import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { useNav } from "@/state/nav";

import { CASCADE, DRAFT, EMPTY_CASCADE, FOCUS_ID, STORY } from "./fixtures";
import StoryPanel from "./StoryPanel";
import { fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown) => {
    mocks.calls.push({ name, args });
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
}));

const top = () => useNav.getState().panels.at(-1);

beforeEach(() => {
  mocks.responses = { story: STORY, cascade: CASCADE };
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ panels: [{ kind: "story", id: FOCUS_ID }], focus: null });
});
afterEach(cleanup);

function renderPanel(id = FOCUS_ID) {
  return render(<StoryPanel panel={{ kind: "story", id }} />);
}

describe("StoryPanel (analysed story)", () => {
  it("answers what happened, why it matters and what to do", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: /container rates jump/ })).toBeTruthy();
    expect(screen.getByText(/Importers face higher landed costs/)).toBeTruthy();
    expect(screen.getAllByText("Risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getByText("What you could do")).toBeTruthy();
    expect(screen.getByText("Lock in contract rates before renewals")).toBeTruthy();
    expect(screen.getByText("Large")).toBeTruthy();
  });

  it("asks for the cascade at the depth the flow opens with", () => {
    renderPanel();
    expect(mocks.calls).toContainEqual({ name: "cascade", args: { id: FOCUS_ID, depth: 2 } });
    expect(mocks.calls).toContainEqual({ name: "story", args: { id: FOCUS_ID } });
  });

  it("opens the cascade from the prominent button", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /See the cascade: 2 causes · 4 effects/ }));
    expect(top()).toEqual({ kind: "cascade", id: FOCUS_ID });
  });

  it("shows the crowd's view as forecasts, not facts", () => {
    renderPanel();
    expect(screen.getByText("Crowd forecasts, not facts. For information only.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Suez transits recover within six months, crowd forecast/ }));
    expect(top()).toEqual({ kind: "forecast", id: "forecast:suez-transits-recover" });
  });

  it("lists causes and effects with link type, mechanism and confidence", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Causes and effects" });
    const cause = within(section).getByRole("button", { name: /Red Sea attacks push carriers around Africa/ });
    expect(cause.getAttribute("aria-label")).toMatch(/Lengthens voyage times: reported link, high confidence \(90%\)/);
    expect(within(section).getByText("If YES · 31%")).toBeTruthy();
    expect(within(section).getByText("If NO · 69%")).toBeTruthy();
    fireEvent.click(cause);
    expect(top()).toEqual({ kind: "story", id: "story:red-sea-attacks-reroute" });
  });

  it("opens entities, and flies the globe to regions", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Kestrel Lines, organisation" }));
    expect(top()).toEqual({ kind: "entity", id: "org:kestrel-lines" });
    fireEvent.click(screen.getByRole("button", { name: "Shanghai, region" }));
    expect(top()).toEqual({ kind: "region", id: "region:cn-sh" });
    expect(useNav.getState().focus?.regionId).toBe("region:cn-sh");
  });

  it("says when there are no linked stories yet", () => {
    mocks.responses.cascade = { ...EMPTY_CASCADE, focus: FOCUS_ID };
    renderPanel();
    expect(screen.getByText("No linked stories yet")).toBeTruthy();
  });
});

describe("StoryPanel (draft from the live feed)", () => {
  beforeEach(() => {
    mocks.responses = { story: DRAFT, cascade: EMPTY_CASCADE };
  });

  it("shows the source headline as a draft, with no invented so-what or actions", () => {
    renderPanel(DRAFT.story.id);
    expect(screen.getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Dockworkers at Antwerp/ })).toBeTruthy();
    expect(screen.queryByText("What you could do")).toBeNull();
    expect(screen.queryByText("Risk")).toBeNull();
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("puts the sources first, with links to the originals", () => {
    renderPanel(DRAFT.story.id);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Reported by/);
    const link = screen.getByRole("link", { name: /Example Port News/ });
    expect(link.getAttribute("href")).toBe("https://example.com/antwerp-strike");
  });
});

describe("StoryPanel states", () => {
  it("shows a skeleton while loading", () => {
    mocks.responses = {};
    renderPanel();
    expect(screen.getByLabelText("Loading story").getAttribute("aria-busy")).toBe("true");
  });

  it("explains a story that no longer exists", () => {
    mocks.responses = {};
    mocks.errors = { story: new DataError("server_error", "Not found: story:gone") };
    renderPanel("story:gone");
    expect(screen.getByText("No longer available")).toBeTruthy();
  });
});
