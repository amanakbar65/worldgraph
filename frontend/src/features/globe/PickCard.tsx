import { ArrowRight, MousePointerClick, Users, X, ZoomIn } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { ForecastRow } from "@/components/ForecastRow";
import { ImpactBadge } from "@/components/ImpactBadge";
import { SampleBadge } from "@/components/SampleBadge";
import { StoryCard } from "@/components/StoryCard";
import { Button } from "@/components/ui/button";
import { IMPACT_ICONS } from "@/lib/icons";
import { IMPACT_TONES } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import type { PickInfo } from "./GlobeMap";
import { GLASS } from "./GlobeControls";
import { countryName, eventAsStory, type GlobeCountry, type GlobeEvent } from "./model";
import { useGlobeHover } from "./store";

export interface PickContext {
  /** Every event on the globe is sample data (no live data yet). */
  allSample: boolean;
  eventsById: ReadonlyMap<string, GlobeEvent>;
  countriesById: ReadonlyMap<string, GlobeCountry>;
}

/** Risk / opportunity / neutral counts, each with its icon. */
export function ImpactCounts({
  risk,
  opportunity,
  neutral,
}: {
  risk: number;
  opportunity: number;
  neutral: number;
}) {
  const parts = (
    [
      ["risk", risk],
      ["opportunity", opportunity],
      ["neutral", neutral],
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-fg-muted">
      {parts.map(([impact, n]) => {
        const Icon = IMPACT_ICONS[impact].icon;
        const tone = IMPACT_TONES[impact];
        return (
          <span key={impact} className="inline-flex items-center gap-1 tabular-nums">
            <Icon aria-hidden className={cn("size-3.5", tone.text)} />
            {n} {tone.label.toLowerCase()}
          </span>
        );
      })}
    </span>
  );
}

function Hint({ icon: Icon, children }: { icon: typeof ArrowRight; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-label text-fg-subtle">
      <Icon aria-hidden className="size-3.5" />
      {children}
    </p>
  );
}

/** What a picked thing is, as a small card built from the UI kit. */
export function PickContent({
  info,
  context,
  hint = true,
}: {
  info: PickInfo;
  context: PickContext;
  hint?: boolean;
}) {
  switch (info.kind) {
    case "event":
      return (
        <>
          <StoryCard story={eventAsStory(info.event, { isSample: context.allSample })} variant="compact" />
          {hint && <Hint icon={MousePointerClick}>Click to open the story</Hint>}
        </>
      );
    case "forecast":
      return (
        <>
          <p className="flex items-center gap-1.5 px-3 pt-3 text-label font-medium text-forecast">
            <Users aria-hidden className="size-3.5" />
            Crowd forecast
          </p>
          <ForecastRow forecast={info.forecast} short className="pt-1.5" />
          {hint && <Hint icon={MousePointerClick}>Click for the details</Hint>}
        </>
      );
    case "arc": {
      const { arc } = info;
      const src = context.eventsById.get(arc.src_story);
      const dst = context.eventsById.get(arc.dst_story);
      return (
        <>
          <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label font-medium text-fg-muted">Cascade link</span>
              <ConfidenceMeter confidence={arc.confidence} linkType={arc.link_type} />
            </div>
            <ol className="flex flex-col gap-1 text-body">
              <li className="flex min-w-0 flex-col">
                <span className="text-label text-fg-subtle">
                  Cause · {countryName(arc.src_country) ?? "Elsewhere"}
                </span>
                <span className="line-clamp-2 text-fg">{src?.headline ?? "An earlier story"}</span>
              </li>
              <li aria-hidden className="text-fg-subtle">
                <ArrowRight className="size-3.5 rotate-90" />
              </li>
              <li className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-label text-fg-subtle">
                  Effect · {countryName(arc.dst_country) ?? "Elsewhere"}
                </span>
                <span className="line-clamp-2 text-fg">{dst?.headline ?? "A later story"}</span>
              </li>
            </ol>
            <ImpactBadge impact={arc.impact} className="self-start" />
          </div>
          {hint && <Hint icon={MousePointerClick}>Click to see the cascade</Hint>}
        </>
      );
    }
    case "hex": {
      const { hex } = info;
      const lead = hex.ids.map((id) => context.eventsById.get(id)).find(Boolean);
      return (
        <>
          <div className="flex flex-col gap-1.5 p-3">
            <p className="text-body font-medium text-fg tabular-nums">
              {hex.count} {hex.count === 1 ? "event" : "events"} in this area
            </p>
            <ImpactCounts risk={hex.risk} opportunity={hex.opportunity} neutral={hex.neutral} />
            {lead && <p className="line-clamp-2 text-label text-fg-muted">Biggest: {lead.headline}</p>}
            {context.allSample && <SampleBadge className="self-start" />}
          </div>
          {hint && <Hint icon={ZoomIn}>Click to zoom in</Hint>}
        </>
      );
    }
    case "country":
    case "state": {
      const stats = info.kind === "country" ? context.countriesById.get(info.id) : undefined;
      return (
        <>
          <div className="flex flex-col gap-1.5 p-3">
            <p className="text-body font-semibold text-fg">{info.name}</p>
            {stats ? (
              <>
                <p className="text-label text-fg-muted tabular-nums">
                  {stats.count} {stats.count === 1 ? "event" : "events"} in this window
                </p>
                <ImpactCounts risk={stats.risk} opportunity={stats.opportunity} neutral={stats.neutral} />
              </>
            ) : (
              <p className="text-label text-fg-muted">
                {info.kind === "country" ? "Nothing new here in this window" : "State or province"}
              </p>
            )}
          </div>
          {hint && <Hint icon={MousePointerClick}>Click to open {info.name}</Hint>}
        </>
      );
    }
  }
}

/**
 * The desktop hover card: follows the pointer, flips to stay inside the map,
 * and never takes the pointer itself. The list view is the keyboard and
 * screen-reader route to the same information.
 */
export function HoverCard({
  context,
  bounds,
}: {
  context: PickContext;
  bounds: { width: number; height: number };
}) {
  const info = useGlobeHover((s) => s.hover);
  return info ? <HoverCardAt info={info} context={context} bounds={bounds} /> : null;
}

function HoverCardAt({
  info,
  context,
  bounds,
}: {
  info: PickInfo;
  context: PickContext;
  bounds: { width: number; height: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 16;
    let left = info.x + gap;
    let top = info.y + gap;
    if (left + w > bounds.width - 8) left = info.x - gap - w;
    if (top + h > bounds.height - 8) top = info.y - gap - h;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [info.x, info.y, info.id, bounds.width, bounds.height]);
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(GLASS, "pointer-events-none absolute z-20 w-80 overflow-hidden rounded-xl")}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <PickContent info={info} context={context} />
    </div>
  );
}

/** Phones: the tapped thing as a card at the bottom, with Open and Close. */
export function SelectionCard({
  info,
  context,
  onOpen,
  onClose,
  className,
}: {
  info: PickInfo;
  context: PickContext;
  onOpen: () => void;
  onClose: () => void;
  className?: string;
}) {
  const openLabel =
    info.kind === "hex"
      ? "Zoom in"
      : info.kind === "arc"
        ? "See the cascade"
        : info.kind === "forecast"
          ? "Details"
          : "Open";
  return (
    <section
      aria-label="Selected on the globe"
      className={cn(GLASS, "overflow-hidden rounded-xl", className)}
    >
      <div className="relative pr-10">
        <PickContent info={info} context={context} hint={false} />
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Clear selection"
          className="absolute top-0 right-0"
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex justify-end border-t border-line p-2">
        <Button size="sm" className="h-10" onClick={onOpen}>
          {openLabel}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
