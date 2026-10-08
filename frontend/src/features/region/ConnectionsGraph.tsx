import { Network } from "lucide-react";
import { useMemo, useState } from "react";

import type { EntityType, GraphData, LinkType } from "@/api/contract";
import { LinkTypeLabel } from "@/components/ConfidenceMeter";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS } from "@/lib/icons";
import { LINK_TYPES, entityTypeTone, impactTone, type Tone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { layoutMiniGraph, neighbours, type PlacedNode } from "./region-graph";

export interface ConnectionsGraphProps {
  graph: GraphData;
  focusId: string;
  regionName: string;
  /** A node was tapped. */
  onOpen: (node: { id: string; type: EntityType }) => void;
  /** "See everything": the region's full page with its whole graph. */
  onSeeAll?: () => void;
}

/** A story takes its impact's colour and icon; a forecast is violet with the crowd icon. */
function nodeLook(node: PlacedNode): { tone: Tone; Icon: (typeof ENTITY_TYPE_ICONS)[EntityType]["icon"]; kind: string } {
  if (node.type === "story") {
    const impact = node.impact ?? "neutral";
    const tone = impactTone(impact);
    return { tone, Icon: IMPACT_ICONS[impact].icon, kind: `story, ${tone.label.toLowerCase()}` };
  }
  const tone = entityTypeTone(node.type);
  const kind = node.type === "forecast" ? "crowd forecast" : tone.label.toLowerCase();
  return { tone, Icon: (ENTITY_TYPE_ICONS[node.type] ?? ENTITY_TYPE_ICONS.story).icon, kind };
}

/**
 * The region's connections at a glance: the region in the middle and up to
 * ten linked companies, goods, policies, forecasts and stories around it.
 * Hover or focus a node to light up its links; tap it to open it.
 */
export function ConnectionsGraph({ graph, focusId, regionName, onOpen, onSeeAll }: ConnectionsGraphProps) {
  const mini = useMemo(() => layoutMiniGraph(graph, focusId, { max: 10, rx: 0.39, ry: 0.35, cy: 0.45 }), [graph, focusId]);
  const [active, setActive] = useState<string | null>(null);
  const lit = useMemo(() => (active ? neighbours(mini, active) : null), [mini, active]);

  if (!mini.center || mini.nodes.length === 0) {
    return (
      <EmptyState
        compact
        icon={Network}
        title="No connections yet"
        description="Companies, goods and stories linked to this place appear here as news is analysed."
      />
    );
  }

  const linkTypes = [...new Set(mini.links.map((l) => l.kind))].filter((k): k is LinkType => k !== "structure");
  const total = mini.nodes.length + mini.hidden;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={`Connections of ${regionName}: ${mini.nodes.length} of ${total} shown`}
        className="relative h-80 w-full overflow-hidden rounded-xl border border-line bg-bg-sunken/50"
        onMouseLeave={() => setActive(null)}
      >
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          {mini.links.map((link) => {
            const on = lit ? lit.has(link.source.id) && lit.has(link.target.id) : false;
            return (
              <line
                key={link.id}
                x1={link.source.x * 100}
                y1={link.source.y * 100}
                x2={link.target.x * 100}
                y2={link.target.y * 100}
                vectorEffect="non-scaling-stroke"
                strokeWidth={on ? 1.75 : 1.25}
                strokeLinecap="round"
                strokeDasharray={link.kind === "structure" ? undefined : LINK_TYPES[link.kind].dasharray}
                className={cn(
                  "transition-opacity",
                  on ? "stroke-fg-muted" : "stroke-line-strong",
                  lit && !on && "opacity-30",
                )}
              />
            );
          })}
        </svg>
        <GraphNodeButton
          node={mini.center}
          dim={!!lit && !lit.has(mini.center.id)}
          onActive={setActive}
          onOpen={onOpen}
        />
        {mini.nodes.map((node) => (
          <GraphNodeButton key={node.id} node={node} dim={!!lit && !lit.has(node.id)} onActive={setActive} onOpen={onOpen} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ul aria-label="Key" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {mini.types.map((type) => (
            <LegendItem key={type} type={type} />
          ))}
          {linkTypes.map((t) => (
            <li key={t}>
              <LinkTypeLabel linkType={t} />
            </li>
          ))}
        </ul>
        {onSeeAll && (
          <Button variant="ghost" size="sm" onClick={onSeeAll} className="ml-auto -mr-2">
            {mini.hidden > 0 ? `See all ${total}` : "Open full page"}
          </Button>
        )}
      </div>
    </div>
  );
}

function GraphNodeButton({
  node,
  dim,
  onActive,
  onOpen,
}: {
  node: PlacedNode;
  dim: boolean;
  onActive: (id: string | null) => void;
  onOpen: ConnectionsGraphProps["onOpen"];
}) {
  const { tone, Icon, kind } = nodeLook(node);
  const forecast = node.type === "forecast";
  const size = node.center ? 44 : 32;
  return (
    <button
      type="button"
      onClick={() => onOpen({ id: node.id, type: node.type })}
      onMouseEnter={() => onActive(node.id)}
      onFocus={() => onActive(node.id)}
      onBlur={() => onActive(null)}
      aria-label={`${node.name}, ${kind}${node.is_sample ? ", sample data" : ""}`}
      title={node.name}
      className={cn(
        "group absolute flex w-24 cursor-pointer flex-col items-center gap-1 rounded-lg transition-opacity focus-visible:z-10",
        node.center && "z-[1] w-28",
        dim && "opacity-40",
      )}
      style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%`, transform: `translate(-50%, ${-size / 2}px)` }}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border bg-surface transition-transform group-hover:scale-110",
          forecast ? "border-2 border-forecast" : tone.border,
          node.center && "border-2",
        )}
        style={{ width: size, height: size }}
      >
        <span className={cn("flex size-full items-center justify-center rounded-full", tone.tint)}>
          <Icon className={cn(node.center ? "size-5" : "size-4", tone.text)} />
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "line-clamp-2 max-w-full rounded bg-bg-sunken/80 px-1 text-center text-label leading-tight break-words",
          node.center ? "font-semibold text-fg" : "text-fg-muted group-hover:text-fg",
        )}
      >
        {node.name}
      </span>
    </button>
  );
}

function LegendItem({ type }: { type: EntityType }) {
  if (type === "story") {
    // Stories wear their impact: opportunity, risk or neutral.
    return (
      <li className="inline-flex items-center gap-1 text-label text-fg-muted">
        <span aria-hidden className="inline-flex items-center gap-0.5">
          {(["opportunity", "risk"] as const).map((impact) => {
            const Icon = IMPACT_ICONS[impact].icon;
            return <Icon key={impact} className={cn("size-3.5", impactTone(impact).text)} />;
          })}
        </span>
        Story, by impact
      </li>
    );
  }
  const tone = entityTypeTone(type);
  const Icon = (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.story).icon;
  return (
    <li className="inline-flex items-center gap-1 text-label text-fg-muted">
      <Icon aria-hidden className={cn("size-3.5", tone.text)} />
      {type === "forecast" ? "Crowd forecast" : tone.label}
    </li>
  );
}
