import { ChevronDown, Info } from "lucide-react";
import { useId, useState } from "react";

import type { EntityType, LinkType } from "@/api/contract";
import { LinkTypeLabel } from "@/components/ConfidenceMeter";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS } from "@/lib/icons";
import { entityTypeTone, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { TYPE_NAMES } from "./graph-data";

export interface GraphLegendProps {
  types: readonly EntityType[];
  linkTypes: readonly LinkType[];
  /** Start open (desktop) or closed (phones). */
  defaultOpen?: boolean;
  className?: string;
}

/** What the colours, shapes and lines mean. Opens and closes; drawn the way the graph draws them. */
export function GraphLegend({ types, linkTypes, defaultOpen = true, className }: GraphLegendProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("rounded-xl border border-line bg-glass shadow-panel backdrop-blur-xl", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-label font-medium text-fg-muted hover:text-fg"
      >
        <Info aria-hidden className="size-4" />
        Key
        <ChevronDown aria-hidden className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div id={id} hidden={!open} className="max-h-[42vh] overflow-y-auto px-3 pb-3">
        <ul aria-label="Kinds of item" className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {types.map((type) => (
            <TypeKey key={type} type={type} />
          ))}
        </ul>
        <ul aria-label="Kinds of link" className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          {linkTypes.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <LinkTypeLabel linkType={t} />
              <span className="text-label text-fg-subtle">cause → effect</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-label text-fg-muted">
            <svg aria-hidden viewBox="0 0 24 4" className="h-1 w-6 shrink-0">
              <line x1="1" x2="23" y1="2" y2="2" className="stroke-fg-subtle" strokeWidth={1} strokeOpacity={0.6} />
            </svg>
            Other links (located in, mentions…)
          </li>
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-label text-fg-muted">Bigger means more connections.</p>
      </div>
    </div>
  );
}

function TypeKey({ type }: { type: EntityType }) {
  if (type === "story") {
    return (
      <li className="col-span-2 flex items-center gap-1.5 text-label text-fg-muted">
        <span aria-hidden className="inline-flex items-center gap-1">
          {(["risk", "opportunity", "neutral"] as const).map((impact) => {
            const Icon = IMPACT_ICONS[impact].icon;
            return <Icon key={impact} className={cn("size-3.5", impactTone(impact).text)} />;
          })}
        </span>
        Story dot: risk, opportunity or neutral
      </li>
    );
  }
  const tone = entityTypeTone(type);
  const Icon = (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.story).icon;
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-label text-fg-muted">
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          type === "forecast" ? "border-2 border-forecast" : cn("border", tone.border, tone.tint),
        )}
      >
        <Icon className={cn("size-3", tone.text)} />
      </span>
      <span className="truncate">{TYPE_NAMES[type]?.one ?? type}</span>
    </li>
  );
}
