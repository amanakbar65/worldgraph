import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MIN_CONFIDENCE,
  applyLink,
  clampMinConfidence,
  formatHash,
  isAsOfDay,
  linkStateOf,
  parseHash,
  startHashSync,
  useNav,
  type LinkState,
} from "./nav";

const base: LinkState = { view: "globe", panel: null, window: "7d", sectors: [], minConfidence: 0.5 };

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
    ["#graph&c=0.7", { ...base, view: "graph", minConfidence: 0.7 }],
    ["#globe&c=0", { ...base, minConfidence: 0 }],
    [
      "#story=story:abc&w=24h&c=0.35",
      { ...base, panel: { kind: "story", id: "story:abc" }, window: "24h", minConfidence: 0.35 },
    ],
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

describe("the shared minimum confidence", () => {
  beforeEach(() => useNav.setState({ minConfidence: MIN_CONFIDENCE.default }));

  it("starts at 0.5, the globe's long-standing floor", () => {
    expect(MIN_CONFIDENCE.default).toBe(0.5);
    expect(useNav.getState().minConfidence).toBe(0.5);
    expect(parseHash("#graph")?.minConfidence).toBe(0.5);
  });

  it("stays within 0–0.9 in 0.05 steps", () => {
    expect(clampMinConfidence(-1)).toBe(0);
    expect(clampMinConfidence(0.95)).toBe(0.9);
    expect(clampMinConfidence(0.333)).toBe(0.35);
    expect(clampMinConfidence(0.3)).toBe(0.3);
    expect(clampMinConfidence(Number.NaN)).toBe(0.5);
    useNav.getState().setMinConfidence(0.72);
    expect(useNav.getState().minConfidence).toBe(0.7);
    useNav.getState().setMinConfidence(2);
    expect(useNav.getState().minConfidence).toBe(0.9);
  });

  it("is left out of links at its default and clamped when read", () => {
    expect(formatHash({ ...base, minConfidence: 0.5 })).toBe("#globe");
    expect(formatHash({ view: "graph", panel: null, window: "7d", sectors: [] })).toBe("#graph");
    expect(parseHash("#graph&c=7")?.minConfidence).toBe(0.9);
    expect(parseHash("#graph&c=.25")?.minConfidence).toBe(0.25);
    // Garbage is ignored, so the link falls back to the default.
    expect(parseHash("#graph&c=lots")?.minConfidence).toBe(0.5);
    expect(parseHash("#c=-1")).toBeNull();
  });

  it("is applied from a link, and a link without it resets it", () => {
    applyLink({ ...base, minConfidence: 0.8 });
    expect(useNav.getState().minConfidence).toBe(0.8);
    applyLink({ view: "globe", panel: null, window: "7d", sectors: [] });
    expect(useNav.getState().minConfidence).toBe(0.5);
    expect(linkStateOf(useNav.getState()).minConfidence).toBe(0.5);
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
    useNav.setState({ view: "globe", panels: [], window: "7d", sectors: [], minConfidence: 0.5 });
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
    useNav.getState().setMinConfidence(0.7);
    expect(window.history.length).toBe(before + 1);
    expect(window.location.hash).toBe("#region=region:in&w=30d&s=energy&c=0.7");
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

describe("the graph's as-of day", () => {
  const graph: LinkState = { ...base, view: "graph" };

  it.each<[string, LinkState]>([
    ["#graph&at=2026-10-29", { ...graph, asOf: "2026-10-29" }],
    ["#graph&w=30d&c=0.7&at=2026-10-01", { ...graph, window: "30d", minConfidence: 0.7, asOf: "2026-10-01" }],
    [
      "#graph&entity=commodity:crude-oil&at=2026-10-29",
      { ...graph, panel: { kind: "entity", id: "commodity:crude-oil" }, asOf: "2026-10-29" },
    ],
  ])("round-trips %s", (hash, state) => {
    expect(parseHash(hash)).toEqual(state);
    expect(formatHash(state)).toBe(hash);
  });

  it("belongs to the graph screen and to real days only", () => {
    expect(parseHash("#globe&at=2026-10-29")).toEqual(base);
    expect(parseHash("#story=story:a&at=2026-10-29")?.asOf).toBeUndefined();
    expect(parseHash("#at=2026-10-29")).toBeNull();
    expect(formatHash({ ...base, asOf: "2026-10-29" })).toBe("#globe");
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-29", "1999-12-31", "2026-10-29T10:00", "today"]) {
      expect(isAsOfDay(bad)).toBe(false);
      expect(parseHash(`#graph&at=${bad}`)).toEqual(graph);
    }
    expect(isAsOfDay("2024-02-29")).toBe(true);
  });

  it("is set on the graph screen only, and leaving the graph goes back to now", () => {
    useNav.setState({ view: "globe", panels: [], asOf: null });
    useNav.getState().setAsOf("2026-10-29");
    expect(useNav.getState().asOf).toBeNull();
    useNav.getState().setView("graph");
    useNav.getState().setAsOf("2026-10-29");
    expect(useNav.getState().asOf).toBe("2026-10-29");
    useNav.getState().setAsOf("not a day");
    expect(useNav.getState().asOf).toBeNull();
    useNav.getState().setAsOf("2026-10-28");
    useNav.getState().open({ kind: "entity", id: "commodity:crude-oil" });
    expect(useNav.getState().asOf).toBe("2026-10-28"); // a panel keeps it
    useNav.getState().setView("globe");
    expect(useNav.getState().asOf).toBeNull();
  });

  it("is applied from a link, and a link without it means now", () => {
    applyLink({ ...graph, asOf: "2026-10-29" });
    expect(useNav.getState().asOf).toBe("2026-10-29");
    expect(linkStateOf(useNav.getState()).asOf).toBe("2026-10-29");
    applyLink(graph);
    expect(useNav.getState().asOf).toBeNull();
    applyLink({ ...base, asOf: "2026-10-29" }); // not the graph
    expect(useNav.getState().asOf).toBeNull();
  });

  describe("in the URL", () => {
    let stop: () => void = () => {};
    beforeEach(() => {
      window.history.replaceState(null, "", "/");
      useNav.setState({ view: "graph", panels: [], window: "7d", sectors: [], minConfidence: 0.5, asOf: null });
      stop = startHashSync(window);
    });
    afterEach(() => {
      stop();
      useNav.setState({ view: "globe", asOf: null });
    });

    it("adds a history entry for each day and for going back to now", () => {
      const before = window.history.length;
      useNav.getState().setAsOf("2026-10-29");
      expect(window.location.hash).toBe("#graph&at=2026-10-29");
      useNav.getState().setAsOf("2026-10-28");
      useNav.getState().setAsOf(null);
      expect(window.location.hash).toBe("#graph");
      expect(window.history.length).toBe(before + 3);
    });

    it("walks back through days with the browser's Back button", async () => {
      useNav.getState().setAsOf("2026-10-29");
      useNav.getState().setAsOf("2026-10-28");
      window.history.back();
      await vi.waitFor(() => expect(useNav.getState().asOf).toBe("2026-10-29"));
      window.history.back();
      await vi.waitFor(() => expect(useNav.getState().asOf).toBeNull());
      window.history.forward();
      await vi.waitFor(() => expect(useNav.getState().asOf).toBe("2026-10-29"));
    });

    it("opens a deep link at that day", async () => {
      window.location.hash = "#graph&at=2026-10-20&w=24h";
      await vi.waitFor(() => expect(useNav.getState().asOf).toBe("2026-10-20"));
      expect(useNav.getState().window).toBe("24h");
    });
  });
});
