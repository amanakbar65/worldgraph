/**
 * The cascade as a flow (React Flow): cards placed by the dagre layout,
 * links drawn by type and confidence, lanes for If YES / If NO branches.
 * Not editable: the viewer pans, zooms, taps cards and links, and moves
 * between cards with the arrow keys.
 */
import "@xyflow/react/dist/base.css";
import "./cascade.css";

import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { Maximize, Minus, Plus, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { LinkTypeLabel } from "@/components/ConfidenceMeter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCalm } from "@/state/settings";

import { CascadeUiContext, type CascadeUi } from "./cascade-context";
import type { CascadeModel, CascadeNode } from "./cascade-data";
import { flowEdges, flowNodes } from "./cascade-flow-elements";
import { fitPlan, neighbour, type ArrowKey, type CascadeLayout } from "./cascade-layout";
import { CascadeEdgeView } from "./CascadeEdge";
import { LaneNodeView, StoryNodeView } from "./CascadeNodes";

const NODE_TYPES: NodeTypes = { story: StoryNodeView, lane: LaneNodeView };
const EDGE_TYPES: EdgeTypes = { cascade: CascadeEdgeView };
const ARROWS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export interface CascadeFlowProps {
  model: CascadeModel;
  layout: CascadeLayout;
  selectedEdge: string | null;
  onOpenNode: (node: CascadeNode) => void;
  onOpenEvidence: (edgeId: string) => void;
  onOpenForecast: (id: string) => void;
  className?: string;
}

export function CascadeFlow(props: CascadeFlowProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ model, layout, selectedEdge, onOpenNode, onOpenEvidence, onOpenForecast, className }: CascadeFlowProps) {
  const flow = useReactFlow();
  const calm = useCalm();
  const hintId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [activeNode, setActiveNode] = useState(model.focus);
  const [hotNode, setHotNode] = useState<string | null>(null);
  const [hotEdge, setHotEdge] = useState<string | null>(null);

  const nodes = useMemo(() => flowNodes(model, layout), [model, layout]);
  const edges = useMemo(() => flowEdges(model, layout), [model, layout]);
  const duration = calm ? 0 : 280;

  // A new layout (another depth, projections added): frame it, readably.
  const seenAi = useRef<ReadonlySet<string>>(new Set());
  const firstFit = useRef(true);
  useEffect(() => {
    const ai = new Set(model.nodes.filter((n) => n.ai).map((n) => n.id));
    const newAi = [...ai].some((id) => !seenAi.current.has(id));
    seenAi.current = ai;
    const frame = requestAnimationFrame(() => {
      const rect = container.current?.getBoundingClientRect();
      const plan = fitPlan(model, layout, { width: rect?.width ?? 0, height: rect?.height ?? 0 }, newAi);
      void flow.fitView({
        nodes: plan.ids?.map((id) => ({ id })),
        padding: 0.12,
        maxZoom: 1,
        minZoom: plan.minZoom,
        duration: firstFit.current ? 0 : duration,
      });
      firstFit.current = false;
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the layout changes
  }, [layout]);

  // The card that takes Tab must exist (it may vanish when the depth changes).
  const tabbable = layout.nodes.has(activeNode) ? activeNode : model.focus;

  /** Keep a card in view when the keyboard moves to it. */
  const reveal = useCallback(
    (id: string) => {
      const box = layout.nodes.get(id);
      const el = container.current;
      if (!box || !el) return;
      const { x, y, zoom } = flow.getViewport();
      const rect = el.getBoundingClientRect();
      const left = box.x * zoom + x;
      const top = box.y * zoom + y;
      const margin = 24;
      const inside =
        left >= margin &&
        top >= margin &&
        left + box.width * zoom <= rect.width - margin &&
        top + box.height * zoom <= rect.height - margin;
      if (!inside) void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration });
    },
    [flow, layout, duration],
  );

  const focusCard = useCallback(
    (id: string) => {
      setActiveNode(id);
      reveal(id);
      requestAnimationFrame(() => {
        const el = container.current?.querySelector<HTMLElement>(`[data-cascade-node="${CSS.escape(id)}"]`);
        el?.focus({ preventScroll: true });
      });
    },
    [reveal],
  );

  const onNodeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string) => {
      if (ARROWS.has(event.key)) {
        event.preventDefault();
        const next = neighbour(layout, id, event.key as ArrowKey);
        if (next) focusCard(next);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusCard(model.focus);
      }
    },
    [layout, model.focus, focusCard],
  );

  // Focus can scroll React Flow's clipped box; keep it at the origin.
  const unscroll = useCallback(() => {
    let el: HTMLElement | null = (document.activeElement as HTMLElement | null) ?? null;
    while (el && el !== container.current) {
      if (el.scrollLeft || el.scrollTop) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
      el = el.parentElement;
    }
  }, []);

  const mixedSample = useMemo(
    () => model.nodes.some((n) => n.story.is_sample) && model.nodes.some((n) => !n.story.is_sample && !n.ai),
    [model],
  );

  const ui = useMemo<CascadeUi>(
    () => ({
      direction: layout.direction,
      mixedSample,
      activeNode: tabbable,
      hotNode,
      hotEdge,
      selectedEdge,
      hintId,
      setActiveNode,
      setHotNode,
      setHotEdge,
      openNode: onOpenNode,
      openEvidence: onOpenEvidence,
      onNodeKeyDown,
      openForecast: onOpenForecast,
    }),
    [
      layout.direction,
      mixedSample,
      tabbable,
      hotNode,
      hotEdge,
      selectedEdge,
      hintId,
      onOpenNode,
      onOpenEvidence,
      onNodeKeyDown,
      onOpenForecast,
    ],
  );

  return (
    <CascadeUiContext.Provider value={ui}>
      <div
        ref={container}
        // Drags here pan the flow, not the bottom sheet.
        data-vaul-no-drag=""
        onFocusCapture={() => requestAnimationFrame(unscroll)}
        className={cn(
          "wg-cascade relative size-full",
          className,
        )}
      >
        <p id={hintId} className="sr-only">
          Arrow keys move between stories; Enter opens one. Each link's label opens its evidence.
        </p>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          role="group"
          aria-label={
            layout.direction === "LR"
              ? "Cascade: causes on the left, this story in the middle, effects on the right"
              : "Cascade: causes above, this story in the middle, effects below"
          }
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          onEdgeClick={(_, edge) => onOpenEvidence(edge.id)}
          onEdgeMouseEnter={(_, edge) => setHotEdge(edge.id)}
          onEdgeMouseLeave={() => setHotEdge(null)}
          minZoom={0.2}
          maxZoom={1.75}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          zoomOnDoubleClick={false}
          className="bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line-strong)" />
          <Panel position="top-right" className="!m-3">
            <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-glass shadow-panel backdrop-blur">
              <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => void flow.zoomIn({ duration })}>
                <Plus aria-hidden />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => void flow.zoomOut({ duration })}>
                <Minus aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fit the whole cascade in view"
                onClick={() => void flow.fitView({ padding: 0.12, maxZoom: 1, duration })}
              >
                <Maximize aria-hidden />
              </Button>
            </div>
          </Panel>
          <Panel position="bottom-left" className="!m-3">
            <Legend hasBranches={model.groups.some((g) => g.kind === "branch")} hasAi={model.nodes.some((n) => n.ai)} />
          </Panel>
        </ReactFlow>
      </div>
    </CascadeUiContext.Provider>
  );
}

/** What the line styles mean. */
function Legend({ hasBranches, hasAi }: { hasBranches: boolean; hasAi: boolean }) {
  return (
    <div
      role="note"
      aria-label="Legend"
      className="flex max-w-[calc(100vw-48px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-glass px-3 py-2 shadow-panel backdrop-blur"
    >
      <LinkTypeLabel linkType="reported" />
      <LinkTypeLabel linkType="inferred" />
      <LinkTypeLabel linkType="projected" />
      {hasBranches && (
        <span className="inline-flex items-center gap-1.5 text-label whitespace-nowrap text-fg-muted">
          <Users aria-hidden className="size-3.5 text-forecast" />
          If YES / If NO: crowd forecast
        </span>
      )}
      {hasAi && (
        <span className="inline-flex items-center gap-1.5 text-label whitespace-nowrap text-fg-muted">
          <Sparkles aria-hidden className="size-3.5" />
          AI projection
        </span>
      )}
      <span className="text-label whitespace-nowrap text-fg-subtle">Thicker line = surer link</span>
    </div>
  );
}
