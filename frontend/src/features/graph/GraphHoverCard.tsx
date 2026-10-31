import { ArrowDown, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { ImpactBadge } from "@/components/ImpactBadge";
import { DelayedMark, PolarityMark } from "@/components/LinkMarks";
import { SampleBadge } from "@/components/SampleBadge";
import { WeakMark } from "@/components/WeakMark";
import { DEFAULT_RELATION_ICON, ENTITY_TYPE_ICONS, RELATION_ICONS } from "@/lib/icons";
import { entityTypeTone, isWeak, polarityInfo, WEAK_LINK_LABEL } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import {
  CARD_W,
  describeLink,
  linkEnds,
  linkRelationName,
  TYPE_NAMES,
  type RelationIndex,
  type VizLink,
  type VizNode,
} from "./graph-data";

/** What a hovered node is, at a glance. Decorative for screen readers (the list and panels carry it). */
export function NodeHoverCard({ node, at }: { node: VizNode; at: { left: number; top: number } }) {
  const tone = entityTypeTone(node.type);
  const Icon = (ENTITY_TYPE_ICONS[node.type] ?? ENTITY_TYPE_ICONS.story).icon;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 flex flex-col gap-1.5 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-panel backdrop-blur"
      style={{ left: at.left, top: at.top, width: CARD_W }}
    >
      <div className="flex items-center gap-2">
        {node.type === "story" ? (
          <ImpactBadge impact={node.impact ?? "neutral"} />
        ) : (
          <span className={cn("inline-flex items-center gap-1 text-label font-medium", tone.text)}>
            <Icon className="size-3.5" />
            {TYPE_NAMES[node.type]?.one ?? node.type}
          </span>
        )}
        {node.isSample && <SampleBadge compact className="ml-auto" />}
      </div>
      <p className="line-clamp-3 text-body font-medium text-fg">{node.name}</p>
      <p className="text-label text-fg-muted">
        {node.degree} {node.degree === 1 ? "connection" : "connections"} · Click to open
      </p>
    </div>
  );
}

/**
 * A link's card: the relation it names (read from the source: "Owns"), its
 * two ends, and for cause and effect ▲ raises / ▼ lowers, a clock when the
 * effect is delayed, how it is known and how sure, with "?" when weak.
 *
 * Hovering shows it decoratively (the list view carries the same for
 * keyboards). A tapped or chosen link shows it as a small dialog-like card
 * with a close button and an `actions` slot, where "Why is this
 * here?" sits (kg.provenance).
 */
export function LinkHoverCard({
  link,
  at,
  index = null,
  byId,
  selected = false,
  onClose,
  actions,
}: {
  link: VizLink;
  /** Beside the link (px in the canvas box), or docked at the bottom (the list view). */
  at: { left: number; top: number } | "docked";
  /** Named relations (kg.relations); without, only cause-and-effect links get a card, as before. */
  index?: RelationIndex | null;
  /** Nodes by id, to name the ends before the canvas has drawn them. */
  byId?: ReadonlyMap<string, VizNode>;
  /** Tapped or chosen: an interactive card instead of a hover hint. */
  selected?: boolean;
  onClose?: () => void;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.focus({ preventScroll: true });
  }, [selected, link.id]);
  const ends = linkEnds(link, byId);
  if (!ends) return null;
  if (!link.linkType && !index) return null;
  const [s, t] = ends;

  const RelationIcon = (RELATION_ICONS[link.relation] ?? DEFAULT_RELATION_ICON).icon;
  const relation = index ? linkRelationName(link, index) : null;
  const weak = link.weak || (link.linkType !== null && isWeak(link.confidence));
  const docked = at === "docked";

  return (
    <div
      ref={ref}
      role={selected ? "dialog" : undefined}
      aria-label={selected ? `Link: ${describeLink(link, index, byId)}` : undefined}
      aria-hidden={selected ? undefined : true}
      tabIndex={selected ? -1 : undefined}
      onKeyDown={(e) => {
        if (selected && e.key === "Escape") onClose?.();
      }}
      className={cn(
        "absolute z-20 flex flex-col gap-2 rounded-xl border bg-surface/95 p-3 shadow-panel backdrop-blur outline-none",
        selected ? "border-fg/50" : "pointer-events-none border-line-strong",
        docked && "bottom-4 left-1/2 max-w-[calc(100%-24px)] -translate-x-1/2",
      )}
      style={docked ? { width: CARD_W + 40 } : { left: at.left, top: at.top, width: CARD_W }}
    >
      {relation && (
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-label font-medium text-fg">
            <RelationIcon aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            <span className="truncate">{relation}</span>
          </span>
          {selected && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close link details"
              className="relative ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted before:absolute before:-inset-2 before:content-[''] hover:bg-surface-2 hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}
      {link.linkType ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {link.confidence !== null ? (
            <ConfidenceMeter confidence={link.confidence} linkType={link.linkType} />
          ) : (
            <span className="text-label text-fg-muted">{link.linkType}</span>
          )}
          {weak && <WeakMark label={WEAK_LINK_LABEL} />}
        </div>
      ) : (
        // Other links show their own confidence when they have one, and "?" when weak.
        (link.confidence !== null || weak) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {link.confidence !== null && <ConfidenceMeter confidence={link.confidence} />}
            {weak && <WeakMark label={WEAK_LINK_LABEL} />}
          </div>
        )
      )}
      <p className="flex flex-col gap-0.5 text-label text-fg-muted">
        <span className="line-clamp-2 text-fg">{s.name}</span>
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {link.linkType ? <ArrowRight aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}
          {link.linkType &&
            (index && polarityInfo(link.polarity) ? <PolarityMark polarity={link.polarity} /> : "leads to")}
          {index && <DelayedMark delayed={link.delayed} withWord />}
        </span>
        <span className="line-clamp-2 text-fg">{t.name}</span>
      </p>
      {selected && actions}
    </div>
  );
}
