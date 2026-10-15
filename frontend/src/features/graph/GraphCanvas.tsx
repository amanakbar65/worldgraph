import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type MutableRefObject, type Ref } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";

import { LINK_TYPES } from "@/lib/meaning";

import { paletteColor, rgba, type Palette } from "./graph-colors";
import { endId, focusSet, labelBudget, type VizGraph, type VizLink, type VizNode } from "./graph-data";
import { drawSprite, useSprites } from "./icon-sprites";

type FgNode = NodeObject<VizNode>;
type FgLink = LinkObject<VizNode, VizLink>;
type FgMethods = ForceGraphMethods<FgNode, FgLink>;

/** What a parent can ask of the canvas. */
export interface GraphCanvasHandle {
  /** Centre on a node in the free part of the canvas (and zoom in a little). */
  centerOn: (id: string, options?: { zoom?: number }) => boolean;
  zoomBy: (factor: number) => void;
  fit: () => void;
  /** Where a node is on screen, in px from the canvas's top left. */
  screenOf: (id: string) => { x: number; y: number } | null;
}

export interface GraphCanvasProps {
  graph: VizGraph;
  width: number;
  height: number;
  /** `full`: the graph screen. `mini`: a small, still preview inside a panel. */
  variant: "full" | "mini";
  palette: Palette;
  font: string;
  /** Reduced motion: settle the layout before showing it and never animate the camera. */
  calm: boolean;
  /** Time-lapse: only these ids are drawn (null draws everything). */
  visible?: ReadonlySet<string> | null;
  /** Time-lapse grow-in: ms since each node appeared (absent = fully grown). */
  growth?: ((id: string) => number) | null;
  /** The node whose panel is open: drawn with a focus ring. */
  selectedId?: string | null;
  /** The node under the pointer, or pinned by search: its neighbourhood stays lit. */
  litId?: string | null;
  onNodeClick: (node: VizNode) => void;
  onNodeHover?: (node: VizNode | null) => void;
  onLinkHover?: (link: VizLink | null) => void;
  onBackgroundClick?: () => void;
  /** The user zoomed or panned (to stop automatic fitting). */
  onUserMove?: () => void;
  /** The layout settled (first time for this graph). */
  onSettled?: () => void;
  /** Parts of the canvas covered by toolbars or panels, in px: fitting and centring keep clear of them. */
  insets?: Insets;
  handleRef?: Ref<GraphCanvasHandle>;
  className?: string;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const GROW_MS = 700;
const LABEL_PX = 12;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 10;

/**
 * The force-directed knowledge graph on a canvas. Entities are icon badges
 * in their type colour sized by connections, stories small dots in their
 * impact colour, forecasts violet rings. Cause-and-effect links point from
 * cause to effect and are drawn solid (reported), dashed (inferred) or
 * dotted (projected, conditional); other links stay faint. Labels go to
 * the most connected nodes first and never overlap.
 */
export function GraphCanvas({
  graph,
  width,
  height,
  variant,
  palette,
  font,
  calm,
  visible = null,
  growth = null,
  selectedId = null,
  litId = null,
  onNodeClick,
  onNodeHover,
  onLinkHover,
  onBackgroundClick,
  onUserMove,
  onSettled,
  insets,
  handleRef,
  className,
}: GraphCanvasProps) {
  const fg = useRef<FgMethods | undefined>(undefined);
  const { sprites, host } = useSprites();
  const mini = variant === "mini";
  const settled = useRef(false);
  const tickedOnce = useRef(false);
  const userMoved = useRef(false);
  const pendingCenter = useRef<{ id: string; zoom?: number } | null>(null);

  // The latest insets and visible set, for camera moves started by timers and the engine.
  const live = useRef({ insets: insets ?? NO_INSETS, visible, width, height });
  useEffect(() => {
    live.current = { insets: insets ?? NO_INSETS, visible, width, height };
  }, [insets, visible, width, height]);

  const data = useMemo(() => ({ nodes: graph.nodes as FgNode[], links: graph.links as FgLink[] }), [graph]);
  const lit = useMemo(() => focusSet(graph, litId), [graph, litId]);
  /** Nodes by label priority (computed once per graph, not per frame). */
  const ranked = useMemo(() => [...graph.nodes].sort((a, b) => a.rank - b.rank), [graph]);

  // A new graph lays itself out and fits again.
  useEffect(() => {
    settled.current = false;
    tickedOnce.current = false;
    userMoved.current = false;
  }, [graph]);

  const markMoved = useCallback(() => {
    userMoved.current = true;
    onUserMove?.();
  }, [onUserMove]);

  // Forces are set as soon as the graph exists, before it lays out its first
  // data: a little more room than the defaults, tighter for cause and
  // effect, and a gentle pull to the middle so loose clusters stay near.
  const attach = useCallback(
    (instance: FgMethods | null) => {
      fg.current = instance ?? undefined;
      if (!instance) return;
      const charge = instance.d3Force("charge");
      charge?.strength?.(mini ? -60 : -42);
      charge?.distanceMax?.(mini ? 200 : 320);
      const link = instance.d3Force("link");
      link?.distance?.((l: VizLink) => (l.linkType ? 34 : l.type === "mentions" ? 26 : 30));
      instance.d3Force("gravity", gravity(mini ? 0.06 : 0.05));
    },
    [mini],
  );

  /** Frame the drawn nodes inside the free part of the canvas (clear of toolbars and panels). */
  const fitView = useCallback(
    (ms: number) => {
      const instance = fg.current;
      const { insets: ins, visible: shown, width: w, height: h } = live.current;
      if (!instance || w <= 0 || h <= 0) return;
      const box = graphBox(graph.nodes, shown);
      if (!box) return;
      const pad = mini ? 10 : 24;
      const labelRoom = 18; // the lowest node's label
      const freeW = Math.max(60, w - ins.left - ins.right - pad * 2);
      const freeH = Math.max(60, h - ins.top - ins.bottom - pad * 2 - labelRoom);
      const k = Math.min(
        mini ? 3 : 4,
        Math.max(MIN_ZOOM, Math.min(freeW / Math.max(1, box.x1 - box.x0), freeH / Math.max(1, box.y1 - box.y0))),
      );
      const sx = ins.left + pad + freeW / 2 - w / 2;
      const sy = ins.top + pad + freeH / 2 - h / 2;
      instance.centerAt((box.x0 + box.x1) / 2 - sx / k, (box.y0 + box.y1) / 2 - sy / k, ms);
      instance.zoom(k, ms);
    },
    [graph, mini],
  );

  const centerNow = useCallback(
    (node: VizNode, options: { zoom?: number } = {}) => {
      const instance = fg.current;
      if (!instance || node.x === undefined || node.y === undefined) return false;
      const { insets: ins } = live.current;
      const k = Math.max(instance.zoom(), options.zoom ?? 0);
      const ms = calm ? 0 : 600;
      // The middle of the free area, not of the canvas.
      const sx = (ins.left - ins.right) / 2;
      const sy = (ins.top - ins.bottom) / 2;
      instance.centerAt(node.x - sx / k, node.y - sy / k, ms);
      if (options.zoom && instance.zoom() < options.zoom) instance.zoom(options.zoom, ms);
      return true;
    },
    [calm],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      centerOn: (id, options) => {
        const node = graph.byId.get(id);
        if (!node) return false;
        if (!settled.current || !centerNow(node, options)) pendingCenter.current = { id, ...options };
        return true;
      },
      zoomBy: (factor) => {
        const instance = fg.current;
        if (instance) instance.zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, instance.zoom() * factor)), calm ? 0 : 250);
      },
      fit: () => fitView(calm ? 0 : 400),
      screenOf: (id) => {
        const node = graph.byId.get(id);
        const instance = fg.current;
        if (!node || !instance || node.x === undefined || node.y === undefined) return null;
        return instance.graph2ScreenCoords(node.x, node.y);
      },
    }),
    [graph, calm, centerNow, fitView],
  );

  const handleTick = useCallback(() => {
    if (tickedOnce.current) return;
    tickedOnce.current = true;
    // Frame the drawing straight away; it is refined when the layout settles.
    if (!userMoved.current) fitView(0);
  }, [fitView]);

  const handleStop = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    const pending = pendingCenter.current;
    pendingCenter.current = null;
    const node = pending ? graph.byId.get(pending.id) : undefined;
    const centred = node ? centerNow(node, pending ?? {}) : false;
    // Frame the settled drawing, unless the viewer has already moved it.
    if (!centred && !userMoved.current) fitView(calm ? 0 : 500);
    onSettled?.();
  }, [graph, calm, centerNow, fitView, onSettled]);

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  const color = useCallback((cssVar: string, alpha = 1) => rgba(paletteColor(palette, cssVar), alpha), [palette]);

  const drawNode = useCallback(
    (raw: FgNode, ctx: CanvasRenderingContext2D, k: number) => {
      const node = raw as VizNode;
      if (node.x === undefined || node.y === undefined) return;
      const dim = lit !== null && !lit.has(node.id);
      const age = growth ? growth(node.id) : Infinity;
      const grow = calm || age >= GROW_MS ? 1 : 0.35 + 0.65 * Math.max(0, age / GROW_MS);
      const r = node.r * grow;
      const screenR = r * k;
      const alpha = dim ? 0.16 : 1;
      const { x, y } = node;
      ctx.save();
      ctx.globalAlpha = alpha * (grow < 1 ? Math.min(1, 0.3 + grow) : 1);

      if (node.shape === "dot") {
        // A story: a small dot in its impact colour, with a hairline of background around it.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color(node.colorVar);
        ctx.fill();
        ctx.lineWidth = 1 / k;
        ctx.strokeStyle = color("--bg-sunken", 0.9);
        ctx.stroke();
        const sprite = sprites?.get(`impact:${node.impact ?? "neutral"}`);
        if (sprite && screenR >= 9) drawSprite(ctx, sprite, x, y, r * 1.25, color("--bg-sunken"), 2.4);
      } else if (node.shape === "ring") {
        // A crowd forecast: a violet ring with the crowd icon.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color("--surface");
        ctx.fill();
        ctx.fillStyle = color(node.colorVar, 0.16);
        ctx.fill();
        ctx.lineWidth = Math.max(1.5 / k, r * 0.24);
        ctx.strokeStyle = color(node.colorVar);
        ctx.stroke();
        const sprite = sprites?.get("type:forecast");
        if (sprite && screenR >= 8) drawSprite(ctx, sprite, x, y, r * 1.05, color(node.colorVar), 2.2);
      } else if (screenR < 5.5 || !sprites) {
        // Far away: a solid dot in the type colour.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color(node.colorVar, 0.92);
        ctx.fill();
      } else {
        // Close enough: a badge with the type icon, like the chips.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color("--surface");
        ctx.fill();
        ctx.fillStyle = color(node.colorVar, 0.2);
        ctx.fill();
        ctx.lineWidth = (node.focus ? 2.5 : 1.5) / k;
        ctx.strokeStyle = color(node.colorVar);
        ctx.stroke();
        const sprite = sprites.get(`type:${node.type}`);
        if (sprite) drawSprite(ctx, sprite, x, y, r * 1.1, color(node.colorVar), 2);
      }

      if (node.id === selectedId || (litId === node.id && !dim)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 / k, 0, Math.PI * 2);
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = color("--ring");
        ctx.stroke();
      }
      ctx.restore();
    },
    [lit, growth, calm, color, sprites, selectedId, litId],
  );

  const paintPointer = useCallback(
    (raw: FgNode, paint: string, ctx: CanvasRenderingContext2D, k: number) => {
      const node = raw as VizNode;
      if (node.x === undefined || node.y === undefined) return;
      ctx.fillStyle = paint;
      ctx.beginPath();
      // At least 8 px around small dots, so they are easy to hit and tap.
      ctx.arc(node.x, node.y, Math.max(node.r, (mini ? 7 : 8) / k), 0, Math.PI * 2);
      ctx.fill();
    },
    [mini],
  );

  const drawLink = useCallback(
    (raw: FgLink, ctx: CanvasRenderingContext2D, k: number) => {
      const link = raw as VizLink;
      const s = link.source as VizNode;
      const t = link.target as VizNode;
      if (typeof s !== "object" || typeof t !== "object") return;
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) return;
      const ux = dx / len;
      const uy = dy / len;
      const touches = lit !== null && (s.id === litId || t.id === litId);
      const dim = lit !== null && !touches;
      const causal = link.linkType !== null;
      const tone = causal ? "--fg-muted" : "--fg-subtle";
      const base = causal ? 0.8 : 0.28;
      const alpha = dim ? base * 0.2 : touches ? Math.min(1, base * 1.6) : base;
      const px = (causal ? 1.4 : 0.75) * (touches ? 1.5 : 1);

      const x1 = s.x + ux * s.r;
      const y1 = s.y + uy * s.r;
      const gap = causal ? 2 / k : 0;
      const x2 = t.x - ux * (t.r + gap);
      const y2 = t.y - uy * (t.r + gap);

      ctx.save();
      ctx.strokeStyle = color(tone, alpha);
      ctx.lineWidth = px / k;
      ctx.lineCap = "round";
      const dash = causal ? LINK_TYPES[link.linkType!]?.dasharray : undefined;
      if (dash) ctx.setLineDash(dash.split(/\s+/).map((v) => Number(v) / k));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (causal) {
        // Arrowhead at the effect: cause → effect.
        const size = (touches ? 7 : 5.5) / k;
        const half = size * 0.55;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ux * size - uy * half, y2 - uy * size + ux * half);
        ctx.lineTo(x2 - ux * size * 0.7, y2 - uy * size * 0.7);
        ctx.lineTo(x2 - ux * size + uy * half, y2 - uy * size - ux * half);
        ctx.closePath();
        ctx.fillStyle = color(tone, alpha);
        ctx.fill();
      }
      ctx.restore();
    },
    [lit, litId, color],
  );

  const paintLinkPointer = useCallback((raw: FgLink, paint: string, ctx: CanvasRenderingContext2D, k: number) => {
    const link = raw as VizLink;
    // Only cause-and-effect links are hoverable (they show type and confidence).
    if (link.linkType === null) return;
    const s = link.source as VizNode;
    const t = link.target as VizNode;
    if (typeof s !== "object" || typeof t !== "object" || s.x === undefined || t.x === undefined) return;
    ctx.strokeStyle = paint;
    ctx.lineWidth = 7 / k;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y!);
    ctx.lineTo(t.x, t.y!);
    ctx.stroke();
  }, []);

  const drawLabels = useCallback(
    (ctx: CanvasRenderingContext2D, k: number) => {
      const budget = mini ? 4 : labelBudget(k, width, width < 640);
      const forced = new Set<string>();
      if (selectedId) forced.add(selectedId);
      if (litId) forced.add(litId);
      const candidates: VizNode[] = [];
      const seen = new Set<string>();
      const push = (n: VizNode | undefined) => {
        if (!n || seen.has(n.id) || n.x === undefined) return;
        if (visible && !visible.has(n.id)) return;
        seen.add(n.id);
        candidates.push(n);
      };
      forced.forEach((id) => push(graph.byId.get(id)));
      if (lit) {
        [...lit]
          .map((id) => graph.byId.get(id))
          .filter((n): n is VizNode => !!n)
          .sort((a, b) => a.rank - b.rank)
          .forEach(push);
      } else {
        // The most important nodes on screen compete for labels (the focus
        // ranks first), so zooming into a corner labels what is there.
        const t = ctx.getTransform();
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const onScreen = (n: VizNode) => {
          if (n.x === undefined || n.y === undefined) return false;
          const sx = t.a * n.x + t.c * n.y + t.e;
          const sy = t.b * n.x + t.d * n.y + t.f;
          return sx >= -40 && sx <= w + 40 && sy >= -20 && sy <= h + 20;
        };
        for (let i = 0; i < ranked.length && candidates.length < budget * 3; i++) {
          if (onScreen(ranked[i])) push(ranked[i]);
        }
      }

      const placed: [number, number, number, number][] = [];
      const size = LABEL_PX / k;
      const padX = 4 / k;
      const height = 16 / k;
      let drawn = 0;
      ctx.save();
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (const node of candidates) {
        const isForced = forced.has(node.id);
        if (!isForced && drawn >= (lit ? 24 : budget)) break;
        // Tiny dots far away only get a label when they matter.
        if (!isForced && !lit && node.type === "story" && node.r * k < 4 && drawn > 2) continue;
        const text = isForced && node.name.length > node.label.length ? cut(node.name, 56) : node.label;
        ctx.font = `${isForced ? 600 : 500} ${size}px ${font}`;
        const w = ctx.measureText(text).width + padX * 2;
        const cx = node.x!;
        const top = node.y! + node.r + 3 / k;
        const box: [number, number, number, number] = [cx - w / 2, top, w, height];
        if (!isForced && placed.some((p) => overlaps(p, box))) continue;
        placed.push(box);
        drawn += 1;
        ctx.fillStyle = color("--bg-sunken", 0.78);
        roundRect(ctx, box[0], box[1], box[2], box[3], 4 / k);
        ctx.fill();
        ctx.fillStyle = color(isForced ? "--fg" : "--fg-muted");
        ctx.fillText(text, cx, top + height / 2 + 0.5 / k);
      }
      ctx.restore();
    },
    [mini, width, selectedId, litId, lit, graph, ranked, visible, font, color],
  );

  const nodeVisibility = useCallback((n: FgNode) => !visible || visible.has((n as VizNode).id), [visible]);
  const linkVisibility = useCallback(
    (l: FgLink) => !visible || (visible.has(endId((l as VizLink).source)) && visible.has(endId((l as VizLink).target))),
    [visible],
  );

  if (width <= 0 || height <= 0) return <div className={className}>{host}</div>;

  return (
    // The canvas itself is described by the parent; keyboard users have the list and search.
    <div className={className} onWheel={markMoved} onPointerDown={mini ? undefined : markMoved}>
      {host}
      <ForceGraph2D<VizNode, VizLink>
        // A callback ref, so the forces are in place before the first layout.
        ref={attach as unknown as MutableRefObject<FgMethods | undefined>}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeRelSize={1}
        nodeVal={(n) => (n as VizNode).r ** 2}
        nodeLabel={() => ""}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={paintPointer}
        nodeVisibility={nodeVisibility}
        linkVisibility={linkVisibility}
        linkCanvasObjectMode={() => "replace"}
        linkCanvasObject={drawLink}
        linkPointerAreaPaint={paintLinkPointer}
        linkLabel={() => ""}
        onRenderFramePost={drawLabels}
        warmupTicks={calm ? 300 : mini ? 120 : 60}
        cooldownTicks={calm ? 0 : 400}
        cooldownTime={calm ? 0 : mini ? 2500 : 5000}
        d3VelocityDecay={0.32}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        enableNodeDrag={!mini}
        enableZoomInteraction={!mini}
        enablePanInteraction={!mini}
        showPointerCursor={(obj) => !!obj && "shape" in obj}
        onEngineTick={handleTick}
        onEngineStop={handleStop}
        onNodeClick={(n) => onNodeClick(n as VizNode)}
        onNodeHover={(n) => onNodeHover?.((n as VizNode | null) ?? null)}
        onLinkHover={(l) => onLinkHover?.((l as VizLink | null) ?? null)}
        onBackgroundClick={() => onBackgroundClick?.()}
      />
    </div>
  );
}

/**
 * A weak pull towards the middle (like d3's forceX/forceY at the origin), so
 * clusters that link to nothing else don't drift off.
 */
function gravity(strength: number) {
  let nodes: VizNode[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      n.vx = (n.vx ?? 0) - n.x * strength * alpha;
      n.vy = (n.vy ?? 0) - n.y * strength * alpha;
    }
  };
  force.initialize = (next: VizNode[]) => {
    nodes = next;
  };
  return force;
}

/** The box around the drawn nodes, in graph units (null when none have a place yet). */
function graphBox(nodes: readonly VizNode[], visible: ReadonlySet<string> | null) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined || (visible && !visible.has(n.id))) continue;
    x0 = Math.min(x0, n.x - n.r);
    x1 = Math.max(x1, n.x + n.r);
    y0 = Math.min(y0, n.y - n.r);
    y1 = Math.max(y1, n.y + n.r);
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
