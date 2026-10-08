import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Flame, List, MonitorX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { ForecastSummary, RpcArgs, RpcResponse, StorySummary } from "@/api/contract";
import { useConnection, useRpc } from "@/api/client";
import { snapshotKey, useSnapshot } from "@/api/sources/static";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { Segmented } from "@/components/ui/segmented";
import { toCss } from "@/lib/globe-color";
import { countryIdOf, loadAdmin1, loadCountries, loadPlaces, worldviewFor } from "@/lib/geo";
import { useIsDesktop } from "@/lib/hooks";
import { isFresh, WINDOW_MS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { WIDE_PANELS } from "@/app/registry";
import { TARGET } from "@/platform/runtime";
import { currentPanel, useNav } from "@/state/nav";
import { sampleArg, useCalm, useIndiaBorders, useSettings } from "@/state/settings";

import { EventList, EventListBody } from "./EventList";
import {
  GLASS,
  LayersButton,
  ListToggle,
  MapKey,
  ReplayBar,
  ReplayButton,
  SectorLensBar,
  SectorLensButton,
  WindowControl,
  ZoomControls,
} from "./GlobeControls";
import { GlobeMap, type CameraMove, type CameraRequest, type Padding, type PickInfo, type ViewInfo } from "./GlobeMap";
import { useElementSize, useGlobePalette, useMinuteClock, usePageFont, useReplay } from "./hooks";
import { makeRingAtlas, type LayerInput } from "./layers";
import {
  arcPath,
  binEvents,
  countryFill,
  countryStats,
  filterArcs,
  hexResolutionForZoom,
  homeZoom,
  labelPoint,
  mainBounds,
  replayFrame,
  replaySpan,
  sampleLabelling,
  shapeSize,
  type ArcDatum,
  type GlobeEvent,
  type LabelCandidate,
  type LngLat,
} from "./model";
import { HoverCard, SelectionCard, type PickContext } from "./PickCard";
import { hoveredItem, useGlobeHover, useGlobeUi } from "./store";
import { TopNowBody, TopNowStrip } from "./TopNow";

const HOME_CENTER: LngLat = [25, 20];
const COLUMN = 352; // the desktop left column (22rem)
const STATUS_SPACE = 52; // the app's status pill sits bottom-left
const TOOLBAR_SPACE = 64;
const SIDE_PANEL = 464; // PanelHost's desktop side panel plus its margin
const PHONE_TOP = 60; // the phone's top bar

/** A few faint, fixed stars for the dark theme (no motion). */
const STARS = Array.from({ length: 42 }, (_, i) => {
  const x = (i * 73.13 + 11) % 100;
  const y = (i * 41.71 + 7) % 100;
  const size = i % 7 === 0 ? 1.6 : 1;
  return `radial-gradient(${size}px ${size}px at ${x.toFixed(1)}% ${y.toFixed(1)}%, var(--fg-subtle), transparent)`;
}).join(", ");
const SPACE: CSSProperties = { backgroundColor: "var(--globe-space)" };

const EMPTY_EVENTS: GlobeEvent[] = [];
const EMPTY_FORECASTS: ForecastSummary[] = [];

/**
 * While a new window or lens loads, keep showing the last answer. On the
 * test link, before the connector is live, the bundled snapshot comes first
 * (it is the first frame; see lib/snapshot-plan.ts).
 */
function usePlaceholder<N extends "globe" | "top">(name: N, args: RpcArgs[N]) {
  const snapshot = useSnapshot((s) =>
    TARGET === "artifact" ? (s.data.get(snapshotKey(name, args)) as RpcResponse<N> | undefined) : undefined,
  );
  const live = useConnection((s) => s.state.status === "live");
  return useCallback(
    (previous: RpcResponse<N> | undefined) => (live ? (previous ?? snapshot) : (snapshot ?? previous)),
    [live, snapshot],
  );
}

export default function GlobeView() {
  // --- Navigation, settings and data ---------------------------------------
  const timeWindow = useNav((s) => s.window);
  const sectors = useNav((s) => s.sectors);
  const setWindow = useNav((s) => s.setWindow);
  const toggleSector = useNav((s) => s.toggleSector);
  const clearSectors = useNav((s) => s.clearSectors);
  const openPanel = useNav((s) => s.open);
  const focus = useNav((s) => s.focus);
  const panel = useNav(currentPanel);
  const isDesktop = useIsDesktop();
  const calm = useCalm();
  const sampleSetting = useSettings((s) => s.sample);
  const worldview = worldviewFor(useIndiaBorders());

  // The exact argument shapes of the first frame (lib/snapshot-plan.ts).
  const args = useMemo(
    () => ({ window: timeWindow, sectors, sample: sampleArg(sampleSetting) }),
    [timeWindow, sectors, sampleSetting],
  );
  const globe = useRpc("globe", args, { placeholderData: usePlaceholder("globe", args) });
  const top = useRpc("top", args, { placeholderData: usePlaceholder("top", args) });
  const meta = useRpc("meta", {});

  /** Sample data on the globe: all of it (no live data yet), some (switched on beside live data), or none. */
  const sample: "all" | "some" | null = useMemo(() => {
    if (sampleSetting === "off") return null;
    const showing = meta.data?.data.showing_sample;
    if (showing === undefined && top.data) {
      return sampleLabelling([...top.data.stories, ...top.data.movers]) === "all" ? "all" : null;
    }
    if (showing) return "all";
    return sampleSetting === "on" ? "some" : null;
  }, [sampleSetting, meta.data, top.data]);

  const countries = useQuery({
    queryKey: ["geo", "countries", worldview],
    queryFn: () => loadCountries(worldview),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: false,
  });

  // --- Globe UI state -------------------------------------------------------
  const toggles = useGlobeUi((s) => s.toggles);
  const setToggle = useGlobeUi((s) => s.setToggle);
  const listOpen = useGlobeUi((s) => s.listOpen);
  const setListOpen = useGlobeUi((s) => s.setListOpen);
  const topCollapsed = useGlobeUi((s) => s.topCollapsed);
  const setTopCollapsed = useGlobeUi((s) => s.setTopCollapsed);
  const interacted = useGlobeUi((s) => s.interacted);
  const setInteracted = useGlobeUi((s) => s.setInteracted);
  const appliedFocus = useGlobeUi((s) => s.appliedFocus);
  const setAppliedFocus = useGlobeUi((s) => s.setAppliedFocus);

  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const [stripRef, stripSize] = useElementSize<HTMLDivElement>();
  const [view, setView] = useState<ViewInfo>({ zoom: 1.8, center: HOME_CENTER, centerCountry: null });
  const setHover = useGlobeHover((s) => s.setHover);
  const hoverItem = useGlobeHover(hoveredItem);
  const hovering = useGlobeHover((s) => s.hover !== null);
  const [selected, setSelected] = useState<PickInfo | null>(null);
  const [itemFocus, setItemFocus] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [mapError, setMapError] = useState<Error | null>(null);
  const [ringAtlas] = useState(() => makeRingAtlas());
  const { palette, key: paletteKey } = useGlobePalette();
  const font = usePageFont();
  const now = useMinuteClock();
  const { replay, start: startReplay, stop: stopReplay } = useReplay(calm);

  const fly = useCallback((move: CameraMove) => {
    setCamera({ ...move, nonce: Date.now() + Math.random() });
  }, []);

  // --- States/provinces and cities, loaded when they matter -----------------
  const panelRegion = panel?.kind === "region" ? panel.id : null;
  const statesFor = (panelRegion && countryIdOf(panelRegion)) || (view.zoom >= 3.4 ? view.centerCountry : null);
  const states = useQuery({
    queryKey: ["geo", "admin1", statesFor, worldview],
    queryFn: () => loadAdmin1(statesFor!, worldview),
    enabled: statesFor !== null,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    refetchInterval: false,
    placeholderData: keepPreviousData,
  });
  const places = useQuery({
    queryKey: ["geo", "places"],
    queryFn: loadPlaces,
    enabled: view.zoom >= 3.4,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: false,
  });

  // --- Layer data (memoised: only recomputed when its inputs change) --------
  const data = globe.data;
  const events = data?.events ?? EMPTY_EVENTS;
  const forecasts = data?.forecasts ?? EMPTY_FORECASTS;
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  // Replay: the same events, appearing in the order they were first seen.
  const replayKey = `${timeWindow}|${sectors.join(",")}|${sampleSetting}`;
  const activeReplay = replay && replay.key === replayKey ? replay : null;
  const frame = useMemo(
    () =>
      activeReplay
        ? replayFrame(events, activeReplay.at, (activeReplay.span.to - activeReplay.span.from) * 0.05)
        : null,
    [events, activeReplay],
  );
  const shownEvents = frame ? frame.shown : events;
  const freshNow = useMemo(() => events.filter((e) => isFresh(e.first_seen, now)), [events, now]);
  const fresh = frame ? frame.appearing : freshNow;

  const resolution = hexResolutionForZoom(view.zoom);
  const allHexes = useMemo(() => binEvents(events, resolution), [events, resolution]);
  const hexes = useMemo(() => (frame ? binEvents(frame.shown, resolution) : allHexes), [frame, resolution, allHexes]);
  // Scaled to the whole window, so a replay's heat builds up instead of starting at full strength.
  const maxHexWeight = useMemo(() => allHexes.reduce((m, h) => Math.max(m, h.weight), 0), [allHexes]);
  const paths = useMemo(() => new Map((data?.arcs ?? []).map((a) => [a.id, arcPath(a.src, a.dst)])), [data]);
  const countryList = useMemo(() => (frame ? countryStats(frame.shown) : (data?.countries ?? [])), [frame, data]);
  const countriesById = useMemo(() => new Map((data?.countries ?? []).map((c) => [c.id, c])), [data]);

  const panelItem =
    panel && (panel.kind === "story" || panel.kind === "forecast" || panel.kind === "cascade") ? panel.id : null;
  const selectedItem = selected && (selected.kind === "event" || selected.kind === "forecast") ? selected.id : null;
  const focusId = hoverItem ?? itemFocus ?? selectedItem ?? panelItem;
  const focusStory = focusId && eventsById.has(focusId) ? focusId : null;

  const arcs: ArcDatum[] = useMemo(() => {
    let list = data?.arcs ?? [];
    if (frame) {
      // In a replay, a link shows once its effect (and its cause, when that is in the window) has appeared.
      const shown = new Set(frame.shown.map((e) => e.id));
      list = list.filter((a) => shown.has(a.dst_story) && (!eventsById.has(a.src_story) || shown.has(a.src_story)));
    }
    return filterArcs(list, { focusId: focusStory, max: 28, minConfidence: 0.5 }).map((a) => ({
      ...a,
      path: paths.get(a.id) ?? [],
    }));
  }, [data, frame, eventsById, paths, focusStory]);
  const dimArcs = focusStory !== null && arcs.some((a) => a.focus);

  const countryFills = useMemo(() => {
    const max = (data?.countries ?? []).reduce((m, c) => Math.max(m, c.count), 0);
    return new Map(countryList.map((c) => [c.id, toCss(countryFill(c, max, palette))]));
  }, [data, countryList, palette]);

  const countryLabels = useMemo<LabelCandidate[]>(
    () =>
      (countries.data?.features ?? []).flatMap((f) => {
        const pt = labelPoint(f.geometry);
        if (!pt || !f.properties.id) return [];
        return [
          {
            id: f.properties.id,
            name: f.properties.name,
            lon: pt[0],
            lat: pt[1],
            priority: shapeSize(f.geometry),
            kind: "country" as const,
          },
        ];
      }),
    [countries.data],
  );
  const cityLabels = useMemo<LabelCandidate[]>(
    () =>
      (places.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        lon: p.lon,
        lat: p.lat,
        priority: p.population,
        kind: "city" as const,
        capital: p.capital,
      })),
    [places.data],
  );
  const labels = useMemo(() => (font ? [...countryLabels, ...cityLabels] : []), [font, countryLabels, cityLabels]);

  const layerInput = useMemo<Omit<LayerInput, "pulse" | "labels">>(
    () => ({
      palette,
      paletteKey,
      toggles,
      zoom: view.zoom,
      hexes,
      maxHexWeight,
      events: shownEvents,
      fresh,
      arcs,
      forecasts,
      focusId,
      dimArcs,
      fontFamily: font ?? "sans-serif",
      ringAtlas,
      calm,
    }),
    [
      palette,
      paletteKey,
      toggles,
      view.zoom,
      hexes,
      maxHexWeight,
      shownEvents,
      fresh,
      arcs,
      forecasts,
      focusId,
      dimArcs,
      font,
      ringAtlas,
      calm,
    ],
  );

  // --- Layout: keep the globe centred in the space the controls leave ------
  const sidePanelOpen = isDesktop && panel !== null && !WIDE_PANELS.has(panel.kind);
  const rightSpace = sidePanelOpen ? SIDE_PANEL : 0;
  const padding: Padding = isDesktop
    ? { top: TOOLBAR_SPACE, left: COLUMN + 24, right: rightSpace, bottom: STATUS_SPACE }
    : {
        top: PHONE_TOP,
        left: 0,
        right: 0,
        bottom: panel ? Math.round(size.height * 0.5) : Math.min(size.height * 0.45, stripSize.height + 56),
      };
  const freeW = Math.max(0, size.width - padding.left - padding.right);
  const freeH = Math.max(0, size.height - padding.top - padding.bottom);
  // Re-frame only on real size changes (40 px steps), not on every padding tweak.
  const wStep = Math.round(freeW / 40);
  const hStep = Math.round(freeH / 40);
  const mapHeight = size.height;
  const home = useMemo(
    () => ({ center: HOME_CENTER, zoom: mapHeight > 0 ? homeZoom(wStep * 40, hStep * 40, mapHeight, HOME_CENTER[1]) : 1.6 }),
    [wStep, hStep, mapHeight],
  );

  // --- Opening things -------------------------------------------------------
  const flyToShape = useCallback(
    (geometry: { type: string; coordinates: unknown } | undefined, maxZoom: number) => {
      const bounds = geometry ? mainBounds(geometry) : null;
      if (bounds) fly({ kind: "bounds", bounds, maxZoom });
      return bounds !== null;
    },
    [fly],
  );

  const act = useCallback(
    (info: PickInfo) => {
      setHover(null);
      switch (info.kind) {
        case "event":
          openPanel({ kind: "story", id: info.id });
          break;
        case "forecast":
          openPanel({ kind: "forecast", id: info.id });
          break;
        case "arc":
          openPanel({ kind: "cascade", id: info.arc.dst_story });
          break;
        case "hex":
          fly({ kind: "point", center: [info.hex.lon, info.hex.lat], zoom: Math.min(6, Math.max(view.zoom + 2, 3)) });
          break;
        case "country":
          openPanel({ kind: "region", id: info.id });
          flyToShape(countries.data?.features.find((f) => f.properties.id === info.id)?.geometry, 5);
          break;
        case "state":
          openPanel({ kind: "region", id: info.id });
          flyToShape(states.data?.features.find((f) => f.properties.id === info.id)?.geometry, 6.5);
          break;
      }
    },
    [fly, flyToShape, openPanel, view.zoom, setHover, countries.data, states.data],
  );

  const onPick = useCallback(
    (info: PickInfo | null) => {
      if (isDesktop) {
        if (info) act(info);
        return;
      }
      setSelected(info);
    },
    [act, isDesktop],
  );

  const onHover = useCallback(
    (info: PickInfo | null) => {
      if (window.matchMedia?.("(hover: hover)").matches !== false) setHover(info);
    },
    [setHover],
  );

  const openStory = useCallback(
    (story: Pick<StorySummary, "id" | "lon" | "lat">) => {
      openPanel({ kind: "story", id: story.id });
      if (story.lon !== null && story.lat !== null) {
        fly({ kind: "point", center: [story.lon, story.lat], zoom: Math.max(view.zoom, 2.6) });
      }
    },
    [fly, openPanel, view.zoom],
  );
  const openForecast = useCallback(
    (f: ForecastSummary) => {
      openPanel({ kind: "forecast", id: f.id });
      if (f.lon !== null && f.lat !== null) fly({ kind: "point", center: [f.lon, f.lat], zoom: Math.max(view.zoom, 2.6) });
    },
    [fly, openPanel, view.zoom],
  );

  // Fly-to requests from other screens (useNav.flyTo), each applied once.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!focus || focus.nonce === appliedFocus) return;
    const target = focus;
    const id = target.regionId;
    const country = id ? countryIdOf(id) : null;
    // A country needs its shape first: this runs again when the shapes arrive.
    if (id && id === country && !countries.data) return;
    setAppliedFocus(target.nonce);
    // Only the newest request flies, and only while the globe is on screen.
    const current = () => mounted.current && useNav.getState().focus?.nonce === target.nonce;
    const run = async () => {
      if (id && id === country && countries.data) {
        const f = countries.data.features.find((x) => x.properties.id === id);
        if (flyToShape(f?.geometry, target.zoom ?? 5)) return;
      } else if (id && country && !id.includes(".")) {
        const shapes = await loadAdmin1(country, worldview).catch(() => null);
        const f = shapes?.features.find((x) => x.properties.id === id);
        if (f && current()) {
          flyToShape(f.geometry, target.zoom ?? 6.5);
          return;
        }
      } else if (id) {
        const all = await loadPlaces().catch(() => []);
        const place = all.find((p) => p.id === id);
        if (place && current()) {
          fly({ kind: "point", center: [place.lon, place.lat], zoom: target.zoom ?? 6 });
          return;
        }
      }
      if (target.lon !== undefined && target.lat !== undefined && current()) {
        fly({ kind: "point", center: [target.lon, target.lat], zoom: target.zoom });
      }
    };
    void run();
  }, [focus, appliedFocus, setAppliedFocus, countries.data, worldview, fly, flyToShape]);

  // A phone selection that no longer exists (window or lens changed) goes away.
  const selectionGone =
    selected !== null &&
    ((selected.kind === "event" && !eventsById.has(selected.id)) ||
      (selected.kind === "forecast" && !forecasts.some((f) => f.id === selected.id)));
  const shownSelection = isDesktop || selectionGone ? null : selected;

  const pickContext: PickContext = useMemo(
    () => ({ allSample: sample === "all", eventsById, countriesById }),
    [sample, eventsById, countriesById],
  );

  const onInteract = useCallback(() => setInteracted(), [setInteracted]);
  const onMapError = useCallback(
    (e: Error) => {
      setMapError(e);
      setListOpen(true);
    },
    [setListOpen],
  );
  const toggleReplay = () => {
    if (activeReplay) {
      stopReplay();
      return;
    }
    setSelected(null);
    setHover(null);
    startReplay(replaySpan(events, Date.now(), WINDOW_MS[timeWindow]), replayKey);
  };
  const wider = timeWindow === "30d" ? null : () => setWindow("30d");
  const topProps = {
    data: top.data,
    error: top.error,
    loading: top.isLoading,
    window: timeWindow,
    lensOn: sectors.length > 0,
    onRetry: () => void top.refetch(),
    onWiderWindow: wider,
    onClearLens: clearSectors,
    onOpenStory: openStory,
    onOpenForecast: openForecast,
    onFocusItem: setItemFocus,
  };

  const globeFailed = globe.error && !data;
  const retryAll = () => {
    void globe.refetch();
    void top.refetch();
  };
  const listNote = mapError ? (
    <p className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 p-2.5 text-label text-fg-muted">
      <MonitorX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      This device can't draw the globe, so here is the same news as a list.
    </p>
  ) : undefined;
  const listProps = {
    events,
    window: timeWindow,
    sample,
    note: listNote,
    onOpen: openStory,
    onFocusItem: setItemFocus,
    empty: globeFailed ? <ErrorState error={globe.error!} onRetry={retryAll} compact /> : undefined,
  };
  const failure = globeFailed ? (
    <div className={cn(GLASS, "rounded-xl")}>
      <ErrorState error={globe.error!} onRetry={retryAll} compact />
    </div>
  ) : null;
  const replayBar = activeReplay ? (
    <ReplayBar
      at={activeReplay.at}
      span={activeReplay.span}
      window={timeWindow}
      shown={shownEvents.length}
      onStop={stopReplay}
      className="pointer-events-auto"
    />
  ) : null;
  const replayButton = (
    <ReplayButton
      running={activeReplay !== null}
      window={timeWindow}
      onToggle={toggleReplay}
      disabled={events.length === 0 || mapError !== null}
      className="shrink-0"
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden"
      style={SPACE}
      aria-busy={globe.isFetching || undefined}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden opacity-50 dark:block"
        style={{ backgroundImage: STARS }}
      />

      {!mapError && (
        <GlobeMap
          layerInput={layerInput}
          labels={labels}
          animate={!calm && (fresh.length > 0 || forecasts.some((f) => !f.thin && Math.abs(f.change_24h ?? 0) >= 0.05))}
          countries={countries.data ?? null}
          states={statesFor ? (states.data ?? null) : null}
          countryFills={countryFills}
          selectedRegionId={
            panelRegion ?? (selected?.kind === "country" || selected?.kind === "state" ? selected.id : null)
          }
          padding={padding}
          home={home}
          camera={camera}
          calm={calm}
          autoRotate={!interacted && panel === null && !listOpen && !hovering && selected === null}
          onHover={onHover}
          onPick={onPick}
          onView={setView}
          onInteract={onInteract}
          onError={onMapError}
          ariaLabel="Globe of world events. Drag to turn it, scroll or pinch to zoom. The list shows the same events as text."
        />
      )}

      {isDesktop && !mapError && (
        <HoverCard context={pickContext} bounds={{ width: size.width - rightSpace, height: size.height }} />
      )}

      <div className="pointer-events-none absolute inset-0">
        {isDesktop ? (
          <>
            <div
              className="pointer-events-auto absolute top-3 left-3 flex items-center gap-2"
              style={{ right: rightSpace + 12 }}
            >
              <WindowControl value={timeWindow} onChange={setWindow} className="shrink-0" />
              {replayButton}
              <SectorLensBar selected={sectors} onToggle={toggleSector} onClear={clearSectors} />
            </div>

            {replayBar && (
              <div
                className="absolute flex justify-center"
                style={{ top: TOOLBAR_SPACE, left: COLUMN + 24, right: rightSpace + 12 }}
              >
                {replayBar}
              </div>
            )}

            <div
              className="pointer-events-auto absolute left-3 flex flex-col"
              style={{ top: TOOLBAR_SPACE, bottom: STATUS_SPACE, width: COLUMN }}
            >
              {failure ?? (
                <section
                  aria-label="Top stories and all events"
                  className={cn(GLASS, "flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl")}
                >
                  <div className="shrink-0 p-2 pb-1">
                    <Segmented
                      fill
                      aria-label="Show"
                      value={listOpen ? "list" : "top"}
                      onValueChange={(v) => setListOpen(v === "list")}
                      options={[
                        { value: "top", label: "Top 5 now", icon: Flame },
                        { value: "list", label: "List", icon: List, ariaLabel: "List of all events" },
                      ]}
                    />
                  </div>
                  {listOpen ? <EventListBody {...listProps} /> : <TopNowBody {...topProps} />}
                </section>
              )}
            </div>

            {!mapError && (
              <div
                className="pointer-events-auto absolute bottom-3 flex items-end gap-2"
                style={{ right: rightSpace + 12 }}
              >
                <div className={cn(GLASS, "flex h-10 items-center gap-3 rounded-lg px-3")}>
                  {sample && <SampleBadge compact={sample === "some"} />}
                  <MapKey />
                </div>
                <LayersButton toggles={toggles} onToggle={setToggle} />
                <ZoomControls onZoom={(delta) => fly({ kind: "zoom", delta })} onReset={() => fly({ kind: "reset" })} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="pointer-events-auto absolute top-3 right-3 left-3 flex items-center gap-2">
              <WindowControl value={timeWindow} onChange={setWindow} className="min-w-0 flex-1 [&>*]:flex-1" />
              {!mapError && replayButton}
              <SectorLensButton selected={sectors} onToggle={toggleSector} onClear={clearSectors} />
              {!mapError && <LayersButton toggles={toggles} onToggle={setToggle} compact />}
              {!mapError && <ListToggle open={listOpen} onChange={setListOpen} />}
            </div>

            {replayBar && !listOpen && (
              <div className="absolute right-3 left-3 flex justify-center" style={{ top: PHONE_TOP }}>
                {replayBar}
              </div>
            )}

            {listOpen || mapError ? (
              <div className="pointer-events-auto absolute right-3 bottom-12 left-3 flex flex-col" style={{ top: PHONE_TOP }}>
                <EventList {...listProps} onClose={mapError ? undefined : () => setListOpen(false)} />
              </div>
            ) : (
              <div ref={stripRef} className="pointer-events-auto absolute right-3 bottom-12 left-3">
                {failure ??
                  (shownSelection ? (
                    <SelectionCard
                      info={shownSelection}
                      context={pickContext}
                      onOpen={() => {
                        act(shownSelection);
                        setSelected(null);
                      }}
                      onClose={() => setSelected(null)}
                    />
                  ) : (
                    <TopNowStrip {...topProps} collapsed={topCollapsed} onCollapsedChange={setTopCollapsed} />
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
