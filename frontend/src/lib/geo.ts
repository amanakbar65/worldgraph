/**
 * The map layers WorldGraph draws itself: country shapes, state/province
 * shapes and city points. The Artifact can't load map tiles from other sites,
 * so these ship as static files in `public/geo/`, built from Natural Earth by
 * `uv run --group geo wg geo assets` (backend/src/worldgraph/geo/assets.py).
 *
 * - Shape ids are the gazetteer's region ids (`region:in`, `region:in-gj`), so
 *   a shape always matches its region node. Country land without a region of
 *   its own (Somaliland, northern Cyprus, Siachen in the default view) has
 *   `id: null`: draw it, but it has nothing to open.
 * - Two worldviews: the international default, and India's official one
 *   (all territory India claims is India; Jammu and Kashmir and Ladakh include
 *   it). India's view changes Asian borders only, so other continents share
 *   one file.
 * - Rings are wound the GeoJSON way (RFC 7946): outer rings counterclockwise.
 *   deck.gl and MapLibre accept this as is; d3-geo wants the opposite.
 * - Files are fetched with relative URLs, because inside claude.ai the app is
 *   served from a sub-path. Each file is fetched once and kept in memory; a
 *   failed fetch is forgotten, so the next call tries again.
 */
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

import continentMap from "./geo-continents.json";

export type Worldview = "default" | "india";

/** Admin-1 files, one per continent (keys of `geo-continents.json`). */
export const CONTINENTS = ["africa", "asia", "europe", "north-america", "south-america", "oceania"] as const;
export type Continent = (typeof CONTINENTS)[number];

export type Area = Polygon | MultiPolygon;
export type CountryProps = { id: string | null; name: string };
export type StateProps = { id: string; name: string; country: string };
export type CountryFeature = Feature<Area, CountryProps>;
export type StateFeature = Feature<Area, StateProps>;
export type CountryCollection = FeatureCollection<Area, CountryProps>;
export type StateCollection = FeatureCollection<Area, StateProps>;

/** A city from the gazetteer (`places.json`). */
export interface Place {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** The state it lies in, or the country when no state shape contains it. */
  parent: string;
  population: number;
  /** National capital. */
  capital: boolean;
}

const GEO_DIR = "geo/";
export const PLACES_URL = `${GEO_DIR}places.json`;

// --------------------------------------------------------------------------
// Pure helpers
// --------------------------------------------------------------------------

/** The worldview for the "India's official borders" setting. */
export function worldviewFor(indiaBorders: boolean): Worldview {
  return indiaBorders ? "india" : "default";
}

function isContinent(value: unknown): value is Continent {
  return typeof value === "string" && (CONTINENTS as readonly string[]).includes(value);
}

const CONTINENT_OF: ReadonlyMap<string, Continent> = new Map(
  Object.entries(continentMap as Record<string, unknown>).filter((entry): entry is [string, Continent] =>
    isContinent(entry[1]),
  ),
);

/**
 * The country a region id belongs to: `region:in-gj.ahmedabad` → `region:in`.
 * Null for ids that aren't regions.
 */
export function countryIdOf(regionId: string): string | null {
  const match = /^region:([a-z]{2})(?=$|[-.])/.exec(regionId);
  return match ? `region:${match[1]}` : null;
}

/** Which admin-1 file holds a country's states (any region id of the country works). */
export function continentOf(countryId: string): Continent | null {
  const country = countryIdOf(countryId);
  return country === null ? null : (CONTINENT_OF.get(country) ?? null);
}

export function countriesUrl(worldview: Worldview): string {
  return `${GEO_DIR}${worldview === "india" ? "countries-in.json" : "countries.json"}`;
}

export function admin1Url(continent: Continent, worldview: Worldview): string {
  const india = worldview === "india" && continent === "asia";
  return `${GEO_DIR}admin1-${continent}${india ? "-in" : ""}.json`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** One `places.json` row, `[id, name, lon, lat, parent, population, capital]`; null if malformed. */
export function parsePlace(row: unknown): Place | null {
  if (!Array.isArray(row) || row.length < 7) return null;
  const [id, name, lon, lat, parent, population, capital] = row as unknown[];
  if (typeof id !== "string" || typeof name !== "string" || typeof parent !== "string") return null;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat) || !isFiniteNumber(population)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { id, name, lon, lat, parent, population, capital: capital === 1 || capital === true };
}

/** The whole `places.json` file; malformed rows are skipped. */
export function parsePlaces(data: unknown): Place[] {
  if (!Array.isArray(data)) throw new Error("places.json is not a list");
  return data.map(parsePlace).filter((place): place is Place => place !== null);
}

/** GeoJSON features from one of our TopoJSON files. */
export function topologyFeatures<P extends CountryProps | StateProps>(
  data: unknown,
  objectName: string,
): FeatureCollection<Area, P> {
  const topology = data as Topology;
  const object = topology?.type === "Topology" ? topology.objects?.[objectName] : undefined;
  if (object?.type !== "GeometryCollection") throw new Error(`Not a map layer with "${objectName}" shapes`);
  return feature(topology, object as GeometryCollection<P>) as FeatureCollection<Area, P>;
}

function collection<P>(features: Feature<Area, P>[]): FeatureCollection<Area, P> {
  return { type: "FeatureCollection", features };
}

/** States grouped by their country id. */
export function groupByCountry(states: StateCollection): Map<string, StateCollection> {
  const groups = new Map<string, StateFeature[]>();
  for (const state of states.features) {
    const list = groups.get(state.properties.country);
    if (list) list.push(state);
    else groups.set(state.properties.country, [state]);
  }
  return new Map([...groups].map(([country, features]) => [country, collection(features)]));
}

// --------------------------------------------------------------------------
// Loading (fetched once, kept in memory)
// --------------------------------------------------------------------------

const cache = new Map<string, Promise<unknown>>();
const NO_STATES: StateCollection = collection<StateProps>([]);

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing as Promise<T>;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response.json() as Promise<unknown>;
}

/** Forget every loaded file (tests, or after the files change). */
export function clearGeoCache(): void {
  cache.clear();
}

/** Every country (and unclaimed land, with `id: null`) in a worldview. */
export function loadCountries(worldview: Worldview): Promise<CountryCollection> {
  const url = countriesUrl(worldview);
  return cached(url, async () => topologyFeatures<CountryProps>(await fetchJson(url), "countries"));
}

interface Admin1File {
  all: StateCollection;
  byCountry: Map<string, StateCollection>;
}

function loadAdmin1File(continent: Continent, worldview: Worldview): Promise<Admin1File> {
  const url = admin1Url(continent, worldview);
  return cached(url, async () => {
    const all = topologyFeatures<StateProps>(await fetchJson(url), "admin1");
    return { all, byCountry: groupByCountry(all) };
  });
}

/**
 * A country's states and provinces. Any region id of the country works
 * (`region:in`, `region:in-gj`). An unknown country, or one Natural Earth
 * doesn't divide, gives an empty collection. The same country always gives
 * the same object, so it can be a stable layer input.
 */
export async function loadAdmin1(country: string, worldview: Worldview): Promise<StateCollection> {
  const id = countryIdOf(country);
  const continent = continentOf(country);
  if (!id || !continent) return NO_STATES;
  const file = await loadAdmin1File(continent, worldview);
  return file.byCountry.get(id) ?? NO_STATES;
}

/** Every state and province in one continent's file. */
export async function loadAdmin1Continent(
  continent: Continent,
  worldview: Worldview,
): Promise<StateCollection> {
  return (await loadAdmin1File(continent, worldview)).all;
}

/** The gazetteer's cities: every national capital and every city of a million or more. */
export function loadPlaces(): Promise<Place[]> {
  return cached(PLACES_URL, async () => parsePlaces(await fetchJson(PLACES_URL)));
}
