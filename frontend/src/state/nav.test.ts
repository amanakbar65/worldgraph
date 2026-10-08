import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLink, formatHash, linkStateOf, parseHash, startHashSync, useNav, type LinkState } from "./nav";

const base: LinkState = { view: "globe", panel: null, window: "7d", sectors: [] };

describe("parseHash / formatHash", () => {
  it.each<[string, LinkState]>([
    ["#globe", base],
    ["#graph", { ...base, view: "graph" }],
    ["#story=story:abc", { ...base, panel: { kind: "story", id: "story:abc" } }],
    ["#region=region:in-gj&w=24h", { ...base, panel: { kind: "region", id: "region:in-gj" }, window: "24h" }],
    [
      "#forecasts&forecast=forecast:fed-cut",
      { ...base, view: "forecasts", panel: { kind: "forecast", id: "forecast:fed-cut" } },
    ],
    ["#cascade=story:red-sea-attacks", { ...base, panel: { kind: "cascade", id: "story:red-sea-attacks" } }],
    [
      "#entity=commodity:crude-oil&w=30d",
      { ...base, panel: { kind: "entity", id: "commodity:crude-oil" }, window: "30d" },
    ],
    [
      "#compare=region:in,region:cn",
      { ...base, panel: { kind: "compare", ids: ["region:in", "region:cn"] } },
    ],
    ["#settings", { ...base, panel: { kind: "settings" } }],
    ["#ask", { ...base, panel: { kind: "ask" } }],
    [
      "#ask=oil+prices%3F&scope=region:in",
      { ...base, panel: { kind: "ask", q: "oil prices?", scope: "region:in" } },
    ],
    ["#graph&s=energy,finance", { ...base, view: "graph", sectors: ["energy", "finance"] }],
    ["#brief&w=24h&s=tech", { ...base, view: "brief", window: "24h", sectors: ["tech"] }],
  ])("round-trips %s", (hash, state) => {
    expect(parseHash(hash)).toEqual(state);
    expect(formatHash(state)).toBe(hash);
  });

  it("ignores anything it doesn't recognise", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#")).toBeNull();
    expect(parseHash("#main")).toBeNull(); // the skip link
    expect(parseHash("#story=not an id")).toBeNull();
    expect(parseHash("#story=story:ok&w=1y&s=bogus,energy&view=x")).toEqual({
      ...base,
      panel: { kind: "story", id: "story:ok" },
      sectors: ["energy"],
    });
    expect(parseHash("#compare=region:in")).toBeNull(); // needs two regions
    expect(parseHash("#story=%E0%A4%A")).toBeNull(); // broken escape
  });

  it("keeps ids readable and free text encoded", () => {
    expect(formatHash({ ...base, panel: { kind: "ask", q: "What if oil hits $100 & stays?" } })).toBe(
      "#ask=What+if+oil+hits+%24100+%26+stays%3F",
    );
    expect(parseHash("#ask=What+if+oil+hits+%24100+%26+stays%3F")?.panel).toEqual({
      kind: "ask",
      q: "What if oil hits $100 & stays?",
    });
  });
});

describe("applyLink", () => {
  beforeEach(() => useNav.setState({ view: "globe", panels: [], window: "7d", sectors: [] }));

  it("goes back into the panel history when the link points there", () => {
    const a = { kind: "story", id: "story:a" } as const;
    const b = { kind: "story", id: "story:b" } as const;
    useNav.setState({ panels: [a, b] });
    applyLink({ ...base, panel: a });
    expect(useNav.getState().panels).toEqual([a]);
    applyLink({ ...base, panel: { kind: "region", id: "region:in" }, window: "24h" });
    expect(useNav.getState().panels).toEqual([a, { kind: "region", id: "region:in" }]);
    expect(useNav.getState().window).toBe("24h");
    applyLink(base);
    expect(useNav.getState().panels).toEqual([]);
  });
});

describe("startHashSync", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    useNav.setState({ view: "globe", panels: [], window: "7d", sectors: [] });
    stop = startHashSync(window);
  });
  afterEach(() => stop());

  it("keeps a clean URL on the plain globe and writes places as you move", () => {
    expect(window.location.hash).toBe("");
    useNav.getState().open({ kind: "story", id: "story:a" });
    expect(window.location.hash).toBe("#story=story:a");
    useNav.getState().setWindow("24h");
    expect(window.location.hash).toBe("#story=story:a&w=24h");
    useNav.getState().setView("graph");
    expect(window.location.hash).toBe("#graph&story=story:a&w=24h");
  });

  it("adds history entries for places, not for filters", () => {
    const before = window.history.length;
    useNav.getState().open({ kind: "region", id: "region:in" });
    useNav.getState().setWindow("30d");
    useNav.getState().toggleSector("energy");
    expect(window.history.length).toBe(before + 1);
  });

  it("follows the browser's Back button", async () => {
    useNav.getState().open({ kind: "story", id: "story:a" });
    useNav.getState().open({ kind: "story", id: "story:b" });
    window.history.back();
    await vi.waitFor(() =>
      expect(linkStateOf(useNav.getState()).panel).toEqual({ kind: "story", id: "story:a" }),
    );
    expect(useNav.getState().panels).toEqual([{ kind: "story", id: "story:a" }]);
  });

  it("goes back in history when the app's own Back returns to the previous place", async () => {
    useNav.getState().open({ kind: "story", id: "story:a" });
    useNav.getState().open({ kind: "story", id: "story:b" });
    const length = window.history.length;
    useNav.getState().back();
    await vi.waitFor(() => expect(window.location.hash).toBe("#story=story:a"));
    expect(window.history.length).toBe(length); // no new entry
  });

  it("applies a hash typed by hand", async () => {
    window.location.hash = "#region=region:in-gj&w=24h";
    await vi.waitFor(() => expect(useNav.getState().window).toBe("24h"));
    expect(linkStateOf(useNav.getState()).panel).toEqual({ kind: "region", id: "region:in-gj" });
  });

  it("leaves the app alone for the skip link's #main", async () => {
    useNav.getState().open({ kind: "story", id: "story:a" });
    window.location.hash = "#main";
    await new Promise((r) => setTimeout(r, 20));
    expect(linkStateOf(useNav.getState()).panel).toEqual({ kind: "story", id: "story:a" });
  });
});
