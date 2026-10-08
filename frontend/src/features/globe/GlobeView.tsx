import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MonitorX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import type { ForecastSummary, StorySummary } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { toCss } from "@/lib/globe-color";
import { countryIdOf, loadAdmin1, loadCountries, loadPlaces, worldviewFor } from "@/lib/geo";
import { useIsDesktop } from "@/lib/hooks";
import { isFresh } from "@/lib/time";
import { cn } from "@/lib/utils";
import { WIDE_PANELS } from "@/app/registry";
import { currentPanel, useNav } from "@/state/nav";
import { sampleArg, useCalm, useIndiaBorders, useSettings } from "@/state/settings";

import { EventList } from "./EventList";
import {
  GLASS,
  LayersButton,
  ListToggle,
  MapKey,
  SectorLens,
  SectorLensButton,
  WindowControl,
  ZoomControls,
} from "./GlobeControls";
import { GlobeMap, type CameraMove, type CameraRequest, type Padding, type PickInfo, type ViewInfo } from "./GlobeMap";
import { useElementSize, useGlobePalette, useMinuteClock, usePageFont } from "./hooks";
import { makeRingAtlas, type LayerInput } from "./layers";
import {
  arcPath,
  binEvents,
  countryFill,
  filterArcs,
  hexResolutionForZoom,
  homeZoom,
  labelPoint,
  mainBounds,
  shapeSize,
  type ArcDatum,
  type GlobeEvent,
  type LabelCandidate,
  type LngLat,
} from "./model";
import { HoverCard, SelectionCard, type PickContext } from "./PickCard";
import { hoveredItem, useGlobeHover, useGlobeUi } from "./store";
import { TopNowCard, TopNowStrip } from "./TopNow";

const HOME_CENTER: LngLat = [25, 20];
const COLUMN = 352; // the desktop left column (22rem)
const STATUS_SPACE = 52; // the app's status pill sits bottom-left
const TOOLBAR_SPACE = 64;
const SIDE_PANEL = 464; // PanelHost's desktop side panel plus its margin

/** A few faint, fixed stars for the dark theme (no motion). */
const STARS = Array.from({ length: 42 }, (_, i) => {
  const x = (i * 73.13 + 11) % 100;
  const y = (i * 41.71 + 7) % 100;
  const size = i % 7 === 0 ? 1.6 : 1;
  return `radial-gradient(${size}px ${size}px at ${x.toFixed(1)}% ${y.toFixed(1)}%, var(--fg-subtle), transparent)`;
}).join(", ");

const EMPTY_EVENTS: GlobeEvent[] = [];
const EMPTY_FORECASTS: ForecastSummary[] = [];

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

  const args = useMemo(
    () => ({ window: timeWindow, sectors, sample: sampleArg(sampleSetting) }),
    [timeWindow, sectors, sampleSetting],
  );
  const globe = useRpc("globe", args, { placeholderData: keepPreviousData });
  const top = useRpc("top", args, { placeholderData: keepPreviousData });
  const meta = useRpc("meta", {});
  const showingSample = meta.data?.data.showing_sample ?? false;
  const allSample = sampleSetting !== "off" && showingSample;
  const mixedSample = sampleSetting === "on" && !showingSample;

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
  const resolution = hexResolutionForZoom(view.zoom);
  const hexes = useMemo(() => binEvents(events, resolution), [events, resolution]);
  const maxHexWeight = useMemo(() => hexes.reduce((m, h) => Math.max(m, h.weight), 0), [hexes]);
  const paths = useMemo(() => new Map((data?.arcs ?? []).map((a) => [a.id, arcPath(a.src, a.dst)])), [data]);
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const countriesById = useMemo(() => new Map((data?.countries ?? []).map((c) => [c.id, c])), [data]);
  const fresh = useMemo(() => events.filter((e) => isFresh(e.first_seen, now)), [events, now]);

  const panelItem = panel && (panel.kind === "story" || panel.kind === "forecast" || panel.kind === "cascade") ? panel.id : null;
  const selectedItem = selected && (selected.kind === "event" || selected.kind === "forecast") ? selected.id : null;
  const focusId = hoverItem ?? itemFocus ?? selectedItem ?? panelItem;
  const focusStory = focusId && eventsById.has(focusId) ? focusId : null;

  const arcs: ArcDatum[] = useMemo(
    () =>
      filterArcs(data?.arcs ?? [], { focusId: focusStory, max: 28, minConfidence: 0.5 }).map((a) => ({
        ...a,
        path: paths.get(a.id) ?? [],
      })),
    [data, paths, focusStory],
  );
  const dimArcs = focusStory !== null && arcs.some((a) => a.focus);

  const countryFills = useMemo(() => {
    const list = data?.countries ?? [];
    const max = list.reduce((m, c) => Math.max(m, c.count), 0);
    return new Map(list.map((c) => [c.id, toCss(countryFill(c, max, palette))]));
  }, [data, palette]);

  const countryLabels = useMemo<LabelCandidate[]>(
    () =>
      (countries.data?.features ?? []).flatMap((f) => {
        const pt = labelPoint(f.geometry);
        if (!pt || !f.properties.id) return [];
        return [{ id: f.properties.id, name: f.properties.name, lon: pt[0], lat: pt[1], priority: shapeSize(f.geometry), kind: "country" as const }];
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
      events,
      fresh,
      arcs,
      forecasts,
      focusId,
      dimArcs,
      fontFamily: font ?? "sans-serif",
      ringAtlas,
      calm,
    }),
    [palette, paletteKey, toggles, view.zoom, hexes, maxHexWeight, events, fresh, arcs, forecasts, focusId, dimArcs, font, ringAtlas, calm],
  );

  // --- Layout: keep the globe centred in the space the controls leave ------
  const sidePanelOpen = isDesktop && panel !== null && !WIDE_PANELS.has(panel.kind);
  const padding: Padding = isDesktop
    ? { top: TOOLBAR_SPACE, left: COLUMN + 24, right: sidePanelOpen ? SIDE_PANEL : 0, bottom: STATUS_SPACE }
    : {
        top: 60,
        left: 0,
        right: 0,
        bottom: panel ? Math.round(size.height * 0.5) : Math.min(size.height * 0.45, stripSize.height + 56),
      };
  const freeW = Math.max(0, size.width - padding.left - padding.right);
  const freeH = Math.max(0, size.height - padding.top - padding.bottom);
  // Re-frame only on real size changes (40 px steps), not on every padding tweak.
  const wStep = Math.round(freeW / 40);
  const hStep = Math.round(freeH / 40);
  const measured = size.width > 0;
  const home = useMemo(
    () => ({ center: HOME_CENTER, zoom: measured ? homeZoom(wStep * 40, hStep * 40) : 1.6 }),
    [wStep, hStep, measured],
  );
  const glowCenter = { x: padding.left + freeW / 2, y: padding.top + freeH / 2 };
  const background: CSSProperties = {
    backgroundColor: "var(--globe-space)",
    backgroundImage: `radial-gradient(circle at ${glowCenter.x}px ${glowCenter.y}px, color-mix(in oklch, var(--globe-atmosphere) 16%, transparent) 0, transparent ${Math.round(Math.min(freeW, freeH) * 0.62)}px)`,
  };

  // --- Opening things -------------------------------------------------------
  const openRegion = useCallback(
    (id: string) => {
      openPanel({ kind: "region", id });
      const feature = countries.data?.features.find((f) => f.properties.id === id);
      const bounds = feature ? mainBounds(feature.geometry) : null;
      if (bounds) fly({ kind: "bounds", bounds, maxZoom: 5 });
    },
    [countries.data, fly, openPanel],
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
          openRegion(info.id);
          break;
        case "state":
          openPanel({ kind: "region", id: info.id });
          break;
      }
    },
    [fly, openPanel, openRegion, view.zoom, setHover],
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
      if (story.lon !== null && story.lat !== null) fly({ kind: "point", center: [story.lon, story.lat], zoom: Math.max(view.zoom, 2.6) });
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
  useEffect(() => {
    if (!focus || focus.nonce === appliedFocus) return;
    let cancelled = false;
    const target = focus;
    const run = async () => {
      if (target.regionId) {
        const id = target.regionId;
        const country = countryIdOf(id);
        if (id === country) {
          if (!countries.data) return; // wait for the shapes
          const f = countries.data.features.find((x) => x.properties.id === id);
          const bounds = f ? mainBounds(f.geometry) : null;
          if (bounds) {
            if (!cancelled) fly({ kind: "bounds", bounds, maxZoom: target.zoom ?? 5 });
            return;
          }
        } else if (country && !id.includes(".")) {
          const shapes = await loadAdmin1(country, worldview).catch(() => null);
          const f = shapes?.features.find((x) => x.properties.id === id);
          const bounds = f ? mainBounds(f.geometry) : null;
          if (bounds) {
            if (!cancelled) fly({ kind: "bounds", bounds, maxZoom: target.zoom ?? 6 });
            return;
          }
        } else {
          const all = await loadPlaces().catch(() => []);
          const place = all.find((p) => p.id === id);
          if (place) {
            if (!cancelled) fly({ kind: "point", center: [place.lon, place.lat], zoom: target.zoom ?? 6 });
            return;
          }
        }
      }
      if (target.lon !== undefined && target.lat !== undefined && !cancelled) {
        fly({ kind: "point", center: [target.lon, target.lat], zoom: target.zoom });
      }
    };
    setAppliedFocus(target.nonce);
    void run();
    return () => {
      cancelled = true;
    };
  }, [focus, appliedFocus, setAppliedFocus, countries.data, worldview, fly]);

  // A phone selection that no longer exists (window or lens changed) goes away.
  const selectionGone =
    selected !== null &&
    ((selected.kind === "event" && !eventsById.has(selected.id)) ||
      (selected.kind === "forecast" && !forecasts.some((f) => f.id === selected.id)));
  const shownSelection = isDesktop || selectionGone ? null : selected;

  const pickContext: PickContext = useMemo(
    () => ({ allSample, eventsById, countriesById }),
    [allSample, eventsById, countriesById],
  );

  const onInteract = useCallback(() => setInteracted(), [setInteracted]);
  const onMapError = useCallback((e: Error) => setMapError(e), []);
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
  const showList = listOpen || mapError !== null;
  const listNote = mapError ? (
    <p className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 p-2.5 text-label text-fg-muted">
      <MonitorX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      This device can't draw the globe, so here is the same news as a list.
    </p>
  ) : undefined;
  const list = (
    <EventList
      events={events}
      window={timeWindow}
      allSample={allSample}
      note={listNote}
      onOpen={openStory}
      onFocusItem={setItemFocus}
      onClose={mapError ? undefined : () => setListOpen(false)}
      empty={globeFailed ? <ErrorState error={globe.error!} onRetry={() => void globe.refetch()} compact /> : undefined}
    />
  );
  const failure = globeFailed ? (
    <div className={cn(GLASS, "rounded-xl")}>
      <ErrorState
        error={globe.error!}
        onRetry={() => {
          void globe.refetch();
          void top.refetch();
        }}
        compact
      />
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden"
      style={background}
      aria-busy={globe.isFetching || undefined}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden opacity-50 dark:block" style={{ backgroundImage: STARS }} />

      {!mapError && (
        <GlobeMap
          layerInput={layerInput}
          labels={labels}
          animate={!calm && (fresh.length > 0 || forecasts.some((f) => !f.thin && Math.abs(f.change_24h ?? 0) >= 0.05))}
          countries={countries.data ?? null}
          states={statesFor ? (states.data ?? null) : null}
          countryFills={countryFills}
          selectedRegionId={panelRegion ?? (selected?.kind === "country" || selected?.kind === "state" ? selected.id : null)}
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
          ariaLabel="Globe of world events. Drag to turn it, scroll or pinch to zoom. The List button shows the same events as text."
        />
      )}

      {isDesktop && !listOpen && (
        <HoverCard
          context={pickContext}
          bounds={{ width: size.width - (sidePanelOpen ? SIDE_PANEL : 0), height: size.height }}
        />
      )}

      <div className="pointer-events-none absolute inset-0">
        {isDesktop ? (
          <>
            <div
              className="pointer-events-auto absolute top-3 left-3 flex items-center gap-2"
              style={{ right: (sidePanelOpen ? SIDE_PANEL : 0) + 12 }}
            >
              <WindowControl value={timeWindow} onChange={setWindow} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <SectorLens selected={sectors} onToggle={toggleSector} onClear={clearSectors} layout="row" />
              </div>
              {!mapError && <LayersButton toggles={toggles} onToggle={setToggle} />}
              {!mapError && <ListToggle open={listOpen} onChange={setListOpen} />}
            </div>

            <div
              className="pointer-events-auto absolute left-3 flex flex-col gap-2"
              style={{ top: TOOLBAR_SPACE, bottom: STATUS_SPACE, width: COLUMN }}
            >
              {showList ? list : failure ?? <TopNowCard {...topProps} />}
            </div>

            {!mapError && (
              <div
                className="pointer-events-auto absolute bottom-3 flex items-end gap-2"
                style={{ right: (sidePanelOpen ? SIDE_PANEL : 0) + 12 }}
              >
                <div className={cn(GLASS, "flex items-center gap-3 rounded-lg px-3 py-2")}>
                  {(allSample || mixedSample) && <SampleBadge compact={mixedSample} />}
                  <MapKey />
                </div>
                <ZoomControls onZoom={(delta) => fly({ kind: "zoom", delta })} onReset={() => fly({ kind: "reset" })} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="pointer-events-auto absolute top-3 right-3 left-3 flex items-center gap-2">
              <WindowControl value={timeWindow} onChange={setWindow} className="min-w-0 flex-1 [&>*]:flex-1" />
              <SectorLensButton selected={sectors} onToggle={toggleSector} onClear={clearSectors} />
              {!mapError && <LayersButton toggles={toggles} onToggle={setToggle} compact />}
              {!mapError && <ListToggle open={listOpen} onChange={setListOpen} compact />}
            </div>

            {showList ? (
              <div className="pointer-events-auto absolute top-[60px] right-3 bottom-12 left-3 flex flex-col">{list}</div>
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
