import type { MultiPolygon, Polygon } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";

import placesFile from "../../public/geo/places.json";
import {
  CONTINENTS,
  admin1Url,
  clearGeoCache,
  continentOf,
  countriesUrl,
  countryIdOf,
  loadAdmin1,
  loadPlaces,
  parsePlace,
  parsePlaces,
  topologyFeatures,
  worldviewFor,
  type CountryProps,
  type StateProps,
} from "./geo";
import continentMap from "./geo-continents.json";

describe("countryIdOf", () => {
  it("finds the country of any region id", () => {
    expect(countryIdOf("region:in")).toBe("region:in");
    expect(countryIdOf("region:in-gj")).toBe("region:in");
    expect(countryIdOf("region:au-ne1234")).toBe("region:au");
    expect(countryIdOf("region:in-gj.ahmedabad")).toBe("region:in");
    expect(countryIdOf("region:sg.singapore")).toBe("region:sg");
  });
  it("rejects ids that aren't regions", () => {
    expect(countryIdOf("commodity:crude-oil")).toBeNull();
    expect(countryIdOf("region:india")).toBeNull();
    expect(countryIdOf("")).toBeNull();
  });
});

describe("continentOf", () => {
  it("maps countries to their admin-1 file", () => {
    expect(continentOf("region:in")).toBe("asia");
    expect(continentOf("region:fr")).toBe("europe");
    expect(continentOf("region:ng")).toBe("africa");
    expect(continentOf("region:us")).toBe("north-america");
    expect(continentOf("region:br")).toBe("south-america");
    expect(continentOf("region:au")).toBe("oceania");
  });
  it("accepts state and city ids", () => {
    expect(continentOf("region:in-gj")).toBe("asia");
    expect(continentOf("region:de-be.berlin")).toBe("europe");
  });
  it("returns null for unknown ids", () => {
    expect(continentOf("region:zz")).toBeNull();
    expect(continentOf("story:red-sea-attacks")).toBeNull();
  });
  it("covers every gazetteer country with a known file", () => {
    const entries = Object.entries(continentMap as Record<string, string>);
    expect(entries.length).toBeGreaterThan(200);
    for (const [country, continent] of entries) {
      expect(country).toMatch(/^region:[a-z]{2}$/);
      expect(CONTINENTS).toContain(continent);
    }
  });
});

describe("file names", () => {
  it("uses relative URLs", () => {
    expect(countriesUrl("default")).toBe("geo/countries.json");
    expect(countriesUrl("india")).toBe("geo/countries-in.json");
  });
  it("uses India's admin-1 file for Asia only", () => {
    expect(admin1Url("asia", "default")).toBe("geo/admin1-asia.json");
    expect(admin1Url("asia", "india")).toBe("geo/admin1-asia-in.json");
    expect(admin1Url("europe", "india")).toBe("geo/admin1-europe.json");
    expect(admin1Url("north-america", "default")).toBe("geo/admin1-north-america.json");
  });
  it("picks the worldview from the borders setting", () => {
    expect(worldviewFor(true)).toBe("india");
    expect(worldviewFor(false)).toBe("default");
  });
});

describe("parsePlace", () => {
  it("reads a row", () => {
    expect(
      parsePlace(["region:in-mh.mumbai", "Mumbai", 72.8557, 19.0189, "region:in-mh", 18978000, 0]),
    ).toEqual({
      id: "region:in-mh.mumbai",
      name: "Mumbai",
      lon: 72.8557,
      lat: 19.0189,
      parent: "region:in-mh",
      population: 18978000,
      capital: false,
    });
    expect(
      parsePlace(["region:in-dl.new-delhi", "New Delhi", 77.2, 28.6, "region:in-dl", 317797, 1])?.capital,
    ).toBe(true);
  });
  it("rejects malformed rows", () => {
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace({ id: "region:fr.paris" })).toBeNull();
    expect(parsePlace(["region:fr.paris", "Paris", 2.35, 48.85, "region:fr"])).toBeNull();
    expect(parsePlace(["region:fr.paris", "Paris", "2.35", 48.85, "region:fr", 1, 1])).toBeNull();
    expect(parsePlace(["region:fr.paris", "Paris", 2.35, 148.85, "region:fr", 1, 1])).toBeNull();
    expect(parsePlace(["region:fr.paris", "Paris", Number.NaN, 48.85, "region:fr", 1, 1])).toBeNull();
  });
});

describe("parsePlaces", () => {
  it("skips bad rows and keeps the rest", () => {
    const places = parsePlaces([
      ["region:jp-13.tokyo", "Tokyo", 139.75, 35.68, "region:jp-13", 35676000, 1],
      "x",
    ]);
    expect(places.map((p) => p.id)).toEqual(["region:jp-13.tokyo"]);
  });
  it("throws on a file that isn't a list", () => {
    expect(() => parsePlaces({})).toThrow();
  });
  it("reads the shipped places.json completely", () => {
    const places = parsePlaces(placesFile);
    expect(places.length).toBe((placesFile as unknown[]).length);
    expect(places.length).toBeGreaterThan(500);
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
    for (const place of places) {
      expect(continentOf(place.parent)).not.toBeNull();
      expect(place.id.startsWith(`${place.parent}.`)).toBe(true);
    }
    expect(places.some((p) => p.id === "region:in-dl.new-delhi" && p.capital)).toBe(true);
  });
});

// Two unit squares: one Indian state, one Pakistani province.
const TOPOLOGY = {
  type: "Topology",
  arcs: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    [
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
      [2, 0],
    ],
  ],
  objects: {
    admin1: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          arcs: [[0]],
          properties: { id: "region:in-gj", name: "Gujarat", country: "region:in" },
        },
        {
          type: "Polygon",
          arcs: [[1]],
          properties: { id: "region:pk-sd", name: "Sindh", country: "region:pk" },
        },
      ],
    },
  },
};

function respond(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe("topologyFeatures", () => {
  it("turns a topology into GeoJSON features", () => {
    const states = topologyFeatures(TOPOLOGY, "admin1");
    expect(states.features.map((f) => f.properties.id)).toEqual(["region:in-gj", "region:pk-sd"]);
    expect(states.features[0].geometry.type).toBe("Polygon");
  });
  it("rejects other files", () => {
    expect(() => topologyFeatures(TOPOLOGY, "countries")).toThrow();
    expect(() => topologyFeatures([], "admin1")).toThrow();
  });
});

describe("loadAdmin1", () => {
  afterEach(() => {
    clearGeoCache();
    vi.unstubAllGlobals();
  });

  it("filters to the country and fetches each file once", async () => {
    const fetchMock = vi.fn(async () => respond(TOPOLOGY));
    vi.stubGlobal("fetch", fetchMock);
    const india = await loadAdmin1("region:in", "india");
    const pakistan = await loadAdmin1("region:pk-sd", "india");
    expect(india.features.map((f) => f.properties.id)).toEqual(["region:in-gj"]);
    expect(pakistan.features.map((f) => f.properties.id)).toEqual(["region:pk-sd"]);
    expect(await loadAdmin1("region:in", "india")).toBe(india);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("geo/admin1-asia-in.json");
  });

  it("gives no states for unknown countries without fetching", async () => {
    const fetchMock = vi.fn(async () => respond(TOPOLOGY));
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadAdmin1("region:zz", "default")).features).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tries again after a failed fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(null, 503)).mockResolvedValue(respond(TOPOLOGY));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadAdmin1("region:in", "default")).rejects.toThrow(/503/);
    expect((await loadAdmin1("region:in", "default")).features).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("loadPlaces", () => {
  afterEach(() => {
    clearGeoCache();
    vi.unstubAllGlobals();
  });

  it("loads places.json from a relative URL", async () => {
    const fetchMock = vi.fn(async () => respond(placesFile));
    vi.stubGlobal("fetch", fetchMock);
    const places = await loadPlaces();
    expect(places.length).toBe((placesFile as unknown[]).length);
    expect(fetchMock).toHaveBeenCalledWith("geo/places.json");
  });
});

// The shipped map files, decoded by the same code the app uses.
const shipped = import.meta.glob<string>("../../public/geo/*.json", { query: "?raw", import: "default" });

async function shippedFile(url: string): Promise<unknown> {
  const load = shipped[`../../public/${url}`];
  if (!load) throw new Error(`missing public/${url}`);
  return JSON.parse(await load()) as unknown;
}

function ringContains(ring: number[][], [x, y]: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function areaContains(geometry: Polygon | MultiPolygon, point: [number, number]): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    ([outer, ...holes]) => ringContains(outer, point) && !holes.some((hole) => ringContains(hole, point)),
  );
}

const GILGIT: [number, number] = [74.31, 35.92];
const AKSAI_CHIN: [number, number] = [79.5, 35.2];

describe("shipped map files", () => {
  it("show India's claimed borders only in India's worldview", async () => {
    const india = async (url: string) =>
      topologyFeatures<CountryProps>(await shippedFile(url), "countries").features.find(
        (f) => f.properties.id === "region:in",
      );
    const inDefault = await india(countriesUrl("default"));
    const inIndiaView = await india(countriesUrl("india"));
    expect(inDefault && areaContains(inDefault.geometry, GILGIT)).toBe(false);
    expect(inIndiaView && areaContains(inIndiaView.geometry, GILGIT)).toBe(true);
    expect(inIndiaView && areaContains(inIndiaView.geometry, AKSAI_CHIN)).toBe(true);
  });

  it("give every country a shape", async () => {
    const countries = topologyFeatures<CountryProps>(await shippedFile(countriesUrl("default")), "countries");
    const ids = new Set(countries.features.map((f) => f.properties.id));
    for (const country of Object.keys(continentMap)) expect(ids.has(country)).toBe(true);
  });

  it("keep each state in its continent's file", async () => {
    const files = [
      ...CONTINENTS.map((continent) => [continent, admin1Url(continent, "default")] as const),
      ["asia", admin1Url("asia", "india")] as const,
    ];
    for (const [continent, url] of files) {
      const states = topologyFeatures<StateProps>(await shippedFile(url), "admin1");
      expect(states.features.length).toBeGreaterThan(100);
      for (const state of states.features) {
        expect(continentOf(state.properties.country)).toBe(continent);
        expect(countryIdOf(state.properties.id)).toBe(state.properties.country);
      }
    }
  });
});
