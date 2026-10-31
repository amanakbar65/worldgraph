import { useMemo, useState } from "react";

import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { DelayedMark, PolarityMark, WeakLegend } from "@/components/LinkMarks";
import { SampleBadge } from "@/components/SampleBadge";
import { Button } from "@/components/ui/button";
import { WeakMark } from "@/components/WeakMark";
import { DEFAULT_RELATION_ICON, ENTITY_TYPE_ICONS, IMPACT_ICONS, RELATION_ICONS } from "@/lib/icons";
import { entityTypeTone, impactTone, WEAK_LINK_LABEL } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import {
  topConnections,
  TYPE_NAMES,
  type Connection,
  type RelationIndex,
  type VizGraph,
  type VizLink,
  type VizNode,
} from "./graph-data";

export interface GraphListProps {
  graph: VizGraph;
  onOpen: (node: VizNode) => void;
  /** Named relations (kg.relations): label links by relation, from each end's side. */
  relations?: RelationIndex | null;
  /**
   * Choose a link (its card opens with the relation and "Why
   * is this here?"). Given, each connection's relation becomes a button, so
   * every link is reachable by keyboard.
   */
  onSelectLink?: (link: VizLink) => void;
  /** The chosen link (VizLink id). */
  selectedLinkId?: string | null;
  className?: string;
}

/**
 * The graph as a list, for keyboards and screen readers (and anyone who
 * prefers reading): the best-connected nodes first, each with its main
 * connections. Cause-and-effect links say how they are known and how sure.
 */
export function GraphList({ graph, onOpen, relations = null, onSelectLink, selectedLinkId = null, className }: GraphListProps) {
  const [count, setCount] = useState(40);
  const entries = useMemo(() => topConnections(graph, count, 6, relations), [graph, count, relations]);
  // The list draws no lines, so the one legend's "?" row comes along when a "?" is shown.
  const anyWeak = entries.some((e) => e.connections.some((c) => c.link.weak));
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {anyWeak && <WeakLegend className="rounded-lg border border-line bg-surface/80 px-3 py-2" />}
      <ul aria-label="Nodes, most connected first" className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.node.id} className="rounded-xl border border-line bg-surface/80 p-2">
            <NodeButton node={entry.node} onOpen={onOpen} />
            {entry.connections.length > 0 && (
              <ul aria-label={`Connections of ${entry.node.name}`} className="mt-1 flex flex-col pl-11">
                {entry.connections.map((c) => (
                  <ConnectionRow
                    key={c.link.id}
                    from={entry.node}
                    connection={c}
                    onOpen={onOpen}
                    onSelectLink={onSelectLink}
                    selected={c.link.id === selectedLinkId}
                    named={relations !== null}
                  />
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

function ConnectionRow({
  from,
  connection,
  onOpen,
  onSelectLink,
  selected,
  named,
}: {
  from: VizNode;
  connection: Connection;
  onOpen: (n: VizNode) => void;
  onSelectLink?: (link: VizLink) => void;
  selected: boolean;
  /** Relations are named (kg.relations): show the relation's icon. */
  named: boolean;
}) {
  const { node, link, relation } = connection;
  const { tone, Icon } = nodeMark(node);
  const RelationIcon = (RELATION_ICONS[link.relation] ?? DEFAULT_RELATION_ICON).icon;
  const causal = link.linkType !== null;
  const outgoing = link.sourceId === from.id;
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      {onSelectLink ? (
        // The relation is the link: choosing it opens the link's card.
        <button
          type="button"
          onClick={() => onSelectLink(link)}
          aria-pressed={selected}
          aria-label={`Link details: ${from.name}, ${relation.toLowerCase()}, ${node.name}`}
          className={cn(
            "relative flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-label text-fg-muted before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-[''] hover:border-line-strong hover:text-fg",
            selected ? "border-fg/60 bg-fg/15 text-fg" : "border-line",
          )}
        >
          {named && <RelationIcon aria-hidden className="size-3.5" />}
          {relation}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-surface-2"
      >
        {onSelectLink ? (
          <span className="sr-only">{relation}: </span>
        ) : (
          <span className="shrink-0 text-label text-fg-subtle">{relation}</span>
        )}
        <Icon aria-hidden className={cn("size-3.5 shrink-0", tone.text)} />
        <span className="truncate text-body text-fg-muted">{node.name}</span>
      </button>
      {causal ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2 text-label">
          {/* Polarity reads from the cause, so it is said on the cause's row. */}
          {named && outgoing && <PolarityMark polarity={link.polarity} />}
          {named && <DelayedMark delayed={link.delayed} />}
          {link.confidence !== null && <ConfidenceMeter confidence={link.confidence} linkType={link.linkType!} />}
          {link.weak && <WeakMark label={WEAK_LINK_LABEL} />}
        </span>
      ) : (
        link.weak && <WeakMark label={WEAK_LINK_LABEL} className="mr-2" />
      )}
    </li>
  );
}
