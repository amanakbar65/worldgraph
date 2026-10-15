import { Network } from "lucide-react";
import { useMemo, useState } from "react";

import type { EntityType, GraphData } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalm } from "@/state/settings";

import { GraphCanvas } from "./GraphCanvas";
import { describeGraph, shapeGraph, typeCount } from "./graph-data";
import { useElementSize, useGraphTheme } from "./use-graph-theme";

export interface EntityLocalGraphProps {
  entity: { id: string; name: string };
  /** The page's own graph (direct links), from api.entity. */
  graph: GraphData;
  onOpen: (node: { id: string; type: EntityType }) => void;
  /** The graph screen around this entity, at this depth. */
  onShowInGraph: (depth: 1 | 2) => void;
}

const DEPTHS = [
  { value: "1", label: "Direct links", ariaLabel: "Direct links only" },
  { value: "2", label: "2 steps", ariaLabel: "Up to 2 steps away" },
] as const;

/**
 * The entity's neighbourhood as a small, still graph: direct links, or two
 * steps out. Hover lights up a node's links; tapping opens it. The full
 * graph screen takes over for exploring.
 */
export function EntityLocalGraph({ entity, graph, onOpen, onShowInGraph }: EntityLocalGraphProps) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const deeper = useRpc(
    "local_graph",
    { id: entity.id, depth: 2, limit: 120 },
    { enabled: depth === 2, refetchInterval: false },
  );
  const data = depth === 1 ? graph : deeper.data;
  const viz = useMemo(() => (data ? shapeGraph(data, { focusId: entity.id }) : null), [data, entity.id]);
  const theme = useGraphTheme();
  const calm = useCalm();
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [lit, setLit] = useState<string | null>(null);

  const lonely = !!viz && viz.links.length === 0;
  const description = viz ? describeGraph(viz, typeCount) : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<"1" | "2">
          size="sm"
          aria-label="How far to look"
          value={String(depth) as "1" | "2"}
          onValueChange={(v) => setDepth(v === "2" ? 2 : 1)}
          options={DEPTHS}
        />
        {viz && !lonely && (
          <span className="text-label text-fg-muted tabular-nums">
            {viz.nodes.length - 1} linked · {viz.links.length} links
          </span>
        )}
      </div>

      <div
        ref={boxRef}
        className="relative h-64 overflow-hidden rounded-xl border border-line bg-bg-sunken"
        onMouseLeave={() => setLit(null)}
      >
        {viz && !lonely && size.width > 0 && (
          <div
            role="img"
            aria-label={`Connections of ${entity.name}: ${description}. Explore in the graph has a list of them.`}
            className="absolute inset-0"
          >
            <GraphCanvas
              graph={viz}
              width={size.width}
              height={size.height}
              variant="mini"
              palette={theme.palette}
              font={theme.font}
              calm={calm}
              selectedId={entity.id}
              litId={lit}
              onNodeClick={(node) => {
                if (node.id !== entity.id) onOpen(node);
              }}
              onNodeHover={(node) => setLit(node?.id ?? null)}
              className="absolute inset-0"
            />
          </div>
        )}
        {!data && depth === 2 && deeper.isError && (
          <div className="absolute inset-0 flex items-center justify-center p-3">
            <ErrorState compact error={deeper.error} onRetry={() => void deeper.refetch()} />
          </div>
        )}
        {!data && !deeper.isError && (
          <div className="absolute inset-0" aria-busy="true" aria-label="Loading connections">
            {[
              [50, 50, 28],
              [30, 34, 14],
              [70, 30, 12],
              [72, 68, 16],
              [32, 70, 12],
            ].map(([x, y, s], i) => (
              <Skeleton
                key={i}
                className="absolute rounded-full"
                style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, transform: "translate(-50%, -50%)" }}
              />
            ))}
          </div>
        )}
        {lonely && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              compact
              icon={Network}
              title="No connections yet"
              description="Links appear as news that mentions it is analysed."
            />
          </div>
        )}
      </div>

      <Button variant="outline" className="self-start" onClick={() => onShowInGraph(depth)}>
        <Network aria-hidden />
        Explore in the graph
      </Button>
    </div>
  );
}
