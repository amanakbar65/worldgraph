import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { snapshotKeyOf, snapshotManifest, snapshotPlan } from "@/lib/snapshot-plan";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { FORECAST, GLOBE, META, NOW, TOP, TOP_LIVE } from "./fixtures";
import GlobeView from "./GlobeView";
import { IDLE_MS } from "./idle-spin";
import { DEFAULT_TOGGLES } from "./layers";
import { useGlobeHover, useGlobeUi } from "./store";

// ---------------------------------------------------------------------------
// Mocks: data, MapLibre, deck.gl's overlay, the map shapes and the browser
// ---------------------------------------------------------------------------

interface FakeMap {
  options: {
    center: [number, number];
    zoom: number;
    style: { layers: { id: string; layout?: { visibility?: string }; paint?: Record<string, unknown> }[] };
  };
  fire: (type: string, event?: unknown) => void;
  flyTo: ReturnType<typeof vi.fn>;
  setFeatureState: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
  setCenter: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
  maps: [] as unknown[],
  overlays: [] as { props: { layers?: { id: string }[] } }[],
  desktop: true,
  /** What deck.gl has under the pointer, for a pick pass over these layers. */
  pick: null as ((layerIds: string[]) => { object: unknown; layer: { id: string } } | null) | null,
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown) => {
    mocks.calls.push({ name, args });
    const data = mocks.responses[name];
    const error = mocks.errors[name] ?? null;
    return {
      data,
      error,
      isLoading: data === undefined && !error,
      isFetching: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
  },
  useConnection: <T,>(select: (s: { state: { status: string } }) => T) =>
    select({ state: { status: "live" } }),
}));

vi.mock("maplibre-gl", () => {
  class Map {
    options: unknown;
    handlers: Record<string, ((event?: unknown) => void)[]> = {};
    canvas = document.createElement("canvas");
    sources = { countries: { setData: vi.fn() }, states: { setData: vi.fn() } };
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };
    addControl = vi.fn();
    removeControl = vi.fn();
    remove = vi.fn();
    flyTo = vi.fn();
    easeTo = vi.fn();
    jumpTo = vi.fn();
    setPadding = vi.fn();
    setCenter = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    setSky = vi.fn();
    setFeatureState = vi.fn();
    setFilter = vi.fn();
    constructor(options: unknown) {
      this.options = options;
      mocks.maps.push(this);
    }
    on(type: string, fn: (event?: unknown) => void) {
      (this.handlers[type] ??= []).push(fn);
      return this;
    }
    off(type: string, fn: (event?: unknown) => void) {
      this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== fn);
      return this;
    }
    fire(type: string, event?: unknown) {
      for (const fn of this.handlers[type] ?? []) fn(event);
    }
    getCanvas() {
      return this.canvas;
    }
    getCenter() {
      return { lng: 25, lat: 20 };
    }
    getZoom() {
      return 1.8;
    }
    project() {
      return { x: 400, y: 300 };
    }
    queryRenderedFeatures() {
      return [];
    }
    isMoving() {
      return false;
    }
    getSource(id: "countries" | "states") {
      return this.sources[id];
    }
  }
  return { Map, setWorkerUrl: vi.fn() };
});

vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "worker.js" }));

vi.mock("@deck.gl/maplibre", () => ({
  MapLibreOverlay: class {
    props: { layers?: { id: string }[] };
    constructor(props: { layers?: { id: string }[] }) {
      this.props = props;
      mocks.overlays.push(this);
    }
    setProps(props: { layers?: { id: string }[] }) {
      this.props = { ...this.props, ...props };
    }
    pickObject({ layerIds }: { layerIds: string[] }) {
      return mocks.pick?.(layerIds) ?? null;
    }
  },
}));

vi.mock("@/lib/geo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/geo")>();
  const square = (x: number, y: number) => ({
    type: "Polygon" as const,
    coordinates: [
      [
        [x, y],
        [x + 5, y],
        [x + 5, y + 5],
        [x, y + 5],
        [x, y],
      ],
    ],
  });
  const countries = {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, properties: { id: "region:ye", name: "Yemen" }, geometry: square(43, 12) },
      { type: "Feature" as const, properties: { id: "region:in", name: "India" }, geometry: square(72, 18) },
    ],
  };
  return {
    ...actual,
    loadCountries: vi.fn(() => Promise.resolve(countries)),
    loadAdmin1: vi.fn(() => Promise.resolve({ type: "FeatureCollection", features: [] })),
    loadPlaces: vi.fn(() => Promise.resolve([])),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") || query.includes("hover: hover") ? mocks.desktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  // jsdom has no canvas: the forecast rings fall back to plain circles.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  mocks.responses = { globe: GLOBE, top: TOP, meta: META };
  mocks.errors = {};
  mocks.calls = [];
  mocks.maps = [];
  mocks.overlays = [];
  mocks.desktop = true;
  mocks.pick = null;
  useNav.setState({ view: "globe", panels: [], window: "7d", sectors: [], minConfidence: 0.5, focus: null });
  useGlobeUi.setState({
    toggles: DEFAULT_TOGGLES,
    listOpen: false,
    topCollapsed: false,
    interacted: false,
    appliedFocus: null,
    camera: null,
  });
  useGlobeHover.setState({ hover: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderGlobe() {
  return render(<GlobeView />, { wrapper });
}

const map = (i = 0) => mocks.maps[i] as FakeMap;
const topPanel = () => useNav.getState().panels.at(-1);
const layerIds = () => (mocks.overlays[0]?.props.layers ?? []).map((l) => l.id);

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

describe("GlobeView on a desktop", () => {
  it("creates the map once from our own style, keeps it across re-renders and removes it on unmount", () => {
    const { unmount } = renderGlobe();
    expect(mocks.maps).toHaveLength(1);
    // No tiles, glyphs or sprites from other sites: only our own sources.
    const style = JSON.stringify(map().options.style);
    expect(style).not.toMatch(/https?:|glyphs|sprite/);
    fireEvent.click(screen.getByRole("radio", { name: "Last 24 hours" }));
    fireEvent.click(screen.getByRole("button", { name: "Energy" }));
    expect(mocks.maps).toHaveLength(1);
    unmount();
    expect(map().remove).toHaveBeenCalledTimes(1);
  });

  it("asks for the globe and the Top 5 with the first frame's argument shapes", () => {
    renderGlobe();
    // The default (Sample data off) first frame comes from a live snapshot.
    const keys = Object.keys(snapshotManifest(snapshotPlan("live")));
    for (const name of ["globe", "top", "meta"]) {
      const call = mocks.calls.find((c) => c.name === name);
      expect(call, name).toBeTruthy();
      expect(keys).toContain(snapshotKeyOf(name, call!.args));
    }
  });

  it("binds the time window and the sector lens to the navigation state", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("radio", { name: "Last 24 hours" }));
    expect(useNav.getState().window).toBe("24h");
    fireEvent.click(screen.getByRole("button", { name: "Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Tech" }));
    expect(useNav.getState().sectors).toEqual(["energy", "tech"]);
    const lastGlobe = mocks.calls.filter((c) => c.name === "globe").at(-1);
    expect(lastGlobe?.args).toMatchObject({ window: "24h", sectors: ["energy", "tech"] });
    fireEvent.click(screen.getByRole("button", { name: "All sectors" }));
    expect(useNav.getState().sectors).toEqual([]);
  });

  it("shows the Top 5 and the crowd forecasts that moved, marked once as sample data", () => {
    renderGlobe();
    expect(screen.getByRole("heading", { name: "Top 5 now" })).toBeTruthy();
    expect(
      screen.getByText("Attacks near Bab-el-Mandeb push container lines onto the Cape route"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Crowd forecasts that moved" })).toBeTruthy();
    const mover = screen.getByRole("button", {
      name: /Suez transits recover within six months, crowd forecast/,
    });
    const row = mover.closest("article")!;
    expect(within(row).getByText("Source: Sample forecast")).toBeTruthy();
    expect(within(row).getByText(/MANA volume/)).toBeTruthy();
    expect(within(row).getByText(/Updated/)).toBeTruthy();
    // One "Sample data" badge on the card, not one per row (the status pill says it too; the map key doesn't repeat it).
    expect(screen.getAllByText("Sample data")).toHaveLength(1);
    expect(screen.queryByText(/\b(bet|betting|trade now|wager)\b/i)).toBeNull();
  });

  it("opens a story or a forecast from the Top 5 and flies the globe there", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("button", { name: /Attacks near Bab-el-Mandeb/ }));
    expect(topPanel()).toEqual({ kind: "story", id: "story:red-sea-attacks" });
    expect(map().flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [43.3, 12.6] }));
    fireEvent.click(screen.getByRole("button", { name: /Suez transits recover/ }));
    expect(topPanel()).toEqual({ kind: "forecast", id: FORECAST.id });
  });

  it("lists every event by importance as the keyboard-friendly alternative to the map", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("radio", { name: "List of all events" }));
    const list = screen.getByRole("list", { name: "All events" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Bab-el-Mandeb"),
      expect.stringContaining("Container rates jump"),
      expect.stringContaining("solar auction"),
    ]);
    rows[0].focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.click(rows[2]);
    expect(topPanel()).toEqual({ kind: "story", id: "story:india-solar-auction" });
  });

  it("draws the activity glow, arcs, forecast rings, events and pulses once the map has loaded", () => {
    renderGlobe();
    act(() => map().fire("load"));
    expect(map().addControl).toHaveBeenCalledWith(mocks.overlays[0]);
    expect(layerIds()).toEqual(expect.arrayContaining(["glow", "arcs", "forecasts", "events", "fresh"]));
    expect(layerIds().some((id) => id.includes("hex"))).toBe(false);
  });

  it("shades countries by activity under the borders, fading out as you zoom in", async () => {
    renderGlobe();
    act(() => map().fire("load"));
    const layers = map().options.style.layers;
    const ids = layers.map((l) => l.id);
    const shade = layers.find((l) => l.id === "countries-activity")!;
    expect(ids.indexOf("countries-activity")).toBeGreaterThan(ids.indexOf("countries-fill"));
    expect(ids.indexOf("countries-activity")).toBeLessThan(ids.indexOf("countries-line"));
    expect(ids.indexOf("countries-activity")).toBeLessThan(ids.indexOf("states-line"));
    expect(shade.paint?.["fill-opacity"]).toEqual(["interpolate", ["linear"], ["zoom"], 2.9, 1, 4.2, 0]);
    // No animated transitions (calm-safe).
    expect(shade.paint?.["fill-color-transition"]).toEqual({ duration: 0, delay: 0 });
    // Once the shapes arrive, each country with events gets its shade by id.
    await act(async () => {});
    const states = map().setFeatureState.mock.calls.map(([target, state]) => [target.id, state]);
    expect(states).toEqual(
      expect.arrayContaining([["region:ye", { activity: expect.stringMatching(/^rgba\(/) }]]),
    );
  });

  it("calls the heat layer Activity, and switching it off hides both the shading and the glow", () => {
    renderGlobe();
    act(() => map().fire("load"));
    fireEvent.click(screen.getByRole("button", { name: /Layers/ }));
    expect(screen.getByText("Where news clusters")).toBeTruthy();
    expect(screen.queryByText("Heat")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Activity" }));
    expect(useGlobeUi.getState().toggles.activity).toBe(false);
    expect(layerIds()).not.toContain("glow");
    expect(map().setLayoutProperty).toHaveBeenLastCalledWith("countries-activity", "visibility", "none");
  });

  it("hides cascade links under the shared minimum confidence", () => {
    renderGlobe();
    act(() => map().fire("load"));
    const arcCount = () =>
      (
        (mocks.overlays[0]?.props.layers ?? []).find((l) => l.id === "arcs") as {
          props?: { data?: unknown[] };
        }
      )?.props?.data?.length ?? 0;
    act(() => useNav.getState().setMinConfidence(0));
    const all = arcCount();
    expect(all).toBeGreaterThan(0);
    act(() => useNav.getState().setMinConfidence(0.9));
    expect(arcCount()).toBeLessThan(all);
    // The control in the Layers popover sets the same value.
    fireEvent.click(screen.getByRole("button", { name: /Layers/ }));
    const slider = screen.getByRole("slider", { name: "Minimum confidence" });
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(useNav.getState().minConfidence).toBe(0.3);
  });

  describe("a clicked cascade link", () => {
    type Arc = { id: number | string; dst_story: string };
    const clickFirstArc = (): Arc => {
      const layer = (mocks.overlays[0]?.props.layers ?? []).find((l) => l.id === "arcs") as
        { props?: { data?: Arc[] } } | undefined;
      const first = layer?.props?.data?.[0];
      if (!first) throw new Error("no arcs drawn");
      mocks.pick = (ids) => (ids.includes("arcs") ? { object: first, layer: { id: "arcs" } } : null);
      act(() => map().fire("click", { point: { x: 300, y: 200 } }));
      return first;
    };

    it("pins its card, which opens Why is this here? and the cascade (kg.provenance on)", () => {
      mocks.responses.meta = { ...META, flags: { "kg.provenance": true } };
      renderGlobe();
      act(() => map().fire("load"));
      const arc = clickFirstArc();
      const card = screen.getByRole("region", { name: "Selected on the globe" });
      expect(topPanel()).toBeUndefined();
      fireEvent.click(within(card).getByRole("button", { name: /^Why is this here\? .+, leads to, / }));
      expect(topPanel()).toEqual({ kind: "why", target: "link", id: String(arc.id) });
      // While the sheet is open, Escape is the app's (it steps back); then it closes the card.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.getByRole("region", { name: "Selected on the globe" })).toBeTruthy();
      act(() => useNav.getState().back());
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryByRole("region", { name: "Selected on the globe" })).toBeNull();

      clickFirstArc();
      fireEvent.click(screen.getByRole("button", { name: "See the cascade" }));
      expect(topPanel()).toEqual({ kind: "cascade", id: arc.dst_story });
      expect(screen.queryByRole("region", { name: "Selected on the globe" })).toBeNull();
    });

    it("opens the cascade straight away while kg.provenance is off", () => {
      renderGlobe();
      act(() => map().fire("load"));
      const arc = clickFirstArc();
      expect(screen.queryByRole("region", { name: "Selected on the globe" })).toBeNull();
      expect(topPanel()).toEqual({ kind: "cascade", id: arc.dst_story });
    });
  });

  it("hides a layer when it is switched off", () => {
    renderGlobe();
    act(() => map().fire("load"));
    act(() => useGlobeUi.getState().setToggle("arcs", false));
    expect(layerIds()).not.toContain("arcs");
    expect(layerIds()).toContain("events");
  });

  it("comes back to where the viewer left the camera", () => {
    const first = renderGlobe();
    act(() => map().fire("load"));
    act(() => map().fire("mousedown"));
    act(() => map().fire("moveend"));
    expect(useGlobeUi.getState().camera).toEqual({ center: [25, 20], zoom: 1.8 });
    first.unmount();
    useGlobeUi.setState({ camera: { center: [78, 22], zoom: 4.2 } });
    renderGlobe();
    expect(map(1).options).toMatchObject({ center: [78, 22], zoom: 4.2 });
  });

  it("starts at home, and doesn't keep a camera nobody moved", () => {
    renderGlobe();
    act(() => map().fire("load"));
    act(() => map().fire("moveend"));
    expect(useGlobeUi.getState().camera).toBeNull();
    expect(map().options.center).toEqual([25, 20]);
  });

  it("flies to places that other screens ask for", () => {
    renderGlobe();
    act(() => useNav.getState().flyTo({ lon: 10, lat: 50, zoom: 4 }));
    expect(map().flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [10, 50], zoom: 4 }));
  });

  it("replays the window and can be stopped", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("button", { name: "Replay the last 7 days" }));
    expect(screen.getByRole("progressbar", { name: "Replay progress" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Stop the replay" })[0]);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("explains a failure and offers a retry", () => {
    mocks.responses = { meta: META };
    mocks.errors = { globe: new DataError("unavailable", "timeout", true) };
    renderGlobe();
    expect(screen.getByText("The data is taking a moment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("suggests a longer window when nothing happened", () => {
    mocks.responses = {
      globe: { ...GLOBE, events: [], arcs: [], forecasts: [] },
      top: { stories: [], movers: [] },
      meta: META,
    };
    renderGlobe();
    expect(screen.getByText("Nothing in the last 7 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 30 days" }));
    expect(useNav.getState().window).toBe("30d");
  });

  it("offers a next step when the list is empty", () => {
    mocks.responses = {
      globe: { ...GLOBE, events: [], arcs: [], forecasts: [] },
      top: { stories: [], movers: [] },
      meta: META,
    };
    useNav.setState({ sectors: ["energy"] });
    renderGlobe();
    fireEvent.click(screen.getByRole("radio", { name: "List of all events" }));
    expect(screen.getByText("No events for this sector lens")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all sectors" }));
    expect(useNav.getState().sectors).toEqual([]);
    expect(screen.getByText("No events in the last 7 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 30 days" }));
    expect(useNav.getState().window).toBe("30d");
  });

  it("shows drafts from the live feed by their source headline, without a so-what", () => {
    mocks.responses = {
      globe: GLOBE,
      top: TOP_LIVE,
      meta: { ...META, data: { ...META.data, live_stories: 2, showing_sample: false } },
    };
    renderGlobe();
    expect(screen.getByText("Copper smelter halts output after power cut - Reuters")).toBeTruthy();
    expect(screen.getAllByText("Draft · awaiting analysis")).toHaveLength(1);
    expect(screen.queryByText("Sample data")).toBeNull();
  });

  it("marks draft events in the list when the API says which they are", () => {
    const [first, ...rest] = GLOBE.events;
    mocks.responses = {
      ...mocks.responses,
      globe: { ...GLOBE, events: [{ ...first, analysed: false }, ...rest] },
    };
    renderGlobe();
    fireEvent.click(screen.getByRole("radio", { name: "List of all events" }));
    const list = screen.getByRole("list", { name: "All events" });
    const notes = within(list).getAllByText("Draft · awaiting analysis");
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("li")?.textContent).toContain("Bab-el-Mandeb");
  });

  it("marks each sample row when sample data is switched on beside live news", () => {
    const [first, second, third] = GLOBE.events;
    useSettings.setState({ sample: "on" });
    mocks.responses = {
      globe: {
        ...GLOBE,
        events: [
          { ...first, is_sample: true },
          { ...second, is_sample: false },
          { ...third, is_sample: false },
        ],
      },
      top: TOP_LIVE,
      meta: { ...META, data: { ...META.data, live_stories: 2, showing_sample: false } },
    };
    try {
      renderGlobe();
      fireEvent.click(screen.getByRole("radio", { name: "List of all events" }));
      const list = screen.getByRole("list", { name: "All events" });
      const marked = within(list).getAllByText("Sample");
      expect(marked).toHaveLength(1);
      expect(marked[0].closest("li")?.textContent).toContain("Bab-el-Mandeb");
      expect(screen.getByText("Includes")).toBeTruthy();
    } finally {
      useSettings.setState({ sample: "auto" });
    }
  });

  it("shows a Top 5 story the same way in the List: its icon, arrow and place", () => {
    const [first, ...rest] = GLOBE.events;
    const topStory = {
      ...TOP.stories[0],
      region: { id: "region:ye.aden", name: "Aden", subtype: "city", country_id: "region:ye" },
    };
    mocks.responses = {
      ...mocks.responses,
      globe: { ...GLOBE, events: [first, ...rest] },
      top: { ...TOP, stories: [topStory, ...TOP.stories.slice(1)] },
    };
    renderGlobe();
    fireEvent.click(screen.getByRole("radio", { name: "List of all events" }));
    const list = screen.getByRole("list", { name: "All events" });
    const row = within(list).getByText(first.headline).closest("li")!;
    expect(row.textContent).toContain("Aden");
  });

  it("fades links that don't touch the open region's country", () => {
    useNav.setState({ panels: [{ kind: "region", id: "region:fr" }] });
    renderGlobe();
    act(() => map().fire("load"));
    const arcs = mocks.overlays[0]?.props.layers?.find((l) => l.id === "arcs") as unknown as {
      props: { data: { dim: boolean; src_country: string; dst_country: string }[] };
    };
    expect(arcs.props.data.length).toBeGreaterThan(0);
    for (const a of arcs.props.data) {
      expect(a.dim).toBe(a.src_country !== "region:fr" && a.dst_country !== "region:fr");
    }
  });
});

// ---------------------------------------------------------------------------
// The slow turn (idle-spin.ts): after Home, or after idle time with nothing open
// ---------------------------------------------------------------------------

describe("GlobeView's slow turn", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    vi.setSystemTime(NOW);
    useSettings.setState({ calm: false });
  });
  afterEach(() => useSettings.setState({ calm: false }));

  const turns = () => map().setCenter.mock.calls.length;

  it("doesn't turn on load; it turns after idle time, and input stops it", () => {
    renderGlobe();
    act(() => map().fire("load"));
    act(() => vi.advanceTimersByTime(5000));
    expect(turns()).toBe(0);
    act(() => vi.advanceTimersByTime(IDLE_MS));
    expect(turns()).toBeGreaterThan(0);
    act(() => void fireEvent.pointerDown(document.body));
    const before = turns();
    act(() => vi.advanceTimersByTime(5000));
    expect(turns()).toBe(before);
  });

  it("turns once Home's flight back lands", () => {
    renderGlobe();
    act(() => map().fire("load"));
    fireEvent.click(screen.getByRole("button", { name: "Show the whole globe" }));
    expect(map().flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [25, 20] }));
    act(() => vi.advanceTimersByTime(1000));
    expect(turns()).toBe(0); // still flying
    act(() => map().fire("moveend"));
    act(() => vi.advanceTimersByTime(4000));
    expect(turns()).toBeGreaterThan(0);
  });

  it("waits while a panel is open", () => {
    useNav.setState({ panels: [{ kind: "region", id: "region:in" }] });
    renderGlobe();
    act(() => map().fire("load"));
    act(() => vi.advanceTimersByTime(IDLE_MS * 3));
    expect(turns()).toBe(0);
  });

  it("never turns with the Calm setting", () => {
    useSettings.setState({ calm: true });
    renderGlobe();
    act(() => map().fire("load"));
    fireEvent.click(screen.getByRole("button", { name: "Show the whole globe" }));
    act(() => map().fire("moveend"));
    act(() => vi.advanceTimersByTime(IDLE_MS * 3));
    expect(turns()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

describe("GlobeView on a phone", () => {
  beforeEach(() => {
    mocks.desktop = false;
  });

  it("folds the controls into one bar and the Top 5 into a strip that collapses", () => {
    renderGlobe();
    expect(screen.getByRole("button", { name: "Sector lens: All sectors" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Map layers and key" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Last 7 days" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("heading", { name: "Top 5 now" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Hide the top stories" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show the top stories" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("never squeezes the time window below its labels (the browser check is toolbar.mjs in fix-ui)", () => {
    renderGlobe();
    const group = screen.getByRole("radiogroup", { name: "Time window" });
    // Not narrower than its content, with tight segments so the bar fits at 360 px.
    expect(group.className).toContain("min-w-fit");
    expect(group.className).not.toContain("min-w-0");
    expect(group.className).toContain("[&>*]:px-1.5");
  });

  it("opens the list from the bar and closes it again", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("button", { name: "List of events" }));
    expect(screen.getByRole("heading", { name: "All events" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close the list" }));
    expect(screen.queryByRole("heading", { name: "All events" })).toBeNull();
  });
});
