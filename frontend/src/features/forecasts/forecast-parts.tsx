/**
 * Pieces shared by the forecasts view and the forecast panel: the crowd
 * label, the play-money and thin-market tags, the figures (24-hour change,
 * volume), a list row, a mover card and a related-story row.
 */
import { ChevronRight, Coins, Users } from "lucide-react";
import type { ReactNode } from "react";

import type { ForecastSummary, StorySummary } from "@/api/contract";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { Sparkline } from "@/components/Sparkline";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { formatPointChange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DraftLabel, ImpactTile, ImpactWord } from "@/features/story/story-parts";

import {
  CATEGORIES,
  changeWords,
  forecastLabel,
  isBigMove,
  moneyKind,
  sparklineDomain,
  volumeParts,
  volumeText,
} from "./forecast-data";

// ---------------------------------------------------------------------------
// Labels and tags
// ---------------------------------------------------------------------------

/** "Crowd forecast" with the crowd icon, in the forecast colour. */
export function CrowdLabel({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium whitespace-nowrap text-forecast", className)}>
      <Users aria-hidden className="size-3.5" />
      Crowd forecast
    </span>
  );
}

/** Marks play-money sources (Manifold), so they are never mistaken for cash markets. */
export function PlayMoneyTag({ className }: { className?: string }) {
  return (
    <Chip tone="outline" className={cn("h-5 px-1.5", className)} title="Forecasters use a virtual currency, not cash">
      <Coins aria-hidden className="size-3" />
      Play money
    </Chip>
  );
}

/** Low volume or liquidity: the number can swing on a few forecasts. */
export function ThinTag({ className }: { className?: string }) {
  return (
    <span
      title="Few forecasters and little volume: this number can swing easily"
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-line-strong px-1.5 whitespace-nowrap text-fg-muted",
        className,
      )}
    >
      Thin market
    </span>
  );
}

/** "▲ 16" with words for screen readers; a dash when the provider gives no change. */
export function ChangeFigure({ change, className }: { change: number | null; className?: string }) {
  const big = isBigMove(change);
  return (
    <span className={cn("tabular-nums whitespace-nowrap", big ? "font-semibold text-fg" : "text-fg-muted", className)}>
      <span aria-hidden>{change === null ? "–" : formatPointChange(change)}</span>
      <span className="sr-only">{changeWords(change)}</span>
    </span>
  );
}

/** "412K" with its unit after it in a quieter tone ("48K MANA"). */
export function VolumeFigure({ forecast, className }: { forecast: ForecastSummary; className?: string }) {
  const parts = volumeParts(forecast);
  if (!parts) return <span className={cn("text-fg-muted", className)}>Not reported</span>;
  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      <span className="text-fg">{parts.value}</span>
      {parts.unit && <span className="text-label text-fg-muted"> {parts.unit}</span>}
    </span>
  );
}

/** The forecast's 30-day trend, on a range that keeps small wobbles small. */
export function ForecastSparkline({ forecast, className }: { forecast: ForecastSummary; className?: string }) {
  return (
    <Sparkline
      values={forecast.sparkline}
      tone={forecast.thin ? "muted" : "forecast"}
      domain={sparklineDomain(forecast.sparkline)}
      className={className}
    />
  );
}

/**
 * One quiet line under a forecast's title: the crowd label, category,
 * provider (and play money), last update, thin market and sample marks.
 */
export function ForecastMeta({
  forecast,
  showCategory = true,
  className,
}: {
  forecast: ForecastSummary;
  showCategory?: boolean;
  className?: string;
}) {
  const category = CATEGORIES[forecast.category];
  const CategoryIcon = category?.icon;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted", className)}>
      <CrowdLabel />
      {showCategory && category && CategoryIcon && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <CategoryIcon aria-hidden className="size-3.5" />
            {category.label}
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="whitespace-nowrap">{forecast.provider_name}</span>
      {moneyKind(forecast) === "play" && <PlayMoneyTag />}
      {forecast.updated_at && (
        <>
          <span aria-hidden>·</span>
          <TimeAgo value={forecast.updated_at} prefix="Updated" className="whitespace-nowrap" />
        </>
      )}
      {forecast.thin && <ThinTag />}
      {forecast.is_sample && <SampleBadge iconOnly />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

/** The grid shared by the list's header and its rows. */
export const ROW_GRID =
  "grid grid-cols-[2.75rem_minmax(0,1fr)_4rem] md:grid-cols-[2.75rem_minmax(0,1fr)_7rem_4.5rem_5.5rem_5.5rem_1rem]";

/** Column titles over the list (wide screens; each row's name says it all to screen readers). */
export function ListHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        ROW_GRID,
        "hidden items-end gap-x-4 border-b border-line px-3 pt-3 pb-2 text-label text-fg-subtle md:grid",
      )}
    >
      <span />
      <span>Question</span>
      <span>Last 30 days</span>
      <span className="text-right">24 h</span>
      <span className="text-right">Volume</span>
      <span className="text-right">Ends</span>
      <span />
    </div>
  );
}

/**
 * One crowd forecast in the list: ring, title, the crowd label with its
 * source and last update, the trend, the 24-hour change, volume and end.
 * The whole row opens the forecast.
 */
export function ForecastListRow({
  forecast,
  now,
  selected = false,
  onOpen,
}: {
  forecast: ForecastSummary;
  now: number;
  selected?: boolean;
  onOpen: (forecast: ForecastSummary) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(forecast)}
        aria-label={forecastLabel(forecast, now)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          ROW_GRID,
          "group w-full cursor-pointer items-center gap-x-3 gap-y-1 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-2/70 md:gap-x-4",
          "aria-[current=true]:bg-surface-2",
        )}
      >
        <span className={cn("row-span-2 self-start md:row-span-1 md:self-center", forecast.thin && "opacity-60")}>
          <ProbabilityRing size="sm" probability={forecast.probability} />
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-body font-medium text-fg">{forecast.short_title}</span>
          <ForecastMeta forecast={forecast} className="hidden md:flex" />
        </span>

        <ForecastSparkline forecast={forecast} className="h-8 w-full self-center md:h-9" />

        {/* Phones: the figures and the meta line sit under the title. */}
        <span className="col-start-2 col-end-4 flex flex-col gap-1 md:hidden">
          <span className="flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
            <ChangeFigure change={forecast.change_24h} />
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{volumeText(forecast)}</span>
            {forecast.end_date && (
              <>
                <span aria-hidden>·</span>
                <TimeAgo value={forecast.end_date} prefix="Ends" pastPrefix="Ended" className="whitespace-nowrap" />
              </>
            )}
          </span>
          <ForecastMeta forecast={forecast} showCategory={false} />
        </span>

        <ChangeFigure change={forecast.change_24h} className="hidden text-right text-body md:block" />
        <VolumeFigure forecast={forecast} className="hidden text-right text-body md:block" />
        <span className="hidden text-right text-body whitespace-nowrap text-fg-muted md:block">
          {forecast.end_date ? <TimeAgo value={forecast.end_date} /> : "Open"}
        </span>
        <ChevronRight
          aria-hidden
          className="hidden size-4 text-fg-subtle transition-colors group-hover:text-fg-muted md:block"
        />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mover card
// ---------------------------------------------------------------------------

/** A big 24-hour move: the ring with its change, the title and the source. */
export function MoverCard({
  forecast,
  now,
  onOpen,
  className,
}: {
  forecast: ForecastSummary;
  now: number;
  onOpen: (forecast: ForecastSummary) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(forecast)}
      aria-label={forecastLabel(forecast, now)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-4 rounded-xl border border-forecast/25 bg-surface p-4 text-left transition-colors hover:border-forecast/50 hover:bg-surface-2/60",
        className,
      )}
    >
      <ProbabilityRing
        size="md"
        probability={forecast.probability}
        change24h={forecast.change_24h}
        glow={isBigMove(forecast.change_24h)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <CrowdLabel className="text-label" />
        <span className="line-clamp-3 text-body font-medium text-fg">{forecast.short_title}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted">
          <span className="whitespace-nowrap">{forecast.provider_name}</span>
          {moneyKind(forecast) === "play" && <PlayMoneyTag />}
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{volumeText(forecast)}</span>
          {forecast.updated_at && (
            <>
              <span aria-hidden>·</span>
              <TimeAgo value={forecast.updated_at} prefix="Updated" className="whitespace-nowrap" />
            </>
          )}
          {forecast.is_sample && <SampleBadge iconOnly />}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Related story row (panel)
// ---------------------------------------------------------------------------

/**
 * A story linked to the forecast. Drafts from the live feed show their
 * source headline and a "Draft · awaiting analysis" label, never a summary.
 */
export function StoryRow({
  story,
  onOpen,
  children,
}: {
  story: StorySummary;
  onOpen: (id: string) => void;
  /** Extra lines under the headline (e.g. the link that leads to it). */
  children?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(story.id)}
        className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
      >
        <ImpactTile impact={story.analysed ? story.impact : "neutral"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
          {children}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted">
            {story.analysed ? <ImpactWord impact={story.impact} direction={story.direction} /> : <DraftLabel />}
            {story.region && (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{story.region.name}</span>
              </>
            )}
            {story.kind === "projected" ? (
              <>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">Possible effect</span>
              </>
            ) : (
              story.first_seen && (
                <>
                  <span aria-hidden>·</span>
                  <TimeAgo value={story.first_seen} className="whitespace-nowrap" />
                </>
              )
            )}
            {story.is_sample && <SampleBadge iconOnly />}
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-2.5 size-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}
