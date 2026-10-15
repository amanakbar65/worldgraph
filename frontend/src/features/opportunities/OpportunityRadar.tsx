import { List, Radar, Sparkles, Target, Telescope, Users } from "lucide-react";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";

import type { SectorId } from "@/api/contract";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatProbability } from "@/lib/format";
import { SECTORS } from "@/lib/icons";
import { cn } from "@/lib/utils";

import {
  describeItem,
  primarySector,
  radarCaption,
  radarInputs,
  rimLabel,
  scoreNames,
  textWidth,
  wedgeCounts,
  type OpportunityItem,
} from "./opportunity-data";
import {
  R_INNER,
  RING_VALUES,
  labelArc,
  labelArcLength,
  layoutRadar,
  polar,
  radiusFor,
  wedgePath,
  wedgesFor,
  type RadarMeasure,
} from "./radar";
import { useWidth } from "./use-width";

/** Half the chart's width, in radar units (the rim is 1): room for the names around it. */
const EXTENT = 1.17;
const LABEL_PX = 12;

export interface OpportunityRadarProps {
  items: readonly OpportunityItem[];
  /** The wedges, in order (the sector lens, or all nine). */
  sectors: readonly SectorId[];
  /** The profile's sectors: their wedges are shaded and their names bold. */
  yours: readonly SectorId[];
  /** Is the list ranked by fit to the profile? Changes the words, not the maths. */
  forYou: boolean;
  measure: RadarMeasure;
  onMeasure: (measure: RadarMeasure) => void;
  view: "chart" | "list";
  onView: (view: "chart" | "list") => void;
  /** The story under the pointer or keyboard (shared with the cards). */
  active: string | null;
  onActive: (id: string | null) => void;
  onOpen: (id: string) => void;
}

/**
 * The opportunity radar: one wedge per sector, one dot per opening.
 * Distance from the centre shows fit (or momentum), the dot's size the
 * other score. Dashed dots are projections; a violet ring marks a related
 * crowd forecast. A plain list shows the same, for screen readers and for
 * anyone who prefers it.
 */
export function OpportunityRadar(props: OpportunityRadarProps) {
  const { forYou, measure, onMeasure, view, onView } = props;
  const headingId = useId();
  const names = scoreNames(forYou);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <SectionHeader
        id={headingId}
        title="Opportunity radar"
        icon={Radar}
        description={radarCaption(measure, forYou)}
        action={
          <Segmented<"chart" | "list">
            aria-label="Show the radar as"
            size="sm"
            value={view}
            onValueChange={onView}
            options={[
              { value: "chart", label: "Chart", icon: Radar },
              { value: "list", label: "List", icon: List },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-label text-fg-muted">Closer to the centre means</span>
        <Segmented<RadarMeasure>
          aria-label="Closer to the centre means"
          size="sm"
          value={measure}
          onValueChange={onMeasure}
          options={[
            { value: "relevance", label: forYou ? "Better fit" : "More important", ariaLabel: names.relevance },
            { value: "momentum", label: "Faster moving", ariaLabel: names.momentum },
          ]}
        />
      </div>
      {view === "chart" ? <RadarChart {...props} /> : <RadarList {...props} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

function RadarChart({ items, sectors, yours, forYou, measure, active, onActive, onOpen }: OpportunityRadarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const pxPerUnit = width ? width / (2 * EXTENT) : 200;
  const font = LABEL_PX / pxPerUnit;
  const labelRadius = 1.035 + font * 0.55;

  const wedges = useMemo(() => wedgesFor(sectors), [sectors]);
  const inputs = useMemo(() => radarInputs(items, sectors), [items, sectors]);
  // Small charts (phones) get bigger dots, so they stay easy to see and tap.
  const dotScale = Math.round(Math.min(1.4, Math.max(1, 200 / pxPerUnit)) * 10) / 10;
  const dots = useMemo(
    () => layoutRadar(inputs, sectors, measure, dotScale),
    [inputs, sectors, measure, dotScale],
  );
  const counts = wedgeCounts(inputs);
  const byId = useMemo(() => new Map(items.map((item, i) => [item.story.id, { item, rank: i + 1 }])), [items]);
  const refs = useRef(new Map<string, SVGGElement>());
  const focusId = active && dots.some((d) => d.id === active) ? active : (dots[0]?.id ?? null);
  const shown = (active ? byId.get(active) : undefined) ?? (dots[0] ? byId.get(dots[0].id) : undefined);
  const unplaced = items.length - dots.length;

  const move = (from: string, step: number | "first" | "last") => {
    const at = dots.findIndex((d) => d.id === from);
    const next =
      step === "first" ? dots[0] : step === "last" ? dots[dots.length - 1] : dots[(at + step + dots.length) % dots.length];
    if (!next) return;
    onActive(next.id);
    refs.current.get(next.id)?.focus();
  };

  const onKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    const keys: Record<string, number | "first" | "last"> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: "first",
      End: "last",
    };
    if (e.key in keys) {
      e.preventDefault();
      move(id, keys[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={boxRef} className="relative mx-auto aspect-square w-full max-w-[34rem]">
        <svg
          viewBox={`${-EXTENT} ${-EXTENT} ${EXTENT * 2} ${EXTENT * 2}`}
          className="absolute inset-0 size-full select-none"
          role="group"
          aria-label={`Opportunity radar, ${dots.length} ${dots.length === 1 ? "opening" : "openings"} by sector. Arrow keys move between them; Enter opens one.`}
          onMouseLeave={() => onActive(null)}
        >
          <g aria-hidden>
            {wedges.map((w) => (
              <path
                key={w.sector}
                d={wedgePath(w, R_INNER, 1)}
                className={
                  yours.includes(w.sector)
                    ? "fill-fg/[0.08]"
                    : w.index % 2
                      ? "fill-surface-2/80"
                      : "fill-surface-2/40"
                }
              />
            ))}
            {RING_VALUES.map((v) => (
              <circle
                key={v}
                r={radiusFor(v)}
                className="fill-none stroke-line-strong"
                strokeWidth={1}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <circle r={1} className="fill-none stroke-line-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {wedges.length > 1 &&
              wedges.map((w) => {
                const a = polar(w.start, R_INNER);
                const b = polar(w.start, 1);
                return (
                  <line
                    key={w.sector}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className="stroke-line-strong"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            <circle
              r={R_INNER}
              className="fill-bg-sunken stroke-line-strong"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <Target x={-0.065} y={-0.065} width={0.13} height={0.13} className="text-fg-muted" />
            {wedges.map((w) => {
              const n = counts[w.sector] ?? 0;
              const room = labelArcLength(w, labelRadius) * pxPerUnit - textWidth(` ${n}`, LABEL_PX);
              const mine = yours.includes(w.sector);
              return (
                <g key={w.sector}>
                  <path id={`${uid}-rim-${w.sector}`} d={labelArc(w, labelRadius)} fill="none" />
                  <text
                    fontSize={font}
                    dominantBaseline="central"
                    className={cn(mine ? "fill-fg font-semibold" : "fill-fg-muted")}
                  >
                    <textPath href={`#${uid}-rim-${w.sector}`} startOffset="50%" textAnchor="middle">
                      {rimLabel(w.sector, room, LABEL_PX)}
                      <tspan className="fill-fg-subtle font-normal"> {n}</tspan>
                    </textPath>
                  </text>
                </g>
              );
            })}
          </g>
          <g>
            {/* Drawn last = on top: the first-ranked dots win any overlap. */}
            {[...dots].reverse().map((dot) => {
              const entry = byId.get(dot.id);
              if (!entry) return null;
              const { item } = entry;
              const on = dot.id === active;
              const projected = item.story.kind === "projected";
              const draft = !item.story.analysed;
              return (
                <g
                  key={dot.id}
                  ref={(el) => {
                    if (el) refs.current.set(dot.id, el);
                    else refs.current.delete(dot.id);
                  }}
                  role="button"
                  tabIndex={dot.id === focusId ? 0 : -1}
                  aria-label={`${entry.rank}. ${describeItem(item, dot.sector, forYou)}`}
                  transform={`translate(${dot.x.toFixed(4)} ${dot.y.toFixed(4)})`}
                  onClick={() => onOpen(dot.id)}
                  onKeyDown={(e) => onKey(e, dot.id)}
                  onFocus={() => onActive(dot.id)}
                  onMouseEnter={() => onActive(dot.id)}
                  className="cursor-pointer outline-none"
                >
                  {/* A bigger, invisible target for fingers. */}
                  <circle r={Math.max(dot.r + 0.02, 0.05)} fill="transparent" />
                  {item.forecast && (
                    <circle
                      r={dot.r + 0.016}
                      className="fill-none stroke-forecast"
                      strokeWidth={1.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <circle
                    r={dot.r}
                    strokeWidth={projected || draft ? 1.5 : 1}
                    strokeDasharray={projected || draft ? "2 2" : undefined}
                    vectorEffect="non-scaling-stroke"
                    className={cn(
                      "transition-opacity duration-200",
                      draft
                        ? "fill-surface stroke-fg-muted"
                        : projected
                          ? "fill-opportunity/25 stroke-opportunity"
                          : "fill-opportunity stroke-surface",
                      active && !on && "opacity-55",
                    )}
                  />
                  {on && (
                    <circle
                      r={dot.r + (item.forecast ? 0.034 : 0.02)}
                      className="fill-none stroke-fg"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {shown && <ActiveStrip item={shown.item} rank={shown.rank} sectors={sectors} forYou={forYou} onOpen={onOpen} />}

      <Legend showYours={yours.length > 0} />
      {unplaced > 0 && (
        <p className="text-label text-fg-muted">
          {unplaced} {unplaced === 1 ? "opening has" : "openings have"} no sector yet, so{" "}
          {unplaced === 1 ? "it is" : "they are"} only in the list.
        </p>
      )}
    </div>
  );
}

/** The opening under the pointer (or the top one): what it is, and a way in. */
function ActiveStrip({
  item,
  rank,
  sectors,
  forYou,
  onOpen,
}: {
  item: OpportunityItem;
  rank: number;
  sectors: readonly SectorId[];
  forYou: boolean;
  onOpen: (id: string) => void;
}) {
  const sector = primarySector(item.story, sectors);
  const names = scoreNames(forYou);
  const SectorIcon = sector ? SECTORS[sector].icon : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(item.story.id)}
      className="flex min-h-[4.5rem] w-full cursor-pointer items-start gap-3 rounded-lg border border-line bg-bg-sunken/60 p-3 text-left transition-colors hover:border-line-strong"
    >
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-label font-semibold text-fg tabular-nums"
      >
        {rank}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-body font-medium text-fg">{item.story.headline}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label text-fg-muted tabular-nums">
          {SectorIcon && sector && (
            <span className="inline-flex items-center gap-1">
              <SectorIcon aria-hidden className="size-3.5" />
              {SECTORS[sector].label}
            </span>
          )}
          <span>
            {names.relevance} {formatProbability(item.relevance)}
          </span>
          <span>
            {names.momentum} {formatProbability(item.momentum)}
          </span>
          {item.forecast && (
            <span className="inline-flex items-center gap-1 text-forecast">
              <Users aria-hidden className="size-3.5" />
              {formatProbability(item.forecast.probability)} crowd forecast
            </span>
          )}
          {item.story.is_sample && <SampleBadge iconOnly />}
        </span>
      </span>
    </button>
  );
}

function Legend({ showYours }: { showYours: boolean }) {
  return (
    <ul aria-label="Key" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-label text-fg-muted">
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 12 12" className="size-3">
          <circle cx="6" cy="6" r="5" className="fill-opportunity" />
        </svg>
        <Sparkles aria-hidden className="size-3.5 text-opportunity" />
        Opportunity
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 12 12" className="size-3">
          <circle
            cx="6"
            cy="6"
            r="4.75"
            strokeWidth="1.5"
            strokeDasharray="2 2"
            className="fill-opportunity/25 stroke-opportunity"
          />
        </svg>
        <Telescope aria-hidden className="size-3.5" />
        Projected
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 14 14" className="size-3.5">
          <circle cx="7" cy="7" r="3.5" className="fill-opportunity" />
          <circle cx="7" cy="7" r="6" strokeWidth="1.25" className="fill-none stroke-forecast" />
        </svg>
        <Users aria-hidden className="size-3.5 text-forecast" />
        Has a crowd forecast
      </li>
      {showYours && (
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm border border-line-strong bg-fg/10" />
          Your sectors
        </li>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The same, as a list
// ---------------------------------------------------------------------------

function RadarList({ items, sectors, forYou, onOpen, active, onActive }: OpportunityRadarProps) {
  const names = scoreNames(forYou);
  return (
    <ol aria-label="Openings, best first" className="-mx-2 flex max-h-[36rem] flex-col overflow-y-auto">
      {items.map((item, i) => {
        const sector = primarySector(item.story, sectors) ?? item.story.sectors[0] ?? null;
        const SectorIcon = sector ? SECTORS[sector].icon : null;
        return (
          <li key={item.story.id} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(item.story.id)}
              onMouseEnter={() => onActive(item.story.id)}
              onFocus={() => onActive(item.story.id)}
              className={cn(
                "flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2/70",
                active === item.story.id && "bg-surface-2/70",
              )}
            >
              <span className="w-5 shrink-0 pt-px text-right text-label text-fg-subtle tabular-nums">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-body text-fg">{item.story.headline}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-label text-fg-muted tabular-nums">
                  {SectorIcon && sector && (
                    <span className="inline-flex items-center gap-1">
                      <SectorIcon aria-hidden className="size-3.5" />
                      {SECTORS[sector].label}
                    </span>
                  )}
                  {item.story.kind === "projected" && (
                    <span className="inline-flex items-center gap-1">
                      <Telescope aria-hidden className="size-3.5" />
                      Projected
                    </span>
                  )}
                  <span>
                    {names.relevance} {formatProbability(item.relevance)}
                  </span>
                  <span>
                    {names.momentum} {formatProbability(item.momentum)}
                  </span>
                  {item.forecast && (
                    <span className="inline-flex items-center gap-1 text-forecast">
                      <Users aria-hidden className="size-3.5" />
                      {formatProbability(item.forecast.probability)}
                      <span className="sr-only"> crowd forecast</span>
                    </span>
                  )}
                  {item.story.is_sample && <SampleBadge iconOnly />}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** While the first answer loads. */
export function RadarSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the radar"
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3 w-3/4" />
      <div className="mx-auto aspect-square w-4/5 max-w-[26rem] rounded-full border border-line p-[12%]">
        <Skeleton className="size-full rounded-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}
