import { useMemo, useState } from "react";

import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { SampleBadge } from "@/components/SampleBadge";
import { Button } from "@/components/ui/button";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS } from "@/lib/icons";
import { entityTypeTone, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { topConnections, TYPE_NAMES, type Connection, type VizGraph, type VizNode } from "./graph-data";

export interface GraphListProps {
  graph: VizGraph;
  onOpen: (node: VizNode) => void;
  className?: string;
}

/**
 * The graph as a list, for keyboards and screen readers (and anyone who
 * prefers reading): the best-connected nodes first, each with its main
 * connections. Cause-and-effect links say how they are known and how sure.
 */
export function GraphList({ graph, onOpen, className }: GraphListProps) {
  const [count, setCount] = useState(40);
  const entries = useMemo(() => topConnections(graph, count, 6), [graph, count]);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ul aria-label="Nodes, most connected first" className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.node.id} className="rounded-xl border border-line bg-surface/80 p-2">
            <NodeButton node={entry.node} onOpen={onOpen} />
            {entry.connections.length > 0 && (
              <ul aria-label={`Connections of ${entry.node.name}`} className="mt-1 flex flex-col pl-11">
                {entry.connections.map((c) => (
                  <ConnectionRow key={c.link.id} connection={c} onOpen={onOpen} />
                ))}
                {entry.more > 0 && (
                  <li className="px-2 py-1 text-label text-fg-subtle">and {entry.more} more</li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {graph.nodes.length > count && (
        <Button variant="outline" className="self-center" onClick={() => setCount((c) => c + 40)}>
          Show more ({graph.nodes.length - count} left)
        </Button>
      )}
    </div>
  );
}

function nodeMark(node: VizNode) {
  if (node.type === "story") {
    const impact = node.impact ?? "neutral";
    return { tone: impactTone(impact), Icon: IMPACT_ICONS[impact].icon, kind: `Story, ${impactTone(impact).label.toLowerCase()}` };
  }
  return {
    tone: entityTypeTone(node.type),
    Icon: (ENTITY_TYPE_ICONS[node.type] ?? ENTITY_TYPE_ICONS.story).icon,
    kind: TYPE_NAMES[node.type]?.one ?? node.type,
  };
}

function NodeButton({ node, onOpen }: { node: VizNode; onOpen: (n: VizNode) => void }) {
  const { tone, Icon, kind } = nodeMark(node);
  return (
    <button
      type="button"
      onClick={() => onOpen(node)}
      className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg p-1 text-left hover:bg-surface-2"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border",
          node.type === "forecast" ? "border-2 border-forecast" : tone.border,
          tone.tint,
        )}
      >
        <Icon className={cn("size-4", tone.text)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-body font-medium text-fg">{node.name}</span>
        <span className="text-label text-fg-muted">
          {kind} · {node.degree} {node.degree === 1 ? "connection" : "connections"}
        </span>
      </span>
      {node.isSample && <SampleBadge compact />}
    </button>
  );
}

function ConnectionRow({ connection, onOpen }: { connection: Connection; onOpen: (n: VizNode) => void }) {
  const { node, link, relation } = connection;
  const { tone, Icon } = nodeMark(node);
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-surface-2"
      >
        <span className="shrink-0 text-label text-fg-subtle">{relation}</span>
        <Icon aria-hidden className={cn("size-3.5 shrink-0", tone.text)} />
        <span className="truncate text-body text-fg-muted">{node.name}</span>
      </button>
      {link.linkType && link.confidence !== null && (
        <ConfidenceMeter confidence={link.confidence} linkType={link.linkType} className="pl-2" />
      )}
    </li>
  );
}
