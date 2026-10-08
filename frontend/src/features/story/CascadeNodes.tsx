/**
 * The flow's cards: compact story cards, and the lane boxes that group a
 * forecast's If YES / If NO effects or the AI projections.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Sparkles, Telescope, Users } from "lucide-react";

import type { ForecastSummary } from "@/api/contract";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { TimeAgo } from "@/components/TimeAgo";
import { formatCompact, formatProbability } from "@/lib/format";
import { impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { useCascadeUi } from "./cascade-context";
import type { CascadeGroup, CascadeNode } from "./cascade-data";
import type { FlowDirection, LaidOutGroup } from "./cascade-layout";
import { nodeLabel } from "./cascade-style";
import { ImpactTile, StoryMeta } from "./story-parts";

export type StoryFlowNode = Node<{ node: CascadeNode; direction: FlowDirection }, "story">;
export type LaneFlowNode = Node<{ group: CascadeGroup; laid: LaidOutGroup }, "lane">;

/** "186K volume", "12.4K MANA volume", or a plain note when the provider gives none. */
function forecastVolume(forecast: ForecastSummary): string {
  if (forecast.volume === null) return "volume not reported";
  return `${formatCompact(forecast.volume)}${forecast.volume_unit ? ` ${forecast.volume_unit}` : ""} volume`;
}

const HIDDEN_HANDLE ="!pointer-events-none !size-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

/** A compact story card. Clicking opens the story; arrow keys move between cards. */
export function StoryNodeView({ id, data }: NodeProps<StoryFlowNode>) {
  const ui = useCascadeUi();
  const { node, direction } = data;
  const { story } = node;
  const focus = node.role === "focus";
  const tone = impactTone(story.analysed ? story.impact : "neutral");
  const lr = direction === "LR";

  return (
    <>
      <Handle type="target" position={lr ? Position.Left : Position.Top} isConnectable={false} className={HIDDEN_HANDLE} />
      {focus && (
        <span
          aria-hidden
          className="absolute -top-3 left-3 z-10 rounded-full bg-fg px-2 text-label leading-5 font-medium text-bg shadow-panel"
        >
          This story
        </span>
      )}
      <button
        type="button"
        data-cascade-node={id}
        tabIndex={ui.activeNode === id ? 0 : -1}
        aria-label={nodeLabel(node)}
        aria-describedby={ui.hintId}
        onClick={() => ui.openNode(node)}
        onKeyDown={(e) => ui.onNodeKeyDown(e, id)}
        onFocus={() => {
          ui.setActiveNode(id);
          ui.setHotNode(id);
        }}
        onBlur={() => ui.setHotNode(null)}
        onMouseEnter={() => ui.setHotNode(id)}
        onMouseLeave={() => ui.setHotNode(null)}
        className={cn(
          "nodrag nopan relative flex size-full cursor-pointer flex-col justify-between gap-1.5 overflow-hidden rounded-xl border bg-surface py-2.5 pr-3 pl-4 text-left shadow-panel transition-colors",
          "hover:border-line-strong hover:bg-surface-2",
          focus && "border-2 border-fg/55 bg-surface-2",
          !focus && story.kind === "projected" && !node.ai && "border-dashed border-line-strong",
          node.ai && "border-2 border-dotted border-fg-subtle/60 bg-surface/90",
          ui.hotNode === id && "border-line-strong bg-surface-2",
        )}
      >
        {/* The impact colour as an edge; the icon and word carry the meaning too. */}
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone.bg, node.ai && "opacity-50")} />
        <span className="flex min-w-0 items-start gap-2.5">
          <ImpactTile impact={story.analysed ? story.impact : "neutral"} size={focus ? "md" : "sm"} />
          <span className={cn("min-w-0 text-body font-medium text-fg", focus ? "line-clamp-3" : "line-clamp-2")}>
            {story.headline}
          </span>
        </span>
        {node.ai ? (
          <span className="flex items-center gap-1.5 text-label text-fg-muted">
            <Telescope aria-hidden className="size-3" />
            <span className="font-medium text-fg">Projection, not news</span>
            {story.confidence !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatProbability(story.confidence)}</span>
              </>
            )}
          </span>
        ) : (
          <StoryMeta story={story} oneLine showSample={ui.mixedSample} />
        )}
      </button>
      <Handle type="source" position={lr ? Position.Right : Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} />
    </>
  );
}

/** A box of lanes: "If YES · 62%" / "If NO · 38%" for a forecast, or the AI projections. */
export function LaneNodeView({ data }: NodeProps<LaneFlowNode>) {
  const ui = useCascadeUi();
  const { group, laid } = data;
  const ai = group.kind === "ai";
  const forecast = group.forecast;

  return (
    <div
      className={cn(
        "relative size-full rounded-2xl border",
        ai ? "border-2 border-dotted border-line-strong bg-surface/30" : "border-forecast/35 bg-forecast/[0.04]",
      )}
    >
      {ai ? (
        <div className="flex h-12 items-center gap-2 px-3 text-label">
          <Sparkles aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-fg">AI projection</span>
            <span className="truncate text-fg-muted">Possible next effects · not saved</span>
          </span>
        </div>
      ) : (
        forecast && (
          <button
            type="button"
            onClick={() => ui.openForecast(forecast.id)}
            title={forecast.question}
            aria-label={`${forecast.short_title}: crowd forecast from ${forecast.provider_name}. Open the forecast.`}
            className="nodrag nopan flex h-[66px] w-full cursor-pointer items-start gap-2 rounded-t-2xl px-3 pt-2.5 text-left text-label transition-colors hover:bg-forecast/10"
          >
            <Users aria-hidden className="mt-px size-3.5 shrink-0 text-forecast" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-fg">{forecast.short_title}</span>
              <span className="truncate text-fg-muted">Crowd forecast · {forecast.provider_name}</span>
              <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-fg-muted">
                <span className="shrink-0 tabular-nums">{forecastVolume(forecast)}</span>
                {forecast.updated_at && (
                  <>
                    <span aria-hidden>·</span>
                    <TimeAgo value={forecast.updated_at} prefix="Updated" className="truncate" />
                  </>
                )}
              </span>
            </span>
          </button>
        )
      )}
      {laid.sections.map((section) => {
        const info = group.sections.find((s) => s.key === section.key);
        if (!info) return null;
        return (
          <div
            key={section.key}
            className={cn(
              "absolute rounded-xl border",
              ai ? "border-transparent" : "border-dashed border-forecast/30 bg-surface/40",
            )}
            style={{ left: section.x - laid.x, top: section.y - laid.y, width: section.width, height: section.height }}
          >
            <div className="flex h-14 items-center gap-2.5 px-2">
              {ai ? (
                <span className="flex min-w-0 flex-col pl-1">
                  <span className="text-body font-semibold text-fg">Projection, not news</span>
                  <span className="truncate text-label text-fg-muted">Confidence 50% or less</span>
                </span>
              ) : (
                <>
                  <ProbabilityRing
                    size="sm"
                    probability={info.probability ?? 0}
                    thin={forecast?.thin}
                    label={`If ${info.outcome ?? ""}`}
                  />
                  <span className="flex flex-col">
                    <span className="text-body font-semibold text-fg tabular-nums">{info.label}</span>
                    <span className="text-label text-fg-muted">
                      {info.ids.length === 1 ? "This effect needs it" : "These effects need it"}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
