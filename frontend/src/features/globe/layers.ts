/**
 * The deck.gl layers drawn over the MapLibre globe (interleaved, sharing its
 * WebGL context): hex heat, cascade arcs, forecast rings, event points and
 * place labels. Everything here is built from data that GlobeView memoises,
 * so the layers only change when their inputs do.
 */
import type { Layer, LayerExtension } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import {
  IconLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer,
  type PathLayerProps,
  type TextLayerProps,
} from "@deck.gl/layers";

import type { ForecastSummary } from "@/api/contract";
import { withAlpha, type GlobePalette, type Rgba } from "@/lib/globe-color";

import { HorizonExtension, HorizonFadeExtension } from "./horizon-extension";

import {
  arcColor,
  arcWidth,
  eventRadius,
  hexFill,
  impactColor,
  isBigMover,
  ringStep,
  zoomScale,
  type ArcDatum,
  type GlobeEvent,
  type HexBin,
  type LabelCandidate,
} from "./model";

export interface LayerToggles {
  heat: boolean;
  events: boolean;
  arcs: boolean;
  forecasts: boolean;
}

export const DEFAULT_TOGGLES: LayerToggles = { heat: true, events: true, arcs: true, forecasts: true };

/** A place name on the globe (see declutterLabels). */
export type PlaceLabel = LabelCandidate;

export interface LayerInput {
  palette: GlobePalette;
  paletteKey: string;
  toggles: LayerToggles;
  zoom: number;
  hexes: HexBin[];
  maxHexWeight: number;
  events: GlobeEvent[];
  fresh: GlobeEvent[];
  arcs: ArcDatum[];
  forecasts: ForecastSummary[];
  /** The hovered or selected item, drawn with a ring. */
  focusId: string | null;
  /** Something is in focus: other arcs fade. */
  dimArcs: boolean;
  /** Place names to draw (already decluttered for the current view). */
  labels: PlaceLabel[];
  fontFamily: string;
  ringAtlas: RingAtlas | null;
  /** 0–1, drives the pulse of fresh events and big movers (static when calm). */
  pulse: number;
  calm: boolean;
}

// ---------------------------------------------------------------------------
// Forecast ring icons: one atlas, 21 rings (0–100 % in 5 % steps), drawn white
// and tinted violet by the layer (mask mode) so the theme can change freely.
// ---------------------------------------------------------------------------

export interface RingAtlas {
  canvas: HTMLCanvasElement;
  mapping: Record<string, { x: number; y: number; width: number; height: number; mask: boolean }>;
}

const CELL = 64;

export function makeRingAtlas(): RingAtlas | null {
  try {
    const steps = 21;
    const canvas = document.createElement("canvas");
    canvas.width = CELL * steps;
    canvas.height = CELL;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const mapping: RingAtlas["mapping"] = {};
    const r = CELL / 2 - 7;
    for (let i = 0; i < steps; i++) {
      const cx = i * CELL + CELL / 2;
      const cy = CELL / 2;
      // The faint track, then the probability arc from 12 o'clock, clockwise.
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const p = i / 20;
      if (p > 0) {
        ctx.strokeStyle = "rgba(255,255,255,1)";
        ctx.lineCap = p < 1 ? "round" : "butt";
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke();
      }
      // A small centre dot marks the exact place.
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      mapping[`p${i * 5}`] = { x: i * CELL, y: 0, width: CELL, height: CELL, mask: true };
    }
    return { canvas, mapping };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Layer ids, for picking. */
export const PICKABLE_LAYERS = ["events", "forecasts", "arcs", "hex"] as const;

const dashes = new PathStyleExtension({ dash: true });
const horizon = new HorizonExtension();
const horizonFade = new HorizonFadeExtension();

/** Flat shapes on the sphere: no depth fighting with the globe, back faces culled. */
const SURFACE = { depthCompare: "always", cullMode: "back" } as const;
/**
 * Billboards: never cut by the sphere (the horizon test hides the far side),
 * and no face culling: the globe view culls back faces by default, which
 * drops icon and text quads entirely.
 */
const BILLBOARD: { parameters: { depthCompare: "always"; cullMode: "none" }; extensions: LayerExtension[] } =
  {
    parameters: { depthCompare: "always", cullMode: "none" },
    extensions: [horizon],
  };

export function buildLayers(input: LayerInput): Layer[] {
  const { palette, paletteKey, toggles, zoom } = input;
  const layers: Layer[] = [];
  const pointScale = zoomScale(zoom);

  if (toggles.heat && input.hexes.length > 0) {
    // Fades as you zoom in, where the points tell the story better.
    const fade = Math.max(0.35, Math.min(1, 1.35 - zoom * 0.12));
    layers.push(
      new SolidPolygonLayer<HexBin>({
        id: "hex",
        data: input.hexes,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => hexFill(d, input.maxHexWeight, palette),
        opacity: fade,
        pickable: true,
        parameters: SURFACE,
        updateTriggers: { getFillColor: [paletteKey, input.maxHexWeight] },
      }),
    );
  }

  // Place names sit under the data: marks matter more than the map's own names.
  const labels = input.labels;
  if (labels.length > 0) {
    const cities = labels.filter((l) => l.kind === "city");
    if (cities.length > 0) {
      layers.push(
        new ScatterplotLayer<PlaceLabel>({
          id: "city-dots",
          data: cities,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 2,
          radiusUnits: "pixels",
          getFillColor: withAlpha(palette.label, 0.8),
          billboard: true,
          ...BILLBOARD,
          updateTriggers: { getFillColor: [paletteKey] },
        }),
      );
    }
    layers.push(
      new TextLayer<PlaceLabel>({
        id: "labels",
        data: labels,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name,
        getSize: (d) => (d.kind === "country" ? 12 : 11),
        sizeUnits: "pixels",
        getColor: (d) => withAlpha(palette.label, d.kind === "country" ? 0.78 : 0.9) as Rgba,
        getTextAnchor: (d) => (d.kind === "city" ? "start" : "middle"),
        getAlignmentBaseline: "center",
        getPixelOffset: (d) => (d.kind === "city" ? [6, 0] : [0, 0]),
        fontFamily: input.fontFamily,
        fontWeight: 500,
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        outlineWidth: 3,
        outlineColor: withAlpha(palette.ocean, 0.85),
        characterSet: "auto",
        billboard: true,
        parameters: BILLBOARD.parameters,
        extensions: [horizon],
        updateTriggers: { getColor: [paletteKey], outlineColor: [paletteKey] },
      } as TextLayerProps<PlaceLabel>),
    );
  }

  if (toggles.arcs && input.arcs.length > 0) {
    layers.push(
      new PathLayer<ArcDatum>({
        id: "arcs",
        data: input.arcs,
        getPath: (d) => d.path,
        getColor: (d) => arcColor(d, palette, input.dimArcs),
        getWidth: (d) => arcWidth(d),
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        // Reported links are solid; inferred ones dashed (facts and inferences stay apart).
        getDashArray: (d) => (d.link_type === "reported" ? [0, 0] : [6, 5]),
        dashUnits: "pixels",
        dashJustified: true,
        dashGapPickable: true,
        extensions: [dashes, horizonFade],
        pickable: true,
        updateTriggers: { getColor: [paletteKey, input.dimArcs, input.focusId], getWidth: [input.focusId] },
      } as PathLayerProps<ArcDatum> & PathStyleExtensionProps<ArcDatum>),
    );
  }

  if (toggles.forecasts && input.forecasts.length > 0) {
    const movers = input.forecasts.filter(isBigMover);
    if (movers.length > 0) {
      // A soft violet glow behind rings that moved sharply in 24 hours; it breathes unless calm.
      const breath = input.calm ? 0.5 : input.pulse;
      layers.push(
        new ScatterplotLayer<ForecastSummary>({
          id: "forecast-glow",
          data: movers,
          getPosition: (d) => [d.lon ?? 0, d.lat ?? 0],
          getRadius: 16,
          radiusUnits: "pixels",
          radiusScale: (0.9 + 0.3 * Math.sin(breath * Math.PI)) * pointScale,
          getFillColor: withAlpha(palette.forecast, palette.theme === "dark" ? 0.2 : 0.16),
          opacity: 0.6 + 0.4 * Math.sin(breath * Math.PI),
          stroked: false,
          billboard: true,
          ...BILLBOARD,
          updateTriggers: { getFillColor: [paletteKey] },
        }),
      );
    }
    if (input.ringAtlas) {
      layers.push(
        new IconLayer<ForecastSummary>({
          id: "forecasts",
          data: input.forecasts,
          iconAtlas: input.ringAtlas.canvas as unknown as string,
          iconMapping: input.ringAtlas.mapping,
          getIcon: (d) => `p${ringStep(d.probability)}`,
          getPosition: (d) => [d.lon ?? 0, d.lat ?? 0],
          getSize: (d) => (d.id === input.focusId ? 30 : 24) * pointScale,
          sizeUnits: "pixels",
          getColor: (d) => withAlpha(palette.forecast, d.thin ? 0.55 : 1),
          billboard: true,
          ...BILLBOARD,
          pickable: true,
          updateTriggers: { getColor: [paletteKey], getSize: [input.focusId, pointScale] },
        }),
      );
    } else {
      // No canvas (very old browsers): plain violet rings.
      layers.push(
        new ScatterplotLayer<ForecastSummary>({
          id: "forecasts",
          data: input.forecasts,
          getPosition: (d) => [d.lon ?? 0, d.lat ?? 0],
          getRadius: 9,
          radiusUnits: "pixels",
          stroked: true,
          filled: false,
          getLineColor: withAlpha(palette.forecast, 0.95),
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
          billboard: true,
          ...BILLBOARD,
          pickable: true,
          updateTriggers: { getLineColor: [paletteKey] },
        }),
      );
    }
  }

  if (toggles.events && input.events.length > 0) {
    if (input.fresh.length > 0) {
      // New in the last hour: a ring that pulses outwards (a still ring when calm).
      const t = input.calm ? 0.45 : input.pulse;
      layers.push(
        new ScatterplotLayer<GlobeEvent>({
          id: "fresh",
          data: input.fresh,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => eventRadius(d.importance),
          radiusUnits: "pixels",
          radiusScale: (1.3 + 1.5 * t) * pointScale,
          stroked: true,
          filled: false,
          getLineColor: (d) => impactColor(d.impact, palette),
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          opacity: input.calm ? 0.6 : 0.9 * (1 - t),
          billboard: true,
          ...BILLBOARD,
          updateTriggers: { getLineColor: [paletteKey] },
        }),
      );
    }
    layers.push(
      new ScatterplotLayer<GlobeEvent>({
        id: "events",
        data: input.events,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => eventRadius(d.importance),
        radiusUnits: "pixels",
        radiusScale: pointScale,
        radiusMinPixels: 2.5,
        getFillColor: (d) => withAlpha(impactColor(d.impact, palette), 0.92),
        stroked: true,
        getLineColor: withAlpha(palette.bg, 0.85),
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        billboard: true,
        ...BILLBOARD,
        pickable: true,
        updateTriggers: { getFillColor: [paletteKey], getLineColor: [paletteKey] },
      }),
    );
  }

  const focusEvent = input.focusId ? input.events.find((e) => e.id === input.focusId) : undefined;
  if (focusEvent && toggles.events) {
    layers.push(
      new ScatterplotLayer<GlobeEvent>({
        id: "focus",
        data: [focusEvent],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => eventRadius(d.importance) + 5,
        radiusUnits: "pixels",
        radiusScale: pointScale,
        stroked: true,
        filled: false,
        getLineColor: palette.fg,
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        billboard: true,
        ...BILLBOARD,
        updateTriggers: { getLineColor: [paletteKey] },
      }),
    );
  }

  return layers;
}
