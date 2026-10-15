/**
 * Geometry for the opportunity radar: a polar chart where each wedge is a
 * sector, distance from the centre shows one score (closer = stronger) and
 * the dot's size shows the other. Pure functions, in a unit coordinate
 * system: the outer ring has radius 1, angles start at the top (12 o'clock)
 * and run clockwise, x grows to the right and y downwards (as in SVG).
 */
import type { SectorId } from "@/api/contract";

/** Which score sets the distance from the centre; the other sets the dot size. */
export type RadarMeasure = "relevance" | "momentum";

/** The centre disc (labelled) and the usable band for dots. */
export const R_INNER = 0.17;
export const R_OUTER = 0.93;
/** Smallest and largest dot radius. */
export const DOT_MIN = 0.022;
export const DOT_MAX = 0.052;
/** Space kept between neighbouring dots. */
export const DOT_GAP = 0.01;
/** How far a dot may move in or out to make room (its value stays in the label). */
export const RADIAL_SLACK = 0.045;
/** Guide rings, as scores (they're drawn at the matching distance). */
export const RING_VALUES = [0.75, 0.5, 0.25] as const;

const TAU = Math.PI * 2;

export interface Point {
  x: number;
  y: number;
}

/** A point at `radius` from the centre, `angle` radians clockwise from the top. */
export function polar(angle: number, radius: number): Point {
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** Back from x, y to an angle in [0, 2π) and a radius. */
export function toPolar({ x, y }: Point): { angle: number; radius: number } {
  const radius = Math.hypot(x, y);
  let angle = Math.atan2(x, -y);
  if (angle < 0) angle += TAU;
  return { angle, radius };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Distance from the centre for a 0..1 score: 1 sits next to the centre, 0 on the rim. */
export function radiusFor(score: number): number {
  return R_INNER + (1 - clamp01(score)) * (R_OUTER - R_INNER);
}

/** Dot radius for a 0..1 score. */
export function dotSizeFor(score: number): number {
  return DOT_MIN + clamp01(score) * (DOT_MAX - DOT_MIN);
}

export interface Wedge {
  sector: SectorId;
  index: number;
  /** Angles in radians, clockwise from the top. */
  start: number;
  end: number;
  mid: number;
}

/** Equal wedges for these sectors, in order, the first starting at the top. */
export function wedgesFor(sectors: readonly SectorId[]): Wedge[] {
  const n = sectors.length;
  if (n === 0) return [];
  const width = TAU / n;
  return sectors.map((sector, index) => ({
    sector,
    index,
    start: index * width,
    end: (index + 1) * width,
    mid: (index + 0.5) * width,
  }));
}

/** An SVG path for a wedge (a pie slice between two radii). */
export function wedgePath(wedge: Pick<Wedge, "start" | "end">, inner: number, outer: number): string {
  const full = wedge.end - wedge.start >= TAU - 1e-9;
  const f = (n: number) => Number(n.toFixed(4));
  if (full) {
    // A ring: two half arcs each way.
    const top = polar(0, outer);
    const bottom = polar(Math.PI, outer);
    const itop = polar(0, inner);
    const ibottom = polar(Math.PI, inner);
    return [
      `M ${f(top.x)} ${f(top.y)}`,
      `A ${f(outer)} ${f(outer)} 0 1 1 ${f(bottom.x)} ${f(bottom.y)}`,
      `A ${f(outer)} ${f(outer)} 0 1 1 ${f(top.x)} ${f(top.y)}`,
      `M ${f(itop.x)} ${f(itop.y)}`,
      `A ${f(inner)} ${f(inner)} 0 1 0 ${f(ibottom.x)} ${f(ibottom.y)}`,
      `A ${f(inner)} ${f(inner)} 0 1 0 ${f(itop.x)} ${f(itop.y)}`,
      "Z",
    ].join(" ");
  }
  const large = wedge.end - wedge.start > Math.PI ? 1 : 0;
  const a = polar(wedge.start, outer);
  const b = polar(wedge.end, outer);
  const c = polar(wedge.end, inner);
  const d = polar(wedge.start, inner);
  return [
    `M ${f(a.x)} ${f(a.y)}`,
    `A ${f(outer)} ${f(outer)} 0 ${large} 1 ${f(b.x)} ${f(b.y)}`,
    `L ${f(c.x)} ${f(c.y)}`,
    `A ${f(inner)} ${f(inner)} 0 ${large} 0 ${f(d.x)} ${f(d.y)}`,
    "Z",
  ].join(" ");
}

/**
 * Where a sector's label sits: just outside the rim at the wedge's middle,
 * as a percentage of a square box whose edge is `extent` × 2 wide (the
 * chart's own box, centred on the radar).
 */
export function labelPosition(mid: number, extent: number, at = 1.1): { left: number; top: number } {
  const p = polar(mid, at);
  return { left: ((p.x + extent) / (2 * extent)) * 100, top: ((p.y + extent) / (2 * extent)) * 100 };
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------

export interface RadarInput {
  id: string;
  /** The wedge it belongs in (must be one of the radar's sectors). */
  sector: SectorId;
  relevance: number;
  momentum: number;
}

export interface RadarDot {
  id: string;
  sector: SectorId;
  /** Position in the list order (0 = first). */
  order: number;
  x: number;
  y: number;
  /** Dot radius. */
  r: number;
  /** The score that sets the distance, and the one that sets the size. */
  distanceScore: number;
  sizeScore: number;
}

/** Low-discrepancy slots in 0..1 (golden ratio), so neighbours in distance sit apart in angle. */
function slot(k: number): number {
  const v = 0.5 + k * 0.6180339887;
  return v - Math.floor(v);
}

interface Body {
  dot: RadarDot;
  ideal: number;
  wedge: Wedge;
}

/** The angle a dot of radius r needs from each wedge edge at distance `radius`. */
function edgePad(r: number, radius: number, width: number): number {
  const need = Math.asin(Math.min(1, (r + DOT_GAP / 2) / Math.max(radius, 1e-6)));
  return Math.min(need, width / 2);
}

function place(body: Body, angle: number, radius: number) {
  const { wedge, dot } = body;
  const lo = Math.max(R_INNER + dot.r, body.ideal - RADIAL_SLACK);
  const hi = Math.min(R_OUTER + 0.04, body.ideal + RADIAL_SLACK);
  const rad = Math.min(hi, Math.max(lo, radius));
  const pad = edgePad(dot.r, rad, wedge.end - wedge.start);
  const full = wedge.end - wedge.start >= TAU - 1e-9;
  let a = angle;
  if (!full) {
    // Keep it in its wedge (angles near 0/2π are compared within the wedge).
    if (a < wedge.start - Math.PI) a += TAU;
    if (a > wedge.end + Math.PI) a -= TAU;
    a = Math.min(wedge.end - pad, Math.max(wedge.start + pad, a));
  }
  const p = polar(a, rad);
  dot.x = p.x;
  dot.y = p.y;
}

/**
 * Lay out the dots: each in its sector's wedge, at the distance its score
 * asks for, spread across the wedge and then nudged apart until no two
 * overlap (or as close to that as the space allows). Deterministic: the same
 * input always gives the same picture.
 */
export function layoutRadar(
  items: readonly RadarInput[],
  sectors: readonly SectorId[],
  measure: RadarMeasure,
  iterations = 120,
): RadarDot[] {
  const wedges = new Map(wedgesFor(sectors).map((w) => [w.sector, w]));
  const bodies: Body[] = [];
  items.forEach((item, order) => {
    const wedge = wedges.get(item.sector);
    if (!wedge) return;
    const distanceScore = clamp01(measure === "relevance" ? item.relevance : item.momentum);
    const sizeScore = clamp01(measure === "relevance" ? item.momentum : item.relevance);
    bodies.push({
      dot: { id: item.id, sector: item.sector, order, x: 0, y: 0, r: dotSizeFor(sizeScore), distanceScore, sizeScore },
      ideal: radiusFor(distanceScore),
      wedge,
    });
  });

  // First guess: spread each wedge's dots across it, nearest the centre first.
  const byWedge = new Map<SectorId, Body[]>();
  for (const b of bodies) byWedge.set(b.wedge.sector, [...(byWedge.get(b.wedge.sector) ?? []), b]);
  for (const list of byWedge.values()) {
    list
      .slice()
      .sort((a, b) => a.ideal - b.ideal || a.dot.order - b.dot.order)
      .forEach((b, k) => {
        const width = b.wedge.end - b.wedge.start;
        const pad = Math.min(width * 0.12, width / 2);
        place(b, b.wedge.start + pad + slot(k) * (width - 2 * pad), b.ideal);
      });
  }

  // Then push overlapping dots apart.
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i].dot;
        const b = bodies[j].dot;
        const min = a.r + b.r + DOT_GAP;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-9) {
          // Same spot: separate along the tangent, in a fixed direction.
          const t = toPolar(a);
          dx = Math.cos(t.angle);
          dy = Math.sin(t.angle);
          d = 1;
        }
        const push = (min - Math.min(d, min)) / 2 + 1e-4;
        const ux = dx / d;
        const uy = dy / d;
        const pa = toPolar({ x: a.x - ux * push, y: a.y - uy * push });
        const pb = toPolar({ x: b.x + ux * push, y: b.y + uy * push });
        place(bodies[i], pa.angle, pa.radius);
        place(bodies[j], pb.angle, pb.radius);
        moved = true;
      }
    }
    // Drift back towards the ideal distance, so the radius keeps its meaning.
    for (const body of bodies) {
      const p = toPolar(body.dot);
      place(body, p.angle, p.radius + (body.ideal - p.radius) * 0.15);
    }
    if (!moved && it > 2) break;
  }
  return bodies.map((b) => b.dot).sort((a, b) => a.order - b.order);
}

/** Pairs of dots that still overlap (for tests and a dev sanity check). */
export function overlaps(dots: readonly RadarDot[], tolerance = 0): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i];
      const b = dots[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - tolerance) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Which wedge an angle falls in (for tests and hit checks). */
export function wedgeAt(angle: number, wedges: readonly Wedge[]): Wedge | null {
  const a = ((angle % TAU) + TAU) % TAU;
  return wedges.find((w) => a >= w.start - 1e-9 && a < w.end + 1e-9) ?? null;
}
