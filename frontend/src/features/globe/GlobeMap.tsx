import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { FeatureCollection } from "geojson";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

import type { ForecastSummary } from "@/api/contract";
import { toCss, withAlpha, type GlobePalette } from "@/lib/globe-color";
import type { CountryCollection, StateCollection } from "@/lib/geo";

import { buildLayers, PICKABLE_LAYERS, type LayerInput } from "./layers";
import {
  angularDistance,
  declutterLabels,
  type ArcDatum,
  type GlobeEvent,
  type HexBin,
  type LabelCandidate,
  type LngLat,
  visibleCap,
} from "./model";

// The worker ships with the app (no CDN): inside claude.ai only our own files load.
setWorkerUrl(workerUrl);

/** What the pointer is on. `x`, `y` are pixels from the map's top-left corner. */
export type PickInfo =
  | { kind: "event"; id: string; x: number; y: number; event: GlobeEvent }
  | { kind: "forecast"; id: string; x: number; y: number; forecast: ForecastSummary }
  | { kind: "arc"; id: string; x: number; y: number; arc: ArcDatum }
  | { kind: "hex"; id: string; x: number; y: number; hex: HexBin }
  | { kind: "country" | "state"; id: string; x: number; y: number; name: string };

/** A camera move asked for by the view (fly to a region, the zoom buttons). */
export type CameraMove =
  | { kind: "bounds"; bounds: [LngLat, LngLat]; maxZoom?: number }
  | { kind: "point"; center: LngLat; zoom?: number }
  | { kind: "zoom"; delta: number }
  | { kind: "reset" };

/** A camera move with a nonce, so asking for the same move twice still moves. */
export type CameraRequest = CameraMove & { nonce: number };

export interface ViewInfo {
  zoom: number;
  center: LngLat;
  /** The country under the middle of the view, once zoomed in far enough to tell. */
  centerCountry: string | null;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GlobeMapProps {
  layerInput: Omit<LayerInput, "pulse" | "labels">;
  /** Every place name that could be drawn; the map picks those that fit. */
  labels: readonly LabelCandidate[];
  /** Pulses and glows move (fresh events or big movers present, motion allowed). */
  animate: boolean;
  countries: CountryCollection | null;
  states: StateCollection | null;
  /** Fill colour per country id (rgba strings). */
  countryFills: ReadonlyMap<string, string>;
  selectedRegionId: string | null;
  padding: Padding;
  /** Where "reset view" goes, and where the globe starts. */
  home: { center: LngLat; zoom: number };
  camera: CameraRequest | null;
  calm: boolean;
  /** Turn slowly until the viewer touches the map. */
  autoRotate: boolean;
  onHover: (info: PickInfo | null) => void;
  /** A click or tap; null for empty space. */
  onPick: (info: PickInfo | null) => void;
  onView: (view: ViewInfo) => void;
  onInteract: () => void;
  onError: (error: Error) => void;
  ariaLabel: string;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const FLIGHT_MS = 1600;
const PRIORITY: Record<string, number> = { events: 0, forecasts: 1, arcs: 2, hex: 3 };

function baseStyle(p: GlobePalette): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: skySpec(p),
    sources: {
      countries: { type: "geojson", data: EMPTY, promoteId: "id" },
      states: { type: "geojson", data: EMPTY, promoteId: "id" },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": toCss(p.ocean) } },
      {
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: { "fill-color": countryFillExpr(p), "fill-antialias": true },
      },
      {
        id: "states-fill",
        type: "fill",
        source: "states",
        paint: { "fill-color": toCss(p.fg), "fill-opacity": hoverOpacity(0.08) },
      },
      {
        id: "countries-hover",
        type: "fill",
        source: "countries",
        paint: { "fill-color": toCss(p.fg), "fill-opacity": hoverOpacity(0.07) },
      },
      {
        id: "states-line",
        type: "line",
        source: "states",
        paint: {
          "line-color": toCss(p.border),
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 6, 0.9],
          "line-opacity": 0.8,
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "countries-line",
        type: "line",
        source: "countries",
        paint: {
          "line-color": toCss(p.border),
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.35, 3, 0.7, 6, 1.2],
          "line-opacity": 0.9,
        },
      },
      {
        id: "selected-line",
        type: "line",
        source: "countries",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": toCss(p.fg), "line-width": 1.6, "line-opacity": 0.9 },
      },
      {
        id: "selected-state-line",
        type: "line",
        source: "states",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": toCss(p.fg), "line-width": 1.4, "line-opacity": 0.9 },
      },
    ],
  };
}

const hoverOpacity = (on: number): ExpressionSpecification => [
  "case",
  ["boolean", ["feature-state", "hover"], false],
  on,
  0,
];

const countryFillExpr = (p: GlobePalette): ExpressionSpecification => [
  "to-color",
  ["coalesce", ["feature-state", "fill"], toCss(p.land)],
];

/** A thin token-coloured halo around the planet (the sky shader; the physical atmosphere is off). */
function skySpec(p: GlobePalette): NonNullable<StyleSpecification["sky"]> {
  const halo = toCss(withAlpha(p.atmosphere, p.theme === "dark" ? 0.6 : 0.75));
  return {
    "sky-color": halo,
    "horizon-color": halo,
    "fog-color": toCss(p.space),
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.5,
    "fog-ground-blend": 1,
    "atmosphere-blend": 0,
  };
}

/**
 * The globe: a MapLibre map in globe projection drawn only from our own
 * shapes, with deck.gl layers interleaved in its WebGL context. Created once;
 * later props flow in through refs and small effects, so re-rendering the
 * view never re-creates the map.
 */
export function GlobeMap(props: GlobeMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const propsRef = useRef(props);
  const ready = useRef(false);
  const hovered = useRef<{ source: "countries" | "states"; id: string } | null>(null);
  const interacted = useRef(false);
  /** True while the slow auto-turn moves the camera (not worth reporting every frame). */
  const autoMoving = useRef(false);
  const [placed, setPlaced] = useState<LabelCandidate[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    propsRef.current = props;
  });

  // ---------------------------------------------------------------------------
  // Create the map once; remove it on unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const initial = propsRef.current;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: el,
        style: baseStyle(initial.layerInput.palette),
        center: initial.home.center,
        zoom: initial.home.zoom,
        minZoom: 0.2,
        maxZoom: 9,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        renderWorldCopies: false,
        fadeDuration: 0,
        canvasContextAttributes: { antialias: true },
        locale: { "Map.Title": initial.ariaLabel },
      });
    } catch (error) {
      initial.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    if (import.meta.env.DEV) (window as unknown as { __wgGlobe: unknown }).__wgGlobe = { map, overlay };

    const isVisible = (lon: number, lat: number) => {
      const c = map.getCenter();
      const cap = visibleCap(map.getZoom(), c.lat, el.clientHeight) - 1.5;
      return angularDistance([c.lng, c.lat], [lon, lat]) < cap;
    };

    const pickDeck = (x: number, y: number): PickInfo | null => {
      const picks = overlay.pickMultipleObjects({ x, y, radius: 6, depth: 8, layerIds: [...PICKABLE_LAYERS] });
      const visible = (layer: string, object: unknown, coordinate?: number[]) => {
        if (layer === "events") return isVisible((object as GlobeEvent).lon, (object as GlobeEvent).lat);
        if (layer === "forecasts") {
          const f = object as ForecastSummary;
          return f.lon !== null && f.lat !== null && isVisible(f.lon, f.lat);
        }
        if (layer === "hex") return isVisible((object as HexBin).lon, (object as HexBin).lat);
        return coordinate ? isVisible(coordinate[0], coordinate[1]) : true;
      };
      const top = picks
        .filter((info) => info.object && info.layer && visible(info.layer.id, info.object, info.coordinate))
        .sort((a, b) => (PRIORITY[a.layer!.id] ?? 9) - (PRIORITY[b.layer!.id] ?? 9))[0];
      if (!top) return null;
      const object = top.object as unknown;
      switch (top.layer!.id) {
        case "events":
          return { kind: "event", id: (object as GlobeEvent).id, x, y, event: object as GlobeEvent };
        case "forecasts":
          return { kind: "forecast", id: (object as ForecastSummary).id, x, y, forecast: object as ForecastSummary };
        case "arcs":
          return { kind: "arc", id: String((object as ArcDatum).id), x, y, arc: object as ArcDatum };
        case "hex":
          return { kind: "hex", id: (object as HexBin).h3, x, y, hex: object as HexBin };
        default:
          return null;
      }
    };

    const pick = (x: number, y: number): PickInfo | null => {
      try {
        const hit = pickDeck(x, y);
        if (hit) return hit;
      } catch {
        // deck.gl may still be starting; fall through to the shapes.
      }
      if (!ready.current) return null;
      const features: MapGeoJSONFeature[] = map.queryRenderedFeatures([x, y], {
        layers: ["states-fill", "countries-fill"],
      });
      const state = features.find((f) => f.layer.id === "states-fill" && f.properties?.id);
      if (state) return { kind: "state", id: String(state.properties.id), x, y, name: String(state.properties.name) };
      const country = features.find((f) => f.layer.id === "countries-fill" && f.properties?.id);
      if (country) {
        return { kind: "country", id: String(country.properties.id), x, y, name: String(country.properties.name) };
      }
      return null;
    };

    const setHoverFeature = (info: PickInfo | null) => {
      const next =
        info && (info.kind === "country" || info.kind === "state")
          ? { source: info.kind === "country" ? ("countries" as const) : ("states" as const), id: info.id }
          : null;
      const prev = hovered.current;
      if (prev && (!next || prev.id !== next.id || prev.source !== next.source)) {
        map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false });
      }
      if (next) map.setFeatureState({ source: next.source, id: next.id }, { hover: true });
      hovered.current = next;
    };

    let frame = 0;
    let lastMove: { x: number; y: number } | null = null;
    const onMove = (e: MapMouseEvent) => {
      lastMove = { x: e.point.x, y: e.point.y };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lastMove || map.isMoving()) return;
        const info = pick(lastMove.x, lastMove.y);
        setHoverFeature(info);
        map.getCanvas().style.cursor = info ? "pointer" : "";
        propsRef.current.onHover(info);
      });
    };
    const onOut = () => {
      lastMove = null;
      setHoverFeature(null);
      map.getCanvas().style.cursor = "";
      propsRef.current.onHover(null);
    };
    const onClick = (e: MapMouseEvent) => propsRef.current.onPick(pick(e.point.x, e.point.y));
    const onInteract = () => {
      if (interacted.current) return;
      interacted.current = true;
      propsRef.current.onInteract();
    };

    const relabel = () => {
      const { labels } = propsRef.current;
      const canvas = map.getCanvas();
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      const next = declutterLabels(
        labels,
        (lon, lat) => (isVisible(lon, lat) ? map.project([lon, lat]) : null),
        viewport,
        map.getZoom(),
      );
      setPlaced((prev) =>
        prev.length === next.length && prev.every((l, i) => l.id === next[i].id) ? prev : next,
      );
    };

    const reportView = () => {
      if (autoMoving.current) return;
      const c = map.getCenter();
      const zoom = map.getZoom();
      let centerCountry: string | null = null;
      if (zoom >= 3.4 && ready.current) {
        const pt = map.project(c);
        const hit = map.queryRenderedFeatures([pt.x, pt.y], { layers: ["countries-fill"] })[0];
        centerCountry = hit?.properties?.id ? String(hit.properties.id) : null;
      }
      propsRef.current.onView({ zoom, center: [c.lng, c.lat], centerCountry });
      relabel();
    };

    map.on("load", () => {
      ready.current = true;
      map.addControl(overlay);
      // The first layers may have been built before the overlay was attached.
      overlay.setProps({ layers: buildLayers({ ...propsRef.current.layerInput, labels: [], pulse: 0.5 }) });
      setLoaded(true);
      reportView();
    });
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    map.on("click", onClick);
    map.on("mousedown", onInteract);
    map.on("touchstart", onInteract);
    map.on("wheel", onInteract);
    map.on("moveend", reportView);
    map.on("error", (e) => {
      // Worker or WebGL failures stop the map; a bad shape in a source doesn't.
      const message = String((e.error as { message?: unknown } | undefined)?.message ?? "");
      if (/worker|webgl|context/i.test(message)) propsRef.current.onError(new Error(message));
    });
    relabelRef.current = relabel;

    return () => {
      cancelAnimationFrame(frame);
      relabelRef.current = null;
      try {
        if (ready.current) map.removeControl(overlay);
      } catch {
        // Already gone.
      }
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      ready.current = false;
      hovered.current = null;
      setLoaded(false);
    };
  }, []);

  const relabelRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Keeping the map in step with props (each effect runs once the style is ready)
  // ---------------------------------------------------------------------------
  const { palette, paletteKey } = props.layerInput;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.setPaintProperty("ocean", "background-color", toCss(palette.ocean));
    map.setPaintProperty("countries-fill", "fill-color", countryFillExpr(palette));
    map.setPaintProperty("countries-line", "line-color", toCss(palette.border));
    map.setPaintProperty("states-line", "line-color", toCss(palette.border));
    map.setPaintProperty("countries-hover", "fill-color", toCss(palette.fg));
    map.setPaintProperty("states-fill", "fill-color", toCss(palette.fg));
    map.setPaintProperty("selected-line", "line-color", toCss(palette.fg));
    map.setPaintProperty("selected-state-line", "line-color", toCss(palette.fg));
    map.setSky(skySpec(palette));
    // The palette object changes with its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteKey, loaded]);

  const { countries, states, countryFills, selectedRegionId } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("countries") as GeoJSONSource | undefined)?.setData(countries ?? EMPTY);
  }, [countries, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("states") as GeoJSONSource | undefined)?.setData(states ?? EMPTY);
  }, [states, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !countries) return;
    for (const f of countries.features) {
      const id = f.properties.id;
      if (id) map.setFeatureState({ source: "countries", id }, { fill: countryFills.get(id) ?? null });
    }
  }, [countries, countryFills, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const id = selectedRegionId ?? "";
    map.setFilter("selected-line", ["==", ["get", "id"], id]);
    map.setFilter("selected-state-line", ["==", ["get", "id"], id]);
  }, [selectedRegionId, loaded]);

  // New label candidates (fonts loaded, places arrived): place them for the current view.
  const { labels } = props;
  useEffect(() => {
    if (loaded) relabelRef.current?.();
  }, [labels, loaded]);

  // deck.gl layers, with a light animation loop for pulses (none when calm).
  const { layerInput, animate } = props;
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !loaded) return;
    const draw = (pulse: number) => {
      try {
        overlay.setProps({ layers: buildLayers({ ...layerInput, labels: placed, pulse }) });
      } catch {
        // The overlay may be detaching; the next change draws again.
      }
    };
    if (!animate) {
      draw(0.5);
      return;
    }
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50 || document.hidden) return; // ~20 fps is plenty for a slow pulse
      last = now;
      draw(((now - start) % 2400) / 2400);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layerInput, placed, animate, loaded]);

  // Padding keeps the globe centred in the part of the screen the controls leave free.
  const { padding, calm } = props;
  const padKey = `${padding.top},${padding.right},${padding.bottom},${padding.left}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const [top, right, bottom, left] = padKey.split(",").map(Number);
    map.easeTo({ padding: { top, right, bottom, left }, duration: calm || !loaded ? 0 : 450 });
  }, [padKey, calm, loaded]);

  // Before the viewer moves the globe, keep it framed as the space changes.
  const { home } = props;
  const homeKey = `${home.center.join(",")},${home.zoom.toFixed(2)}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || interacted.current) return;
    const [lon, lat, zoom] = homeKey.split(",").map(Number);
    map.jumpTo({ center: [lon, lat], zoom });
  }, [homeKey]);

  // Camera requests: eased flights, or jumps when motion is reduced.
  const { camera } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;
    const duration = calm ? 0 : FLIGHT_MS;
    const pad = propsRef.current.padding;
    if (camera.kind !== "zoom") interacted.current = true;
    switch (camera.kind) {
      case "bounds":
        map.fitBounds(camera.bounds, {
          padding: { top: pad.top + 32, right: pad.right + 32, bottom: pad.bottom + 32, left: pad.left + 32 },
          maxZoom: camera.maxZoom ?? 5.5,
          duration,
          essential: false,
        });
        break;
      case "point":
        map.flyTo({ center: camera.center, zoom: camera.zoom ?? Math.max(map.getZoom(), 4), duration, essential: false });
        break;
      case "zoom":
        interacted.current = true;
        map.easeTo({ zoom: map.getZoom() + camera.delta, duration: calm ? 0 : 300 });
        break;
      case "reset": {
        const h = propsRef.current.home;
        map.flyTo({ center: h.center, zoom: h.zoom, duration, essential: false });
        break;
      }
    }
  }, [camera, calm]);

  // A slow turn of the globe until the viewer takes over (never when calm).
  const { autoRotate } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !autoRotate || calm || !loaded) return;
    let raf = 0;
    let last = performance.now();
    let lastLabels = last;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(100, now - last);
      last = now;
      if (interacted.current || document.hidden || map.isMoving() || map.getZoom() > 3) return;
      const c = map.getCenter();
      autoMoving.current = true;
      map.setCenter([c.lng + (dt / 1000) * 2, c.lat]);
      autoMoving.current = false;
      // Names that turn into view appear once a second.
      if (now - lastLabels > 1000) {
        lastLabels = now;
        relabelRef.current?.();
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      relabelRef.current?.();
    };
  }, [autoRotate, calm, loaded]);

  // MapLibre's stylesheet makes its container position: relative, so it sits in a sized wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="size-full" data-testid="globe-map" />
    </div>
  );
}
