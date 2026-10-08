import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { snapshotKeyOf, snapshotManifest } from "@/lib/snapshot-plan";
import { useNav } from "@/state/nav";

import { FORECAST, GLOBE, META, NOW, TOP, TOP_LIVE } from "./fixtures";
import GlobeView from "./GlobeView";
import { DEFAULT_TOGGLES } from "./layers";
import { useGlobeHover, useGlobeUi } from "./store";

// ---------------------------------------------------------------------------
// Mocks: data, MapLibre, deck.gl's overlay, the map shapes and the browser
// ---------------------------------------------------------------------------

interface FakeMap {
  options: { center: [number, number]; zoom: number; style: { layers: { id: string }[] } };
  fire: (type: string, event?: unknown) => void;
  flyTo: ReturnType<typeof vi.fn>;
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
  useConnection: <T,>(select: (s: { state: { status: string } }) => T) => select({ state: { status: "live" } }),
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
    pickMultipleObjects() {
      return [];
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
  useNav.setState({ view: "globe", panels: [], window: "7d", sectors: [], focus: null });
  useGlobeUi.setState({
    toggles: DEFAULT_TOGGLES,
    listOpen: false,
    topCollapsed: false,
    interacted: false,
    appliedFocus: null,
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
    const keys = Object.keys(snapshotManifest());
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
    expect(screen.getByText("Attacks near Bab-el-Mandeb push container lines onto the Cape route")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Crowd forecasts that moved" })).toBeTruthy();
    const mover = screen.getByRole("button", { name: /Suez transits recover within six months, crowd forecast/ });
    const row = mover.closest("article")!;
    expect(within(row).getByText("Source: Sample forecast")).toBeTruthy();
    expect(within(row).getByText(/MANA volume/)).toBeTruthy();
    expect(within(row).getByText(/Updated/)).toBeTruthy();
    // One "Sample data" badge on the card (plus the one in the map key), not one per row.
    expect(screen.getAllByText("Sample data")).toHaveLength(2);
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

  it("draws heat, arcs, forecast rings, events and pulses once the map has loaded", () => {
    renderGlobe();
    act(() => map().fire("load"));
    expect(map().addControl).toHaveBeenCalledWith(mocks.overlays[0]);
    expect(layerIds()).toEqual(expect.arrayContaining(["hex", "arcs", "forecasts", "events", "fresh"]));
  });

  it("hides a layer when it is switched off", () => {
    renderGlobe();
    act(() => map().fire("load"));
    act(() => useGlobeUi.getState().setToggle("arcs", false));
    expect(layerIds()).not.toContain("arcs");
    expect(layerIds()).toContain("events");
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
    mocks.responses = { globe: { ...GLOBE, events: [], arcs: [], forecasts: [] }, top: { stories: [], movers: [] }, meta: META };
    renderGlobe();
    expect(screen.getByText("Nothing in the last 7 days")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Show the top stories" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the list from the bar and closes it again", () => {
    renderGlobe();
    fireEvent.click(screen.getByRole("button", { name: "List of events" }));
    expect(screen.getByRole("heading", { name: "All events" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close the list" }));
    expect(screen.queryByRole("heading", { name: "All events" })).toBeNull();
  });
});
