/**
 * The globe's data shaping, kept free of React and WebGL so it can be tested:
 * the activity shading and glow, size and colour scales, arc filtering, the
 * list order, and the small geometry helpers the camera needs.
 */
import type { ForecastSummary, GlobeResponse, Impact, SectorId, StorySummary } from "@/api/contract";
import { SECTORS } from "@/lib/icons";
import { mix, withAlpha, type GlobePalette, type Rgba } from "@/lib/globe-color";
import { balanceLean, trustVisual } from "@/lib/meaning";

/**
 * An event as api.globe sends it. The optional fields are read when the API
 * sends them:
 * - `analysed`: false marks a draft from the live news pipeline; without it,
 *   an event counts as analysed.
 * - `is_sample`: marks an invented sample story when sample data is shown
 *   beside live news; without it, only the list's header can say so.
 * - `event_type`, `direction` and `region` (the city or state, else the
 *   country): the same icon, ▲ ▼ and place as the story's other cards.
 */
export type GlobeEvent = GlobeResponse["events"][number] & {
  analysed?: boolean;
  is_sample?: boolean;
  event_type?: string;
  direction?: StorySummary["direction"];
  region?: StorySummary["region"];
};
/**
 * A cascade link as api.globe sends it. `strength` (0–1) is read when the API
 * sends it (Phase A2); without it, the line's weight follows confidence.
 */
export type GlobeArc = GlobeResponse["arcs"][number] & { strength?: number | null };
export type GlobeCountry = GlobeResponse["countries"][number];
export type LngLat = [number, number];

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

/** The impact a group of events leans to: more than 15 points of balance either way. */
export function leaningImpact(risk: number, opportunity: number, neutral: number): Impact {
  const n = risk + opportunity + neutral;
  return n === 0 ? "neutral" : balanceLean((opportunity - risk) / n).impact;
}

export function impactColor(impact: Impact, palette: GlobePalette): Rgba {
  return palette[impact] ?? palette.neutral;
}

// ---------------------------------------------------------------------------
// Activity: countries shaded when zoomed out, a soft density glow zoomed in
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (zoom: number, [from, to]: readonly [number, number]) => clamp01((zoom - from) / (to - from));

/**
 * Where each activity layer shows, in MapLibre zoom levels. The country
 * shading carries the overview and fades out as you zoom in; the glow fades
 * in as it goes, then fades out again where the event points spread apart
 * and tell the story themselves. MapLibre (the shading) and the glow's
 * shader (GlowExtension) both work these ramps out on the GPU every frame.
 */
export const ACTIVITY_ZOOM = {
  /** Country shading: full up to the first zoom, gone by the second. */
  countriesOut: [2.9, 4.2],
  /** The glow fades in over this range… */
  glowIn: [2.9, 3.9],
  /** …and out over this one. */
  glowOut: [5.6, 7],
} as const satisfies Record<string, readonly [number, number]>;

/** How strongly each activity layer shows at a zoom (0–1): the same ramps the GPU uses. */
export function activityAt(zoom: number): { countries: number; glow: number } {
  return {
    countries: 1 - ramp(zoom, ACTIVITY_ZOOM.countriesOut),
    glow: ramp(zoom, ACTIVITY_ZOOM.glowIn) * (1 - ramp(zoom, ACTIVITY_ZOOM.glowOut)),
  };
}

/** The country shading's opacity as a MapLibre expression: the `countries` ramp of activityAt. */
export function countryShadeOpacity(): ["interpolate", ["linear"], ["zoom"], number, number, number, number] {
  const [from, to] = ACTIVITY_ZOOM.countriesOut;
  return ["interpolate", ["linear"], ["zoom"], from, 1, to, 0];
}

/** How busy a country is, 0–1: its event count on a log scale against the busiest one. */
export function activityLevel(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  return clamp01(Math.log1p(count) / Math.log1p(Math.max(count, maxCount)));
}

/**
 * The hue for a net score ((opportunity − risk) / events, −1…1): neutral
 * slate when balanced, shading to amber as risk dominates and to teal as
 * opportunity does (fully at ±0.6).
 */
export function balanceColor(score: number, palette: GlobePalette): Rgba {
  const s = Math.max(-1, Math.min(1, Number.isFinite(score) ? score : 0));
  return mix(palette.neutral, s < 0 ? palette.risk : palette.opportunity, Math.min(1, Math.abs(s) / 0.6));
}

/** The shading's alpha for the quietest and the busiest country, per theme. */
const SHADE_ALPHA = { dark: [0.14, 0.46], light: [0.12, 0.4] } as const;

/**
 * A country's activity shading, drawn over plain land and under the borders:
 * its hue from the net score, its strength from how many events it has.
 * Null for a country with nothing in the window (plain land shows).
 */
export function activityFill(
  country: GlobeCountry | undefined,
  maxCount: number,
  palette: GlobePalette,
): Rgba | null {
  if (!country || country.count <= 0) return null;
  const [lo, hi] = SHADE_ALPHA[palette.theme];
  const level = activityLevel(country.count, maxCount);
  return withAlpha(balanceColor(country.score, palette), lo + (hi - lo) * level);
}

/** The glow around an event, in pixels: 40 px for minor items up to 96 px for the most important. */
export function glowRadius(importance: number): number {
  return 40 + 56 * clamp01(importance / 100);
}

/**
 * Each event's contribution to the glow (alpha before the zoom fade):
 * important events weigh more, and overlapping glows build up where news
 * clusters. A little lighter on the light theme, where a darker haze on pale
 * land reads strongly.
 */
export function glowAlpha(importance: number, theme: GlobePalette["theme"]): number {
  const t = clamp01(importance / 100);
  return theme === "light" ? 0.16 + 0.2 * t : 0.2 + 0.24 * t;
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

/**
 * With many events in the window, points shrink (to 60 % at about 1,500) so
 * busy places stay readable and the glow shows through. Zoomed in, the
 * points spread out and grow back to full size.
 */
export function densityScale(count: number, zoom: number): number {
  if (count <= 150) return 1;
  const crowded = Math.max(0.6, (150 / count) ** 0.2);
  const spread = Math.min(1, Math.max(0, (zoom - 2.6) / 3));
  return crowded + (1 - crowded) * spread;
}

// ---------------------------------------------------------------------------
// Arcs (cross-border cascade links)
// ---------------------------------------------------------------------------

export interface ArcDatum extends GlobeArc {
  /** Touches the story or forecast in focus (hovered or open). */
  focus: boolean;
  /** Fades into the background: something else is in focus. */
  dim: boolean;
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

/**
 * Which arcs step back. With a story in focus, every arc that doesn't touch
 * it; otherwise, with a region open, every arc that doesn't start or end in
 * its country (so its own links stand out); otherwise none.
 */
export function markDimmed<T extends GlobeArc & { focus: boolean }>(
  arcs: readonly T[],
  regionCountry: string | null,
): (T & { dim: boolean })[] {
  const storyFocus = arcs.some((a) => a.focus);
  return arcs.map((a) => ({
    ...a,
    dim: storyFocus
      ? !a.focus
      : regionCountry !== null && a.src_country !== regionCountry && a.dst_country !== regionCountry,
  }));
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

/** The shared trust look (lib/meaning.ts trustVisual) of a globe arc. */
export function arcTrust(arc: GlobeArc) {
  return trustVisual({ confidence: arc.confidence, strength: arc.strength, linkType: arc.link_type });
}

/**
 * Arc colour: the effect's impact, as transparent as the link is uncertain
 * (trustVisual's opacity). Links in focus stand out at nearly full strength
 * of that opacity; the rest sit back, and dimmed ones further still.
 */
export function arcColor(arc: GlobeArc & { focus?: boolean }, palette: GlobePalette, dimmed: boolean): Rgba {
  const { opacity } = arcTrust(arc);
  const emphasis = arc.focus ? 0.95 : dimmed ? 0.2 : 0.62;
  return withAlpha(impactColor(arc.impact, palette), opacity * emphasis);
}

/**
 * The line pattern in pixels (dash, gap), as in the cascade view: reported
 * links are solid, inferred ones dashed, projected and conditional ones dotted.
 */
export function arcDash(linkType: GlobeArc["link_type"]): [number, number] {
  switch (linkType) {
    case "reported":
      return [0, 0];
    case "inferred":
      return [6, 5];
    default:
      return [1.5, 5];
  }
}

/**
 * Line width in pixels from the link's strength (its confidence while the
 * API sends no strength), as trustVisual sets it everywhere; focus adds a little.
 */
export function arcWidth(arc: GlobeArc & { focus?: boolean }): number {
  return arcTrust(arc).width + (arc.focus ? 0.8 : 0);
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
 * The globe call doesn't send the so-what (it stays null, never invented).
 * The event icon, ▲ ▼ and place come from the event when the API sends
 * them, else the generic icon, no arrow and the country.
 */
export function eventAsStory(event: GlobeEvent, options: { isSample: boolean }): StorySummary {
  const name = countryName(event.country_id);
  return {
    id: event.id,
    kind: "event",
    headline: event.headline,
    so_what: null,
    event_type: event.event_type ?? "",
    impact: event.impact,
    direction: event.direction ?? null,
    magnitude: event.magnitude,
    horizon: null,
    confidence: null,
    importance: event.importance,
    sectors: event.sectors,
    first_seen: event.first_seen,
    region:
      event.region ??
      (event.country_id && name
        ? { id: event.country_id, name, subtype: "country", country_id: event.country_id }
        : null),
    lon: event.lon,
    lat: event.lat,
    source_count: 0,
    analysed: event.analysed !== false,
    is_sample: options.isSample,
  };
}

/** Sample data on the globe: all of it (no live data yet), some (switched on beside live data), or none. */
export type GlobeSample = "all" | "some" | null;

/**
 * The card for a globe event, with `is_sample` true when it is invented
 * sample data. When another call already sent the full story (the Top 5),
 * that summary is used, so the same story shows the same icon, ▲ ▼ and
 * place everywhere.
 */
export function storyForEvent(
  event: GlobeEvent,
  sample: GlobeSample,
  known?: ReadonlyMap<string, StorySummary>,
): StorySummary {
  const story = known?.get(event.id);
  const isSample =
    sample === "all" || (sample === "some" && (event.is_sample === true || story?.is_sample === true));
  return story ? { ...story, is_sample: isSample } : eventAsStory(event, { isSample });
}

// ---------------------------------------------------------------------------
// Geometry for the camera and labels
// ---------------------------------------------------------------------------

type Ring = number[][];
type PolygonCoords = Ring[];

/** Shift western longitudes east when a ring straddles ±180°, so it reads as one shape. */
export function unwrapRing(ring: LngLat[]): LngLat[] {
  const lons = ring.map((p) => p[0]);
  if (Math.max(...lons) - Math.min(...lons) <= 180) return ring;
  return ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
}

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
  /** Pixels the label moves down, set when it steps aside for a marker. */
  dy?: number;
}

/** A mark on the globe that place names keep clear of: where it is and its radius in pixels. */
export interface MarkerObstacle {
  lon: number;
  lat: number;
  radius: number;
}

/**
 * The marks place names must not cover: the forecast rings (a ring with a
 * name through it reads as neither). Event dots stay coverable: busy
 * countries such as India would otherwise lose their names entirely. The
 * size follows layers.ts.
 */
export function markerObstacles(input: {
  forecasts: readonly Pick<ForecastSummary, "lon" | "lat">[];
  toggles: { forecasts: boolean };
  zoom: number;
}): MarkerObstacle[] {
  if (!input.toggles.forecasts) return [];
  const radius = 12 * zoomScale(input.zoom);
  return input.forecasts.flatMap((f) => (f.lon !== null && f.lat !== null ? [{ lon: f.lon, lat: f.lat, radius }] : []));
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

type ScreenBox = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Pick the labels to draw: those that belong at this zoom, are on screen and
 * on the near side, placed greedily by priority without overlapping each
 * other or the `obstacles` (forecast rings, big event dots). A country name
 * that would sit on a marker steps down below it (`dy`), or is left out
 * when there is no room there either; a city name is left out.
 * `project` gives the screen position of a place, or null when it's hidden.
 */
export function declutterLabels<T extends LabelCandidate>(
  candidates: readonly T[],
  project: (lon: number, lat: number) => { x: number; y: number } | null,
  viewport: { width: number; height: number },
  zoom: number,
  { max = 70, obstacles = [] }: { max?: number; obstacles?: readonly MarkerObstacle[] } = {},
): T[] {
  const marks: ScreenBox[] = [];
  for (const o of obstacles) {
    const p = project(o.lon, o.lat);
    const r = o.radius + 2;
    if (p) marks.push({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
  }
  const onScreen = (b: ScreenBox) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= viewport.width && b.y1 <= viewport.height;
  const placed: ScreenBox[] = [];
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
    if (!onScreen(box)) continue;
    if (placed.some((b) => overlaps(b, box))) continue;
    const hits = marks.filter((m) => overlaps(m, box));
    if (hits.length === 0) {
      placed.push(box);
      out.push(label);
      continue;
    }
    if (label.kind !== "country") continue;
    // Step down to just below the marker(s) it would cover.
    const dy = Math.max(...hits.map((m) => m.y1)) - box.y0 + 1;
    const moved = { ...box, y0: box.y0 + dy, y1: box.y1 + dy };
    if (!onScreen(moved) || placed.some((b) => overlaps(b, moved)) || marks.some((m) => overlaps(m, moved))) continue;
    placed.push(moved);
    out.push({ ...label, dy: Math.round(dy) });
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
