import { ArrowRight, MousePointerClick, Users, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { StorySummary } from "@/api/contract";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { ForecastRow } from "@/components/ForecastRow";
import { ImpactBadge } from "@/components/ImpactBadge";
import { StoryCard } from "@/components/StoryCard";
import { Button } from "@/components/ui/button";
import { WeakMark } from "@/components/WeakMark";
import { useWhyAvailable } from "@/features/provenance/use-why";
import { WhyButton } from "@/features/provenance/WhyButton";
import { IMPACT_ICONS } from "@/lib/icons";
import { IMPACT_TONES, WEAK_LINK_LABEL, balanceLean } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import type { PickInfo } from "./GlobeMap";
import { GLASS } from "./GlobeControls";
import {
  arcTrust,
  countryName,
  storyForEvent,
  type GlobeCountry,
  type GlobeEvent,
  type GlobeSample,
} from "./model";
import { useGlobeHover } from "./store";
import { DraftNote } from "./TopNow";

export interface PickContext {
  /** Sample data on the globe: all of it (no live data yet), some (beside live news), or none. */
  sample: GlobeSample;
  eventsById: ReadonlyMap<string, GlobeEvent>;
  countriesById: ReadonlyMap<string, GlobeCountry>;
  /** Full stories another call already sent (the Top 5), by id. */
  knownStories?: ReadonlyMap<string, StorySummary>;
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

/**
 * Which way a country's news leans, as the shading shows it: ▲ towards
 * opportunity (teal), ▼ towards risk (amber), with words, so colour is
 * never alone.
 */
export function BalanceLine({ score }: { score: number }) {
  const lean = balanceLean(score);
  const tone = IMPACT_TONES[lean.impact];
  return (
    <p className={cn("flex items-center gap-1.5 text-label font-medium", tone.text)}>
      {lean.glyph && <span aria-hidden>{lean.glyph}</span>}
      {lean.label}
    </p>
  );
}

/** A cascade arc in words, for its "Why is this here?" button: "Cause, leads to, effect". */
function arcWords(arc: Extract<PickInfo, { kind: "arc" }>["arc"], context: PickContext): string {
  const src = context.eventsById.get(arc.src_story)?.headline ?? "An earlier story";
  const dst = context.eventsById.get(arc.dst_story)?.headline ?? "a later story";
  return `${src}, leads to, ${dst}`;
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
  // With "Why is this here?" on, a desktop click pins an arc's card (its sources and the cascade).
  const whyOn = useWhyAvailable();
  switch (info.kind) {
    case "event":
      return (
        <>
          <StoryCard
            story={storyForEvent(info.event, context.sample, context.knownStories)}
            variant="compact"
          />
          {info.event.analysed === false && <DraftNote className="-mt-1.5 pb-2 pl-14" />}
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
      const weak = arcTrust(arc).weak;
      return (
        <>
          <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label font-medium text-fg-muted">Cascade link</span>
              <ConfidenceMeter confidence={arc.confidence} linkType={arc.link_type} />
              {weak && <WeakMark label={WEAK_LINK_LABEL} />}
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
          {hint && (
            <Hint icon={MousePointerClick}>
              {whyOn ? "Click for its sources and the cascade" : "Click to see the cascade"}
            </Hint>
          )}
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
                <BalanceLine score={stats.score} />
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

type Bounds = { width: number; height: number };
type Place = { left: number; top: number };

/**
 * Where a card at the pointer goes: below and right of it, flipped to stay
 * inside the map, never off its top or left edge. Off-screen until measured,
 * so the first frame doesn't flash in the wrong place.
 */
function usePlaceAtPointer(ref: RefObject<HTMLElement | null>, info: PickInfo, bounds: Bounds): Place {
  const [pos, setPos] = useState<Place | null>(null);
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
  }, [ref, info.x, info.y, info.id, bounds.width, bounds.height]);
  return pos ?? { left: -9999, top: -9999 };
}

/**
 * The desktop hover card: follows the pointer, flips to stay inside the map,
 * and never takes the pointer itself. The list view is the keyboard and
 * screen-reader route to the same information.
 */
export function HoverCard({
  context,
  bounds,
  exceptId,
}: {
  context: PickContext;
  bounds: Bounds;
  /** The pinned card's item: pointing at it again shows no second card. */
  exceptId?: string;
}) {
  const info = useGlobeHover((s) => s.hover);
  return info && info.id !== exceptId ? <HoverCardAt info={info} context={context} bounds={bounds} /> : null;
}

function HoverCardAt({ info, context, bounds }: { info: PickInfo; context: PickContext; bounds: Bounds }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePlaceAtPointer(ref, info, bounds);
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(GLASS, "pointer-events-none absolute z-20 w-80 overflow-hidden rounded-xl")}
      style={pos}
    >
      <PickContent info={info} context={context} />
    </div>
  );
}

/**
 * Desktop, with "Why is this here?" on: a clicked cascade arc's card, pinned
 * where it was clicked, with "Why is this here?" beside "See the cascade".
 * The phone's selection card, placed like the hover card.
 */
export function PinnedCard({
  info,
  context,
  bounds,
  onOpen,
  onClose,
}: {
  info: PickInfo;
  context: PickContext;
  bounds: Bounds;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePlaceAtPointer(ref, info, bounds);
  return (
    // A little wider than the hover card, so its two buttons share one row.
    <div ref={ref} className="pointer-events-auto absolute z-20 w-[22rem]" style={pos}>
      <SelectionCard info={info} context={context} onOpen={onOpen} onClose={onClose} />
    </div>
  );
}

/** Phones: the tapped thing as a card at the bottom, with Open and Close (desktop: a clicked arc, pinned). */
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
  const openLabel = info.kind === "arc" ? "See the cascade" : info.kind === "forecast" ? "Details" : "Open";
  const whyOn = useWhyAvailable();
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
      <div className="flex flex-wrap justify-end gap-2 border-t border-line p-2">
        {info.kind === "arc" && whyOn && (
          // Where this cause-and-effect link comes from; Back returns to this card.
          <WhyButton
            target="link"
            id={info.arc.id}
            subject={arcWords(info.arc, context)}
            weak={arcTrust(info.arc).weak}
            className="h-10"
          />
        )}
        <Button size="sm" className="h-10" onClick={onOpen}>
          {openLabel}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
