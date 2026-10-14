/**
 * The globe's data shaping, kept free of React and WebGL so it can be tested:
 * hex binning, size and colour scales, arc filtering, the list order, and the
 * small geometry helpers the camera needs.
 */
import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";

import type { ForecastSummary, GlobeResponse, Impact, SectorId, StorySummary } from "@/api/contract";
import { SECTORS } from "@/lib/icons";
import { mix, withAlpha, type GlobePalette, type Rgba } from "@/lib/globe-color";

export type GlobeEvent = GlobeResponse["events"][number];
export type GlobeArc = GlobeResponse["arcs"][number];
export type GlobeCountry = GlobeResponse["countries"][number];
export type LngLat = [number, number];

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

/** The impact a group of events leans to: more than 15 points of balance either way. */
export function leaningImpact(risk: number, opportunity: number, neutral: number): Impact {
  const n = risk + opportunity + neutral;
  if (n === 0) return "neutral";
  const score = (opportunity - risk) / n;
  if (score > 0.15) return "opportunity";
  if (score < -0.15) return "risk";
  return "neutral";
}

export function impactColor(impact: Impact, palette: GlobePalette): Rgba {
  return palette[impact] ?? palette.neutral;
}

// ---------------------------------------------------------------------------
// Hex heat (H3, computed here from the events)
// ---------------------------------------------------------------------------

/** Coarser hexes when zoomed out, finer ones closer in. */
export function hexResolutionForZoom(zoom: number): number {
  if (zoom < 1.6) return 1;
  if (zoom < 3) return 2;
  if (zoom < 4.4) return 3;
  if (zoom < 5.8) return 4;
  return 5;
}

export interface HexBin {
  h3: string;
  /** Outline as [lng, lat] pairs, unwrapped so it never jumps across the antimeridian. */
  polygon: LngLat[];
  lon: number;
  lat: number;
  count: number;
  risk: number;
  opportunity: number;
  neutral: number;
  impact: Impact;
  /** Sum of the events' importance (0–100 each). */
  weight: number;
  ids: string[];
}

/** Shift western longitudes east when a ring straddles ±180°, so it tessellates as one shape. */
export function unwrapRing(ring: LngLat[]): LngLat[] {
  const lons = ring.map((p) => p[0]);
  if (Math.max(...lons) - Math.min(...lons) <= 180) return ring;
  return ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
}

/** Group events into H3 cells at one resolution. Stable order: heaviest first. */
export function binEvents(events: readonly GlobeEvent[], resolution: number): HexBin[] {
  const bins = new Map<string, HexBin>();
  for (const e of events) {
    let h3: string;
    try {
      h3 = latLngToCell(e.lat, e.lon, resolution);
    } catch {
      continue;
    }
    let bin = bins.get(h3);
    if (!bin) {
      const [lat, lon] = cellToLatLng(h3);
      bin = {
        h3,
        polygon: unwrapRing(cellToBoundary(h3, true) as LngLat[]),
        lon,
        lat,
        count: 0,
        risk: 0,
        opportunity: 0,
        neutral: 0,
        impact: "neutral",
        weight: 0,
        ids: [],
      };
      bins.set(h3, bin);
    }
    bin.count += 1;
    bin[e.impact] += 1;
    bin.weight += e.importance;
    bin.ids.push(e.id);
  }
  const out = [...bins.values()];
  for (const bin of out) bin.impact = leaningImpact(bin.risk, bin.opportunity, bin.neutral);
  return out.sort((a, b) => b.weight - a.weight || a.h3.localeCompare(b.h3));
}

/** Fill for a hex: its leaning impact, stronger where more is happening (square-root scale). */
export function hexFill(bin: HexBin, maxWeight: number, palette: GlobePalette): Rgba {
  const t = maxWeight > 0 ? Math.sqrt(bin.weight / maxWeight) : 0;
  return withAlpha(impactColor(bin.impact, palette), 0.08 + 0.3 * t);
}

// ---------------------------------------------------------------------------
// Event points
// ---------------------------------------------------------------------------

/** Point radius in pixels: 3 px for minor items up to 11 px for the most important. */
export function eventRadius(importance: number): number {
  const t = Math.min(1, Math.max(0, importance / 100));
  return 3 + 8 * t ** 1.4;
}

/** Marks are a little smaller on a small, far-away globe and grow as you zoom in. */
export function zoomScale(zoom: number): number {
  return Math.min(1.5, Math.max(0.7, 0.85 + 0.15 * (zoom - 1.8)));
}

// ---------------------------------------------------------------------------
// Arcs (cross-border cascade links)
// ---------------------------------------------------------------------------

export interface ArcDatum extends GlobeArc {
  /** Touches the story or forecast in focus (hovered or open). */
  focus: boolean;
  path: [number, number, number][];
}

/**
 * The arcs worth drawing: each cause → effect pair once, reported links
 * before inferred ones, the most confident first, at most `max`. Arcs that
 * touch `focusId` always stay and are flagged; when something is in focus,
 * the rest can be hidden with `onlyFocus`.
 */
export function filterArcs(
  arcs: readonly GlobeArc[],
  options: { focusId?: string | null; max?: number; onlyFocus?: boolean; minConfidence?: number } = {},
): (GlobeArc & { focus: boolean })[] {
  const { focusId = null, max = 80, onlyFocus = false, minConfidence = 0 } = options;
  const seen = new Set<string>();
  const out: (GlobeArc & { focus: boolean })[] = [];
  const ranked = [...arcs].sort(
    (a, b) =>
      Number(a.link_type !== "reported") - Number(b.link_type !== "reported") ||
      b.confidence - a.confidence ||
      a.id - b.id,
  );
  for (const arc of ranked) {
    const key = `${arc.src_story}>${arc.dst_story}`;
    if (seen.has(key)) continue;
    if (arc.src[0] === arc.dst[0] && arc.src[1] === arc.dst[1]) continue;
    const focus = focusId !== null && (arc.src_story === focusId || arc.dst_story === focusId);
    if (!focus && (onlyFocus || arc.confidence < minConfidence)) continue;
    seen.add(key);
    out.push({ ...arc, focus });
  }
  const focused = out.filter((a) => a.focus);
  const rest = out.filter((a) => !a.focus).slice(0, Math.max(0, max - focused.length));
  return [...focused, ...rest];
}

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const [lon1, lat1] = a.map((v) => v * RAD);
  const [lon2, lat2] = b.map((v) => v * RAD);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * An arc as a 3D path: points along the great circle, lifted off the surface
 * in a smooth hump (higher for longer links). Longitudes are unwrapped so the
 * path never jumps across the antimeridian.
 */
export function arcPath(src: LngLat, dst: LngLat, segments = 40): [number, number, number][] {
  const d = distanceMeters(src, dst);
  const height = Math.min(650_000, 0.07 * d);
  const [lon1, lat1] = src.map((v) => v * RAD);
  const [lon2, lat2] = dst.map((v) => v * RAD);
  const delta = d / EARTH_RADIUS_M;
  const out: [number, number, number][] = [];
  let prevLon: number | null = null;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let lon: number;
    let lat: number;
    if (delta < 1e-9 || i === 0) {
      lon = src[0];
      lat = src[1];
    } else if (i === segments) {
      // Land exactly on the effect (no rounding drift), on the unwrapped side.
      lon = dst[0];
      lat = dst[1];
    } else {
      const A = Math.sin((1 - t) * delta) / Math.sin(delta);
      const B = Math.sin(t * delta) / Math.sin(delta);
      const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
      const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);
      lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD;
      lon = Math.atan2(y, x) / RAD;
    }
    if (prevLon !== null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    out.push([lon, lat, height * Math.sin(Math.PI * t)]);
  }
  return out;
}

/** Arc colour: the effect's impact; inferred links are lighter, focused ones full strength. */
export function arcColor(arc: GlobeArc & { focus?: boolean }, palette: GlobePalette, dimmed: boolean): Rgba {
  const base = impactColor(arc.impact, palette);
  if (arc.focus) return withAlpha(base, 0.95);
  const a = (arc.link_type === "reported" ? 0.5 : 0.36) * (0.6 + 0.4 * arc.confidence);
  return withAlpha(base, dimmed ? a * 0.3 : a);
}

/** Line width in pixels: confidence 0.3 → 1 px, 1.0 → 2.2 px; focus adds a little. */
export function arcWidth(arc: GlobeArc & { focus?: boolean }): number {
  return 1 + 1.2 * Math.max(0, Math.min(1, (arc.confidence - 0.3) / 0.7)) + (arc.focus ? 0.8 : 0);
}

// ---------------------------------------------------------------------------
// Forecast rings
// ---------------------------------------------------------------------------

/** A big 24-hour move: 5 points or more, in a market that isn't thin. */
export function isBigMover(f: Pick<ForecastSummary, "change_24h" | "thin">): boolean {
  return !f.thin && f.change_24h !== null && Math.abs(f.change_24h) >= 0.05;
}

/** Ring icons come in 5 % steps (0, 5, … 100). */
export function ringStep(probability: number): number {
  return Math.round(Math.min(1, Math.max(0, probability)) * 20) * 5;
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

/**
 * A country's fill: plain land without events; otherwise "active" land,
 * tinted towards risk (amber) or opportunity (teal) by its balance, more so
 * where more is happening. Subtle on purpose: the points carry the detail.
 */
export function countryFill(
  country: GlobeCountry | undefined,
  maxCount: number,
  palette: GlobePalette,
): Rgba {
  if (!country || country.count === 0) return palette.land;
  const activity = maxCount > 0 ? Math.log1p(country.count) / Math.log1p(maxCount) : 0;
  const base = mix(palette.land, palette.landActive, 0.35 + 0.65 * activity);
  const lean = leaningImpact(country.risk, country.opportunity, country.neutral);
  if (lean === "neutral") return base;
  const strength = (0.06 + 0.18 * activity) * Math.min(1, Math.abs(country.score) * 1.6);
  return mix(base, impactColor(lean, palette), strength);
}

/** Per-country counts and balance from a set of events (as api.globe sends them), busiest first. */
export function countryStats(events: readonly GlobeEvent[]): GlobeCountry[] {
  const byId = new Map<string, GlobeCountry>();
  for (const e of events) {
    if (!e.country_id) continue;
    let c = byId.get(e.country_id);
    if (!c) {
      c = { id: e.country_id, count: 0, risk: 0, opportunity: 0, neutral: 0, score: 0 };
      byId.set(e.country_id, c);
    }
    c.count += 1;
    c[e.impact] += 1;
  }
  const out = [...byId.values()];
  for (const c of out) c.score = Math.round(((c.opportunity - c.risk) / c.count) * 1000) / 1000;
  return out.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Replay: the window's events appearing in the order they were first seen
// ---------------------------------------------------------------------------

export interface ReplaySpan {
  from: number;
  to: number;
}

/** Where a replay runs: from just before the first event to now (ms since the epoch). */
export function replaySpan(events: readonly GlobeEvent[], now: number, windowMs: number): ReplaySpan {
  let first = now;
  for (const e of events) {
    const t = Date.parse(e.first_seen);
    if (Number.isFinite(t) && t < first) first = t;
  }
  const from = Math.max(now - windowMs, first - windowMs * 0.02);
  return { from: Math.min(from, now - 60_000), to: now };
}

/**
 * The replay at time `at`: the events seen by then, and those that appeared
 * in the last `trail` milliseconds (drawn with a pulse, as if new).
 */
export function replayFrame(
  events: readonly GlobeEvent[],
  at: number,
  trail: number,
): { shown: GlobeEvent[]; appearing: GlobeEvent[] } {
  const shown: GlobeEvent[] = [];
  const appearing: GlobeEvent[] = [];
  for (const e of events) {
    const t = Date.parse(e.first_seen);
    if (!(t <= at)) continue;
    shown.push(e);
    if (t > at - trail) appearing.push(e);
  }
  return { shown, appearing };
}

// ---------------------------------------------------------------------------
// The list view and cards
// ---------------------------------------------------------------------------

/** Most important first, then newest, then by id (stable). */
export function sortEventsForList(events: readonly GlobeEvent[]): GlobeEvent[] {
  return [...events].sort(
    (a, b) =>
      b.importance - a.importance ||
      Date.parse(b.first_seen) - Date.parse(a.first_seen) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * How to mark sample data in a list: "all" (one badge covers the list, rows
 * drop their own marks), "some" (each sample row keeps its mark) or "none".
 */
export function sampleLabelling(items: readonly { is_sample: boolean }[]): "all" | "some" | "none" {
  const n = items.reduce((sum, item) => sum + (item.is_sample ? 1 : 0), 0);
  if (n === 0) return "none";
  return n === items.length ? "all" : "some";
}

/** What the sector lens shows, in words: "All sectors", "Energy", "3 sectors". */
export function lensSummary(selected: readonly SectorId[]): string {
  if (selected.length === 0) return "All sectors";
  if (selected.length === 1) return SECTORS[selected[0]]?.label ?? selected[0];
  return `${selected.length} sectors`;
}

/** Where arrow keys move focus in a list of `count` rows. */
export function nextRow(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  const to: Record<string, number> = {
    ArrowDown: current + 1,
    ArrowUp: current - 1,
    Home: 0,
    End: count - 1,
    PageDown: current + 10,
    PageUp: current - 10,
  };
  return key in to ? Math.max(0, Math.min(count - 1, to[key])) : null;
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** "region:in" → "India" (falls back to the code). */
export function countryName(countryId: string | null | undefined): string | null {
  if (!countryId) return null;
  const code = /^region:([a-z]{2})$/.exec(countryId)?.[1];
  if (!code) return null;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * A globe event as a story summary, so the UI kit's StoryCard can show it.
 * The globe call doesn't send the analysis fields: the so-what stays null
 * (never invented) and the event icon falls back to the generic one.
 */
export function eventAsStory(event: GlobeEvent, options: { isSample: boolean }): StorySummary {
  const name = countryName(event.country_id);
  return {
    id: event.id,
    kind: "event",
    headline: event.headline,
    so_what: null,
    event_type: "",
    impact: event.impact,
    direction: null,
    magnitude: event.magnitude,
    horizon: null,
    confidence: null,
    importance: event.importance,
    sectors: event.sectors,
    first_seen: event.first_seen,
    region:
      event.country_id && name
        ? { id: event.country_id, name, subtype: "country", country_id: event.country_id }
        : null,
    lon: event.lon,
    lat: event.lat,
    source_count: 0,
    analysed: true,
    is_sample: options.isSample,
  };
}

// ---------------------------------------------------------------------------
// Geometry for the camera and labels
// ---------------------------------------------------------------------------

type Ring = number[][];
type PolygonCoords = Ring[];

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/** The biggest polygon of a Polygon or MultiPolygon (by outer-ring area in degrees²). */
export function largestPolygon(geometry: { type: string; coordinates: unknown }): PolygonCoords | null {
  if (geometry.type === "Polygon") return geometry.coordinates as PolygonCoords;
  if (geometry.type !== "MultiPolygon") return null;
  let best: PolygonCoords | null = null;
  let bestArea = -1;
  for (const poly of geometry.coordinates as PolygonCoords[]) {
    const area = poly[0] ? ringArea(unwrapRing(poly[0] as LngLat[])) : 0;
    if (area > bestArea) {
      best = poly;
      bestArea = area;
    }
  }
  return best;
}

/** [[west, south], [east, north]] of a shape's main polygon; east may exceed 180 across the antimeridian. */
export function mainBounds(geometry: { type: string; coordinates: unknown }): [LngLat, LngLat] | null {
  const poly = largestPolygon(geometry);
  const ring = poly?.[0] ? unwrapRing(poly[0] as LngLat[]) : null;
  if (!ring || ring.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** A point to hang a label on: the area centroid of the main polygon's outer ring. */
export function labelPoint(geometry: { type: string; coordinates: unknown }): LngLat | null {
  const poly = largestPolygon(geometry);
  const ring = poly?.[0] ? unwrapRing(poly[0] as LngLat[]) : null;
  if (!ring || ring.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  let lon = cx / (3 * a);
  const lat = cy / (3 * a);
  if (lon > 180) lon -= 360;
  return [lon, lat];
}

/** Shape area (main polygon, degrees² scaled by latitude), for ranking labels. */
export function shapeSize(geometry: { type: string; coordinates: unknown }): number {
  const poly = largestPolygon(geometry);
  const ring = poly?.[0] ? unwrapRing(poly[0] as LngLat[]) : null;
  if (!ring) return 0;
  const midLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  return ringArea(ring) * Math.cos(midLat * RAD);
}

/** Angle in degrees between two points on the sphere. */
export function angularDistance(a: LngLat, b: LngLat): number {
  return distanceMeters(a, b) / EARTH_RADIUS_M / RAD;
}

/** MapLibre's default vertical field of view, in degrees. */
const FOV_DEG = 36.87;

/** Distance from the camera to the point under it, in CSS pixels (MapLibre's cameraToCenterDistance). */
function cameraDistance(heightPx: number, fovDeg = FOV_DEG): number {
  return (0.5 * Math.max(1, heightPx)) / Math.tan(((fovDeg / 2) * Math.PI) / 180);
}

/** The globe's radius in pixels at this zoom (MapLibre scales it by 1 / cos(latitude) of the centre). */
function globeRadius(zoom: number, centerLat: number): number {
  return (512 * 2 ** zoom) / (2 * Math.PI) / Math.max(0.2, Math.cos(centerLat * RAD));
}

/** How far from the view's centre (in degrees) the camera can see the globe's surface. */
export function visibleCap(zoom: number, centerLat: number, heightPx: number, fovDeg = FOV_DEG): number {
  const radius = globeRadius(zoom, centerLat);
  const ratio = radius / (cameraDistance(heightPx, fovDeg) + radius);
  return (Math.acos(Math.min(1, ratio)) * 180) / Math.PI;
}

/**
 * The radius of the globe's outline on screen, in CSS pixels. Seen in
 * perspective from close by, the outline is a little smaller than the
 * globe's radius: r = c·R / √(c² + 2cR), with c the camera distance.
 */
export function screenRadius(zoom: number, centerLat: number, heightPx: number): number {
  const c = cameraDistance(heightPx);
  const radius = globeRadius(zoom, centerLat);
  return (c * radius) / Math.sqrt(c * c + 2 * c * radius);
}

/** The zoom at which the globe's outline has this radius on screen (the inverse of screenRadius). */
export function zoomForScreenRadius(target: number, centerLat: number, heightPx: number): number {
  const c = cameraDistance(heightPx);
  const r = Math.max(1, target);
  const radius = (r * r + r * Math.sqrt(r * r + c * c)) / c;
  const worldSize = radius * 2 * Math.PI * Math.max(0.2, Math.cos(centerLat * RAD));
  return Math.log2(worldSize / 512);
}

/**
 * The camera that frames `bounds` ([[west, south], [east, north]], east may
 * pass 180) in a free area of `width` × `height` pixels. On the globe a
 * degree of longitude spans worldSize / 360 pixels at the centre, and a
 * degree of latitude 1 / cos(latitude) times that. (MapLibre's own
 * cameraForBounds ignores side padding in globe view, so it can't be used
 * with a side panel open.)
 */
export function cameraForBounds(
  bounds: [LngLat, LngLat],
  width: number,
  height: number,
): { center: LngLat; zoom: number } {
  const [[w, s], [e, n]] = bounds;
  const lat = (s + n) / 2;
  let lon = (w + e) / 2;
  if (lon > 180) lon -= 360;
  const spanLon = Math.max(0.05, e - w);
  const spanLat = Math.max(0.05, n - s);
  const pxPerDegree = Math.min(
    Math.max(40, width) / spanLon,
    (Math.max(40, height) * Math.max(0.2, Math.cos(lat * RAD))) / spanLat,
  );
  return { center: [lon, lat], zoom: Math.log2((pxPerDegree * 360) / 512) };
}

/** Roughly on the visible side of the globe as seen from above `center`. */
export function onNearSide(center: LngLat, point: LngLat, limit = 80): boolean {
  return angularDistance(center, point) < limit;
}

// ---------------------------------------------------------------------------
// Place labels
// ---------------------------------------------------------------------------

export interface LabelCandidate {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Countries: shape size; cities: population. Higher is placed first. */
  priority: number;
  kind: "country" | "city";
  /** Cities: national capitals show from a lower zoom. */
  capital?: boolean;
}

/** Whether a label belongs at this zoom at all (before collisions). */
export function labelShowsAt(label: LabelCandidate, zoom: number): boolean {
  if (label.kind === "country") {
    if (zoom < 1.5) return false;
    // Big countries first; smaller ones appear as you zoom in.
    return label.priority >= 220 / 4 ** (zoom - 1.6);
  }
  if (label.capital) return zoom >= 3.6;
  return zoom >= 4.6 && label.priority >= 4_000_000 / 2 ** (zoom - 4.6);
}

/**
 * Pick the labels to draw: those that belong at this zoom, are on screen and
 * on the near side, placed greedily by priority without overlapping.
 * `project` gives the screen position of a place, or null when it's hidden.
 */
export function declutterLabels<T extends LabelCandidate>(
  candidates: readonly T[],
  project: (lon: number, lat: number) => { x: number; y: number } | null,
  viewport: { width: number; height: number },
  zoom: number,
  max = 70,
): T[] {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: T[] = [];
  const ranked = candidates
    .filter((c) => labelShowsAt(c, zoom))
    .sort(
      (a, b) =>
        Number(b.kind === "country") - Number(a.kind === "country") ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );
  for (const label of ranked) {
    if (out.length >= max) break;
    const p = project(label.lon, label.lat);
    if (!p) continue;
    const width = label.name.length * (label.kind === "country" ? 7 : 6.5) + 10;
    const height = 16;
    const box =
      label.kind === "country"
        ? { x0: p.x - width / 2, y0: p.y - height / 2, x1: p.x + width / 2, y1: p.y + height / 2 }
        : { x0: p.x - 4, y0: p.y - height / 2, x1: p.x + width, y1: p.y + height / 2 };
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > viewport.width || box.y1 > viewport.height) continue;
    if (placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    placed.push(box);
    out.push(label);
  }
  return out;
}

/**
 * The starting zoom: the globe's outline fills most of the free space
 * (`width` × `height`, the part of the map the controls leave), seen on a map
 * `mapHeight` pixels tall centred on `centerLat`. Phones get a fuller globe;
 * there is less else to look at.
 */
export function homeZoom(width: number, height: number, mapHeight: number, centerLat = 20): number {
  const free = Math.max(120, Math.min(width, height));
  const radius = (free * (width < 500 ? 0.94 : 0.84)) / 2;
  const zoom = zoomForScreenRadius(radius, centerLat, mapHeight);
  return Math.min(2.6, Math.max(0.2, zoom));
}
