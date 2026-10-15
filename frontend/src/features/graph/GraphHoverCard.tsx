import { ArrowRight } from "lucide-react";

import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { ImpactBadge } from "@/components/ImpactBadge";
import { SampleBadge } from "@/components/SampleBadge";
import { ENTITY_TYPE_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { CARD_W, TYPE_NAMES, type VizLink, type VizNode } from "./graph-data";

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

/** A cause-and-effect link: how it is known, how sure, and which way it runs. */
export function LinkHoverCard({ link, at }: { link: VizLink; at: { left: number; top: number } }) {
  const s = link.source as VizNode;
  const t = link.target as VizNode;
  if (!link.linkType || typeof s !== "object" || typeof t !== "object") return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 flex flex-col gap-2 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-panel backdrop-blur"
      style={{ left: at.left, top: at.top, width: CARD_W }}
    >
      {link.confidence !== null ? (
        <ConfidenceMeter confidence={link.confidence} linkType={link.linkType} />
      ) : (
        <span className="text-label text-fg-muted">{link.linkType}</span>
      )}
      <p className="flex flex-col gap-0.5 text-label text-fg-muted">
        <span className="line-clamp-2 text-fg">{s.name}</span>
        <span className="inline-flex items-center gap-1">
          <ArrowRight className="size-3.5" />
          leads to
        </span>
        <span className="line-clamp-2 text-fg">{t.name}</span>
      </p>
    </div>
  );
}
