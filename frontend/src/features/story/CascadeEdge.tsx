/**
 * A causal link in the flow: the line shows the link type (solid reported,
 * dashed inferred, dotted projected or conditional) and its confidence
 * (weight and opacity). The label names the mechanism; hover or focus adds
 * the type and confidence in words, and a tap opens the evidence.
 */
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { Users } from "lucide-react";

import { formatProbability } from "@/lib/format";
import { LINK_TYPES } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { useCascadeUi } from "./cascade-context";
import { branchLabel, type CascadeEdge } from "./cascade-data";
import { flowPath, midpoint, type FlowDirection, type LaidOutEdge } from "./cascade-layout";
import { capitalise, edgeLook, linkSummary } from "./cascade-style";

export type CascadeFlowEdge = Edge<{ edge: CascadeEdge; laid: LaidOutEdge; direction: FlowDirection }, "cascade">;

export function CascadeEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<CascadeFlowEdge>) {
  const ui = useCascadeUi();
  if (!data) return null;
  const { edge, laid, direction } = data;
  const { link, branch } = edge;
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const path = flowPath(source, target, laid.points, direction);
  const at = laid.label ?? midpoint(source, target, laid.points);
  const look = edgeLook(link.link_type, link.confidence);

  const touchesHotNode = ui.hotNode !== null && (link.src === ui.hotNode || link.dst === ui.hotNode);
  const hot = ui.hotEdge === id || ui.selectedEdge === id || touchesHotNode;
  const faded = ui.hotNode !== null && !touchesHotNode && ui.selectedEdge !== id;
  const typeLabel = edge.ai ? "AI projection" : (LINK_TYPES[link.link_type]?.label ?? link.link_type);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke: look.tone === "forecast" ? "var(--forecast)" : hot ? "var(--fg)" : "var(--fg-muted)",
          strokeWidth: hot ? look.width + 0.75 : look.width,
          strokeOpacity: faded ? look.opacity * 0.3 : hot ? Math.min(1, look.opacity + 0.15) : look.opacity,
          strokeDasharray: look.dasharray,
          strokeLinecap: "round",
          transition: "stroke-opacity 150ms, stroke-width 150ms",
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => ui.openEvidence(id)}
          onMouseEnter={() => ui.setHotEdge(id)}
          onMouseLeave={() => ui.setHotEdge(null)}
          onFocus={() => ui.setHotEdge(id)}
          onBlur={() => ui.setHotEdge(null)}
          aria-label={`${linkSummary(link, branch, edge.ai)} Show the evidence.`}
          aria-pressed={ui.selectedEdge === id}
          style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, zIndex: hot ? 5 : 3 }}
          className={cn(
            "nodrag nopan pointer-events-auto absolute flex max-w-[156px] cursor-pointer flex-col items-center gap-1 rounded-lg border bg-surface px-2 py-1 text-center text-label shadow-panel transition-[opacity,border-color]",
            hot ? "border-line-strong" : "border-line",
            ui.selectedEdge === id && "border-fg/60",
            faded && "opacity-40",
          )}
        >
          {branch && (
            <span className="inline-flex items-center gap-1 rounded-full border border-forecast/40 bg-forecast/12 px-1.5 font-medium whitespace-nowrap text-forecast tabular-nums">
              <Users aria-hidden className="size-3" />
              {branchLabel(branch.outcome, branch.probability)}
            </span>
          )}
          <span className="leading-tight text-fg">{capitalise(link.mechanism)}</span>
          {hot && (
            <span className="whitespace-nowrap text-fg-muted tabular-nums">
              {typeLabel} · {formatProbability(link.confidence)}
            </span>
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
