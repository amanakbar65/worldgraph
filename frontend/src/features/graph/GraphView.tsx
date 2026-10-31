import { List, Maximize2, Network, SearchX, Shapes, SlidersHorizontal, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EntityType, GraphData, RpcArgs, TimeWindow } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/lib/hooks";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { currentPanel, useNav } from "@/state/nav";
import { sampleArg, useCalm, useSettings } from "@/state/settings";

import { GraphCanvas, type GraphCanvasHandle, type Insets } from "./GraphCanvas";
import {
  activeFilterCount,
  buildGraphArgs,
  buildLocalArgs,
  describeGraph,
  filterGraph,
  GRAPH_TYPES,
  LIMIT_OPTIONS,
  orderTypes,
  placeCard,
  revealTimes,
  shapeGraph,
  typeCount,
  type GraphWindow,
  type VizGraph,
  type VizLink,
  type VizNode,
} from "./graph-data";
import { GraphFilters } from "./GraphFilters";
import { useGraphState, type GraphMode } from "./graph-state";
import { LinkHoverCard, NodeHoverCard } from "./GraphHoverCard";
import { GraphLegend } from "./GraphLegend";
import { GraphList } from "./GraphList";
import { GraphSearch, type SearchPick } from "./GraphSearch";
import { GraphTimelapseBar } from "./GraphTimelapseBar";
import { useLinkActions } from "./link-actions";
import type { SchemaEdge } from "./schema-data";
import { SchemaView } from "./SchemaView";
import { useGraphFeatures, useRelationIndex } from "./use-graph-schema";
import { useElementSize, useGraphTheme } from "./use-graph-theme";
import { useGraphNav } from "./use-graph-nav";
import { useTimelapse } from "./use-timelapse";

const WINDOW_OPTIONS: { value: GraphWindow; label: string; ariaLabel: string }[] = [
  ...(["24h", "7d", "30d"] as const).map((w) => ({ value: w, label: WINDOW_LABELS[w].short, ariaLabel: WINDOW_LABELS[w].long })),
  { value: "all", label: "All", ariaLabel: "All time" },
];

const DEPTH_OPTIONS = ([1, 2, 3] as const).map((d) => ({
  value: String(d) as "1" | "2" | "3",
  label: String(d),
  ariaLabel: d === 1 ? "Direct links only" : `Up to ${d} steps away`,
}));

/** Side panel width on desktop plus its margins, so the camera can keep nodes clear of it. */
const PANEL_INSET = 452;
/** Room for the app's status pill at the bottom left on desktop (on phones it sits in the header). */
const STATUS_SPACE = 52;
const PHONE_STATUS_SPACE = 12;
/** On desktop the replay control starts right of the status pill. */
const DESKTOP_BAR_LEFT = 340;

/** Said wherever a view may be empty because of the shared minimum confidence. */
const LOWER_CONFIDENCE_HINT = "Lower the confidence filter to see weaker links.";

/** Where each node sat, so returning to the graph (or new data) doesn't reshuffle it. */
const POSITIONS = new Map<string, { x: number; y: number }>();

/**
 * The knowledge graph: everything in the news and what it touches, as a
 * force-directed network. Filter it, find a node, hover to light up a
 * neighbourhood, tap to open, replay how it grew, or read it as a list.
 */
export default function GraphView() {
  const scope = useGraphState((s) => s.scope);
  const filters = useGraphState((s) => s.filters);
  const pinned = useGraphState((s) => s.pinned);
  const chosenMode = useGraphState((s) => s.mode);
  const selectedLinkId = useGraphState((s) => s.selectedLink);
  const navWindow = useNav((s) => s.window);
  const sectors = useNav((s) => s.sectors);
  const minConfidence = useNav((s) => s.minConfidence);
  const features = useGraphFeatures();
  const relations = useRelationIndex(features.relations);
  // The schema view needs kg.schema_map; without it, the drawing.
  const mode: GraphMode = chosenMode === "schema" && !features.schemaMap ? "graph" : chosenMode;
  const listView = mode === "list";
  const schemaView = mode === "schema";
  const top = useNav(currentPanel);
  const sample = useSettings((s) => s.sample);
  const isDesktop = useIsDesktop();
  const calm = useCalm();
  const nav = useGraphNav();
  const theme = useGraphTheme();
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [toolbarRef, toolbar] = useElementSize<HTMLDivElement>();
  const canvas = useRef<GraphCanvasHandle>(null);

  const local = scope.kind === "local";
  const focusId = scope.kind === "local" ? scope.id : null;
  const noTypes = filters.types.length === 0;

  // Data ------------------------------------------------------------------------
  const globalArgs = useMemo(
    () => buildGraphArgs(filters, { window: navWindow, sectors, minConfidence }, sampleArg(sample), features),
    [filters, navWindow, sectors, minConfidence, sample, features],
  );
  const globalQuery = useRpc("graph", globalArgs, {
    enabled: !local && !noTypes,
    placeholderData: (previous) => previous,
    refetchInterval: 300_000,
  });
  const localArgs: RpcArgs["local_graph"] = buildLocalArgs(
    { id: scope.kind === "local" ? scope.id : "", depth: scope.kind === "local" ? scope.depth : 1 },
    filters,
    features,
  );
  const localQuery = useRpc("local_graph", localArgs, {
    enabled: local,
    placeholderData: (previous) => (previous && previous.focus === focusId ? previous : undefined),
    refetchInterval: 300_000,
  });
  const query = local ? localQuery : globalQuery;

  const raw = useMemo<GraphData | undefined>(() => {
    if (!local) return noTypes ? { nodes: [], links: [] } : globalQuery.data;
    if (!localQuery.data) return undefined;
    return filterGraph(localQuery.data, { types: filters.types, minConfidence, keep: focusId });
  }, [local, noTypes, globalQuery.data, localQuery.data, filters.types, minConfidence, focusId]);

  const graph = useMemo<VizGraph | null>(() => {
    if (!raw) return null;
    const shaped = shapeGraph(raw, { focusId });
    for (const node of shaped.nodes) {
      const at = POSITIONS.get(node.id);
      if (at) Object.assign(node, at);
    }
    return shaped;
  }, [raw, focusId]);

  const truncated = local ? (localQuery.data?.truncated ?? false) : (globalQuery.data?.truncated ?? false);
  // Around one node the confidence filter runs here, so the view can say how many links it hid.
  const weakHidden = useMemo(
    () =>
      local && localQuery.data
        ? localQuery.data.links.filter((l) => l.causal && (l.confidence ?? 0) < minConfidence - 1e-9).length
        : 0,
    [local, localQuery.data, minConfidence],
  );
  // When only cause-and-effect links are asked for, the confidence filter may be why nothing shows.
  const confidenceMayHide =
    minConfidence > 0 && (weakHidden > 0 || (features.relations && filters.relations.includes("drives")));
  const times = useMemo(() => (raw ? revealTimes(raw.nodes, raw.links) : null), [raw]);
  const timelapse = useTimelapse(times, calm);

  // Interaction -------------------------------------------------------------------
  const selectedId = top && "id" in top ? top.id : null;
  const rightInset = isDesktop && top && top.kind !== "cascade" && top.kind !== "compare" ? PANEL_INSET : 0;
  const [hover, setHover] = useState<{ node: VizNode; at: { left: number; top: number } } | null>(null);
  const [linkHover, setLinkHover] = useState<{ link: VizLink; at: { left: number; top: number } } | null>(null);
  // The chosen link (tapped, or picked in the list) and where its card sits.
  const [linkAt, setLinkAt] = useState<{ id: string; at: { left: number; top: number } } | null>(null);
  const selectedLink = selectedLinkId ? (graph?.links.find((l) => l.id === selectedLinkId) ?? null) : null;
  const pinnedId = pinned && graph?.byId.has(pinned.id) ? pinned.id : null;
  const litId = hover?.node.id ?? pinnedId;

  // What covers the canvas: the toolbar, the bottom controls (or the bottom
  // sheet on phones) and the side panel. Fitting and centring keep clear.
  const sheetOpen = !isDesktop && top !== null;
  const insets = useMemo<Insets>(
    () => ({
      top: toolbar.height ? toolbar.height + 20 : 0,
      right: rightInset,
      bottom: sheetOpen ? Math.round(size.height * 0.5) : isDesktop ? 56 : PHONE_STATUS_SPACE + 48,
      left: 0,
    }),
    [toolbar.height, rightInset, sheetOpen, size.height, isDesktop],
  );

  // Re-centre for a new pin or new data, not when a panel opens or closes.
  useEffect(() => {
    if (!pinned || !graph || !graph.byId.has(pinned.id)) return;
    canvas.current?.centerOn(pinned.id, { zoom: 2.2 });
  }, [pinned, graph]);

  const onNodeHover = useCallback(
    (node: VizNode | null) => {
      if (!node) return setHover(null);
      const p = canvas.current?.screenOf(node.id);
      setHover(p ? { node, at: placeCard(p, size, 120) } : null);
    },
    [size],
  );
  /** Where a link's card goes: by the link's middle, inside the canvas. */
  const cardAt = useCallback(
    (link: VizLink, height: number) => {
      if (typeof link.source !== "object" || typeof link.target !== "object") return null;
      const a = canvas.current?.screenOf(link.source.id);
      const b = canvas.current?.screenOf(link.target.id);
      return a && b ? placeCard({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, size, height) : null;
    },
    [size],
  );
  const onLinkHover = useCallback(
    (link: VizLink | null) => {
      // Without named relations only cause-and-effect links have a card.
      if (!link || (!link.linkType && !features.relations)) return setLinkHover(null);
      const at = cardAt(link, 130);
      setLinkHover(at ? { link, at } : null);
    },
    [cardAt, features.relations],
  );
  /**
   * Choose a link (a tap in the drawing, or its relation in the list): its
   * card stays open with the relation, polarity and confidence, and
   * "Why is this here?" (`linkActions`).
   */
  const selectLink = useCallback(
    (link: VizLink | null) => {
      setLinkHover(null);
      setHover(null);
      useGraphState.getState().selectLink(link?.id ?? null);
      const at = link && mode === "graph" ? cardAt(link, 170) : null;
      setLinkAt(link && at ? { id: link.id, at } : null);
    },
    [cardAt, mode],
  );
  const onSettled = useCallback(() => {
    if (!graph) return;
    for (const n of graph.nodes) if (n.x !== undefined && n.y !== undefined) POSITIONS.set(n.id, { x: n.x, y: n.y });
  }, [graph]);

  const focusNode = (node: VizNode) => useGraphState.getState().pin(node.id);
  // Schema map taps: a kind lists its things (the table lens after B3); a relation shows in the graph.
  const openSchemaType = (type: EntityType) => {
    const state = useGraphState.getState();
    state.setScope({ kind: "global" });
    state.setTypes([type]);
    state.setMode("list");
  };
  const openSchemaRelation = (edge: SchemaEdge) => {
    const state = useGraphState.getState();
    state.setScope({ kind: "global" });
    state.setRelations([edge.relation]);
    state.setTypes(orderTypes([...state.filters.types, edge.src, edge.dst]));
    state.setMode("graph");
  };
  // Under a chosen link's card: "Why is this here?" (kg.provenance) for its edge or causal link.
  const linkActions = useLinkActions(selectedLink, graph, relations);
  const linkCardAt = selectedLink && linkAt?.id === selectedLink.id ? linkAt.at : null;
  const showAround = (pick: SearchPick) => useGraphState.getState().showAround({ id: pick.id, name: pick.name }, 1);

  // Layout --------------------------------------------------------------------------
  const loading = query.isPending && !raw;
  const failed = query.isError && !query.data;
  const empty = !!graph && graph.nodes.length === 0;
  const shown = timelapse.visible ? timelapse.visible.size : (graph?.nodes.length ?? 0);
  const description = graph ? describeGraph(graph, typeCount) : "";

  return (
    <div className="relative h-full overflow-hidden bg-bg-sunken">
      <h1 className="sr-only">Knowledge graph</h1>

      {/* The drawing (or the list) fills the screen; controls float over it. */}
      <div ref={boxRef} className="absolute inset-0">
        {graph && mode === "graph" && !empty && (
          <div
            role="img"
            aria-label={`Knowledge graph${local && scope.kind === "local" ? ` around ${scope.name}` : ""}: ${description}. Use Find in graph or the list view to explore it with a keyboard.`}
            className="absolute inset-0"
            onMouseLeave={() => {
              setHover(null);
              setLinkHover(null);
            }}
          >
            <GraphCanvas
              handleRef={canvas}
              graph={graph}
              width={size.width}
              height={size.height}
              variant="full"
              palette={theme.palette}
              font={theme.font}
              calm={calm}
              visible={timelapse.visible}
              growth={timelapse.growth}
              selectedId={selectedId}
              litId={litId}
              onNodeClick={(node) => {
                setHover(null);
                if (selectedLinkId) selectLink(null);
                nav.openNode(node);
              }}
              onNodeHover={onNodeHover}
              onLinkHover={onLinkHover}
              onLinkClick={features.relations ? (link) => selectLink(link) : undefined}
              linksInteractive={features.relations}
              selectedLinkId={selectedLink?.id ?? null}
              onBackgroundClick={() => {
                useGraphState.getState().pin(null);
                if (selectedLinkId) selectLink(null);
              }}
              onSettled={onSettled}
              insets={insets}
              className="absolute inset-0"
            />
            {hover && <NodeHoverCard node={hover.node} at={hover.at} />}
            {!hover && linkHover && linkHover.link.id !== selectedLink?.id && (
              <LinkHoverCard link={linkHover.link} at={linkHover.at} index={relations} byId={graph.byId} />
            )}
          </div>
        )}
      </div>

      {loading && !schemaView && <GraphSkeleton />}
      {failed && !schemaView && (
        <CenterCard>
          <ErrorState error={query.error!} onRetry={() => void query.refetch()} />
        </CenterCard>
      )}
      {!loading && !failed && !schemaView && (noTypes || empty) && (
        <CenterCard>
          <NothingToShow noTypes={noTypes} local={local} confidenceHint={confidenceMayHide} />
        </CenterCard>
      )}

      {/* Toolbar */}
      <div
        ref={toolbarRef}
        className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-24px)] flex-col items-start gap-2"
        style={rightInset ? { maxWidth: `calc(100% - ${rightInset + 24}px)` } : undefined}
      >
        <div className="relative z-10 flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-line bg-glass p-1.5 shadow-panel backdrop-blur-xl sm:w-auto">
          <GraphSearch graph={graph} onFocus={focusNode} onShowAround={showAround} className="min-w-0 flex-1 sm:w-64 sm:flex-none" />
          <FiltersButton local={local} />
          <ViewToggle schema={features.schemaMap} />
          {scope.kind === "local" ? <ScopeBar name={scope.name} depth={scope.depth} /> : <WindowSwitch />}
        </div>
        {graph && !empty && !schemaView && (
          <Summary
            graph={graph}
            truncated={truncated}
            weakHidden={weakHidden}
            updating={query.isFetching && query.isPlaceholderData}
          />
        )}
      </div>

      {/* After the toolbar, so Tab reaches the list the way the eye does (the toolbar stays on top, z-20). */}
      {graph && listView && !empty && (
        <div
          className="absolute inset-0 overflow-y-auto px-3 pt-36 pb-16 sm:pt-32"
          style={{ paddingTop: toolbar.height ? toolbar.height + 24 : undefined, paddingRight: rightInset || undefined }}
        >
          <GraphList
            graph={graph}
            onOpen={nav.openNode}
            relations={relations}
            onSelectLink={features.relations ? (link) => selectLink(link.id === selectedLinkId ? null : link) : undefined}
            selectedLinkId={selectedLinkId}
            className="mx-auto max-w-3xl"
          />
        </div>
      )}

      {/* The chosen link's card: by the link in the drawing, docked at the bottom in the list. */}
      {schemaView && (
        <SchemaView
          insetTop={toolbar.height ? toolbar.height + 16 : 72}
          insetRight={rightInset}
          onOpenType={openSchemaType}
          onOpenRelation={openSchemaRelation}
        />
      )}

      {graph && !empty && selectedLink && (mode === "list" || (mode === "graph" && linkCardAt)) && (
        <LinkHoverCard
          link={selectedLink}
          at={mode === "list" || !linkCardAt ? "docked" : linkCardAt}
          index={relations}
          byId={graph.byId}
          selected
          onClose={() => selectLink(null)}
          actions={linkActions}
        />
      )}

      {/* Bottom controls, clear of the app's status pill (bottom left). */}
      {graph && !empty && mode === "graph" && isDesktop && (
        <>
          <GraphLegend
            key="desktop"
            types={graph.types}
            linkTypes={graph.linkTypes}
            minConfidence={minConfidence}
            relations={features.relations}
            defaultOpen
            className="absolute left-3 z-10 w-72"
            style={{ bottom: STATUS_SPACE }}
          />
          <div
            className="pointer-events-none absolute bottom-3 z-10 flex justify-center"
            style={{ left: DESKTOP_BAR_LEFT, right: 64 + rightInset }}
          >
            <GraphTimelapseBar
              timelapse={timelapse}
              shown={shown}
              total={graph.nodes.length}
              calm={calm}
              className={cn("pointer-events-auto", timelapse.active && "w-full max-w-[560px]")}
            />
          </div>
          <ZoomControls
            onZoomIn={() => canvas.current?.zoomBy(1.5)}
            onZoomOut={() => canvas.current?.zoomBy(1 / 1.5)}
            onFit={() => canvas.current?.fit()}
            className="bottom-3 flex-col"
            style={{ right: 12 + rightInset }}
          />
        </>
      )}
      {graph && !empty && mode === "graph" && !isDesktop && (
        <div className="pointer-events-none absolute inset-x-3 z-10 flex items-end gap-2" style={{ bottom: PHONE_STATUS_SPACE }}>
          {timelapse.active ? (
            <GraphTimelapseBar
              timelapse={timelapse}
              shown={shown}
              total={graph.nodes.length}
              calm={calm}
              className="pointer-events-auto w-full"
            />
          ) : (
            <>
              <GraphLegend
                key="phone"
                types={graph.types}
                linkTypes={graph.linkTypes}
                minConfidence={minConfidence}
                relations={features.relations}
                defaultOpen={false}
                className="pointer-events-auto max-w-[calc(100%-180px)] min-w-0"
              />
              <GraphTimelapseBar
                timelapse={timelapse}
                shown={shown}
                total={graph.nodes.length}
                calm={calm}
                compact
                className="pointer-events-auto"
              />
              <ZoomControls
                onZoomIn={() => canvas.current?.zoomBy(1.5)}
                onZoomOut={() => canvas.current?.zoomBy(1 / 1.5)}
                onFit={() => canvas.current?.fit()}
                className="pointer-events-auto relative ml-auto flex-row"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar parts
// ---------------------------------------------------------------------------

function WindowSwitch() {
  const navWindow = useNav((s) => s.window);
  const setWindow = useNav((s) => s.setWindow);
  const allTime = useGraphState((s) => s.filters.allTime);
  const setAllTime = useGraphState((s) => s.setAllTime);
  return (
    <Segmented<GraphWindow>
      aria-label="Time window"
      value={allTime ? "all" : navWindow}
      onValueChange={(value) => {
        if (value === "all") setAllTime(true);
        else {
          setAllTime(false);
          setWindow(value as TimeWindow);
        }
      }}
      options={WINDOW_OPTIONS}
    />
  );
}

function ScopeBar({ name, depth }: { name: string; depth: 1 | 2 | 3 }) {
  const setScope = useGraphState((s) => s.setScope);
  const setDepth = useGraphState((s) => s.setDepth);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="flex h-10 min-w-0 items-center gap-1 rounded-lg border border-line-strong bg-surface-2 pr-1 pl-3 text-body text-fg">
        <span className="shrink-0 text-fg-muted">Around</span>
        <span className="max-w-40 truncate font-medium">{name}</span>
        <button
          type="button"
          onClick={() => setScope({ kind: "global" })}
          aria-label="Back to the whole graph"
          title="Back to the whole graph"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg"
        >
          <X aria-hidden className="size-4" />
        </button>
      </span>
      <Segmented<"1" | "2" | "3">
        aria-label="How many steps away"
        value={String(depth) as "1" | "2" | "3"}
        onValueChange={(v) => setDepth(Number(v) as 1 | 2 | 3)}
        options={DEPTH_OPTIONS}
      />
    </div>
  );
}

function ViewToggle({ schema }: { schema: boolean }) {
  const mode = useGraphState((s) => s.mode);
  const setMode = useGraphState((s) => s.setMode);
  const options: { value: GraphMode; label: React.ReactNode; icon: typeof Network; ariaLabel: string }[] = [
    { value: "graph", label: <span className="sr-only sm:not-sr-only">Graph</span>, icon: Network, ariaLabel: "Graph" },
    { value: "list", label: <span className="sr-only sm:not-sr-only">List</span>, icon: List, ariaLabel: "List" },
  ];
  if (schema) {
    options.push({ value: "schema", label: <span className="sr-only sm:not-sr-only">Schema</span>, icon: Shapes, ariaLabel: "Schema" });
  }
  return (
    <Segmented<GraphMode>
      aria-label="Show as"
      value={schema || mode !== "schema" ? mode : "graph"}
      onValueChange={setMode}
      options={options}
    />
  );
}

function FiltersButton({ local }: { local: boolean }) {
  const filters = useGraphState((s) => s.filters);
  const sectors = useNav((s) => s.sectors);
  const minConfidence = useNav((s) => s.minConfidence);
  const phone = !useIsDesktop();
  const count = activeFilterCount(filters, phone, { minConfidence, local }) + (local ? 0 : sectors.length);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="border-line px-3" aria-label={count ? `Filters, ${count} on` : "Filters"}>
          <SlidersHorizontal aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          {count > 0 && (
            <span aria-hidden className="rounded-full bg-fg px-1.5 text-label text-bg tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(75vh,640px)] w-[min(380px,calc(100vw-24px))] overflow-y-auto p-4">
        <GraphFilters local={local} />
      </PopoverContent>
    </Popover>
  );
}

function Summary({
  graph,
  truncated,
  weakHidden,
  updating,
}: {
  graph: VizGraph;
  truncated: boolean;
  /** Cause-and-effect links under the shared minimum confidence (around one node). */
  weakHidden: number;
  updating: boolean;
}) {
  const filters = useGraphState((s) => s.filters);
  const setLimit = useGraphState((s) => s.setLimit);
  // Phones don't invite more: a bigger graph doesn't read on a small screen (Filters still offers it).
  const next = useIsDesktop() ? LIMIT_OPTIONS.find((n) => n > filters.limit) : undefined;
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-glass px-2.5 py-1 text-label text-fg-muted shadow-panel backdrop-blur-xl">
      <span className="tabular-nums">
        {graph.nodes.length} items · {graph.links.length} links
      </span>
      {graph.hasSample && <SampleBadge />}
      {weakHidden > 0 && (
        <span className="tabular-nums">
          {weakHidden} weaker {weakHidden === 1 ? "link" : "links"} hidden
        </span>
      )}
      {truncated && (
        <span className="inline-flex items-center gap-1">
          Most connected first
          {next && (
            <button
              type="button"
              onClick={() => setLimit(next)}
              className="relative cursor-pointer rounded px-1 font-medium text-fg underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 hover:underline"
            >
              Show up to {next}
            </button>
          )}
        </span>
      )}
      <span role="status" aria-live="polite">
        {updating ? "Updating…" : ""}
      </span>
    </div>
  );
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  className,
  style,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Placement and direction (`flex-col` or `flex-row`). */
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="group"
      aria-label="Zoom"
      className={cn(
        "absolute z-10 flex overflow-hidden rounded-xl border border-line bg-glass shadow-panel backdrop-blur-xl",
        className,
      )}
      style={style}
    >
      <Button variant="ghost" size="icon" onClick={onZoomIn} aria-label="Zoom in" className="rounded-none">
        <ZoomIn aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomOut}
        aria-label="Zoom out"
        className="rounded-none border-line [.flex-col>&]:border-y [.flex-row>&]:border-x"
      >
        <ZoomOut aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" onClick={onFit} aria-label="Fit the graph to the screen" className="rounded-none">
        <Maximize2 aria-hidden />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 pt-32">
      <div className="w-full max-w-sm rounded-xl border border-line bg-glass shadow-panel backdrop-blur-xl">{children}</div>
    </div>
  );
}

function NothingToShow({ noTypes, local, confidenceHint }: { noTypes: boolean; local: boolean; confidenceHint: boolean }) {
  const setTypes = useGraphState((s) => s.setTypes);
  const resetFilters = useGraphState((s) => s.resetFilters);
  const setAllTime = useGraphState((s) => s.setAllTime);
  const allTime = useGraphState((s) => s.filters.allTime);
  const clearSectors = useNav((s) => s.clearSectors);
  if (noTypes) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="Pick something to show"
        description="Every kind of item is switched off."
        action={{ label: "Show the usual kinds", onClick: () => resetFilters() }}
        secondaryAction={{ label: "Show everything", onClick: () => setTypes([...GRAPH_TYPES]) }}
      />
    );
  }
  return (
    <EmptyState
      icon={SearchX}
      title="Nothing matches these filters"
      description={`${local ? "Try more steps away or fewer filters." : "Try a longer time window or fewer filters."}${
        confidenceHint ? ` ${LOWER_CONFIDENCE_HINT}` : ""
      }`}
      action={
        !local && !allTime
          ? { label: "Show all time", onClick: () => setAllTime(true) }
          : {
              label: "Reset filters",
              onClick: () => {
                resetFilters();
                clearSectors();
              },
            }
      }
      secondaryAction={
        !local && !allTime
          ? {
              label: "Reset filters",
              onClick: () => {
                resetFilters();
                clearSectors();
              },
            }
          : undefined
      }
    />
  );
}

/** Loading: a few quiet circles where the network will be. */
function GraphSkeleton() {
  const dots = [
    [50, 48, 64],
    [34, 36, 40],
    [64, 32, 34],
    [70, 60, 44],
    [38, 64, 36],
    [24, 52, 24],
    [80, 44, 22],
    [56, 72, 26],
    [44, 24, 20],
  ];
  return (
    <div role="status" className="absolute inset-0" aria-busy="true" aria-label="Loading the graph">
      {dots.map(([x, y, s], i) => (
        <Skeleton
          key={i}
          className="absolute rounded-full"
          style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, transform: "translate(-50%, -50%)" }}
        />
      ))}
    </div>
  );
}
