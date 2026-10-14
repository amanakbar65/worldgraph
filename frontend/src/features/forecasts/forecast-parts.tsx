/**
 * Pieces shared by the forecasts view and the forecast panel: the crowd
 * label, the play-money and thin-market tags, the figures (24-hour change,
 * volume, the countdown to the end), a list row, a mover card and a
 * related-story row.
 */
import { ChevronRight, Coins, Users } from "lucide-react";
import { Children, type ReactNode } from "react";

import type { ForecastSummary, StorySummary } from "@/api/contract";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { Sparkline } from "@/components/Sparkline";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { DraftLabel, ImpactTile, ImpactWord } from "@/features/story/story-parts";
import { formatPointChange } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import {
  CATEGORIES,
  changeWords,
  endInfo,
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

/**
 * A quiet line of facts separated by small dots. Each fact stays whole, and
 * when the line wraps no row starts or ends with a dot: every item draws
 * the dot before it, and the first item of each row has its dot clipped.
 */
export function MetaList({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  return (
    <span className={cn("flex min-w-0 overflow-hidden text-label text-fg-muted", className)}>
      <span className="-ml-3 flex min-w-0 flex-wrap items-center gap-y-1">
        {items.map((item, i) => (
          <span
            key={i}
            className={cn(
              "relative inline-flex min-w-0 items-center gap-1.5 pl-3 whitespace-nowrap empty:hidden",
              "before:absolute before:top-1/2 before:left-[4.5px] before:size-[3px] before:-translate-y-1/2 before:rounded-full before:bg-fg-subtle before:content-['']",
            )}
          >
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

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

/** "in 23 d", "in 3 mo" or "Ended", with the full date and time as its tooltip; "Open" with no end date. */
export function EndsFigure({
  end,
  now,
  prefix,
  className,
}: {
  end: string | null;
  now: number;
  /** Words before the countdown, e.g. "Ends" → "Ends in 23 d". */
  prefix?: string;
  className?: string;
}) {
  const info = endInfo(end, now);
  if (!info || !end) return <span className={cn("whitespace-nowrap", className)}>{prefix ? "No end date" : "Open"}</span>;
  return (
    <time dateTime={end} title={formatDateTime(end)} className={cn("tabular-nums whitespace-nowrap", className)}>
      {prefix && !info.ended ? `${prefix} ${info.short}` : info.short}
    </time>
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

/** The provider's name with its play-money or sample mark, kept together. */
export function ProviderName({ forecast }: { forecast: ForecastSummary }) {
  return (
    <>
      <span>{forecast.provider_name}</span>
      {moneyKind(forecast) === "play" && <PlayMoneyTag />}
      {forecast.is_sample && <SampleBadge iconOnly />}
    </>
  );
}

/**
 * One quiet line under a forecast's title: the crowd label, category,
 * provider (with play money or sample marks), last update and thin market.
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
    <MetaList className={className}>
      <CrowdLabel />
      {showCategory && category && CategoryIcon && (
        <>
          <CategoryIcon aria-hidden className="-mr-0.5 size-3.5" />
          {category.label}
        </>
      )}
      <ProviderName forecast={forecast} />
      {forecast.updated_at && <TimeAgo value={forecast.updated_at} prefix="Updated" />}
      {forecast.thin && <ThinTag />}
    </MetaList>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

/**
 * The grid shared by the list's header and its rows. It follows the list's
 * own width (a container query), so rows stay roomy when a side panel
 * narrows the screen: narrow lists stack the figures under the title.
 */
export const ROW_GRID =
  "grid grid-cols-[2.75rem_minmax(0,1fr)_4rem] @3xl:grid-cols-[2.75rem_minmax(0,1fr)_4.5rem_3.5rem_5.5rem_4.5rem_1rem]";

/** Column titles over the list (wide lists; each row's name says it all to screen readers). */
export function ListHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        ROW_GRID,
        "hidden items-end gap-x-3 border-b border-line px-3 pt-3 pb-2 text-label text-fg-muted @3xl:grid",
      )}
    >
      <span />
      <span>Question</span>
      <span>30 days</span>
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
          "group w-full cursor-pointer items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-2/70",
          "aria-[current=true]:bg-surface-2",
        )}
      >
        <span className={cn("row-span-2 self-start @3xl:row-span-1 @3xl:self-center", forecast.thin && "opacity-60")}>
          <ProbabilityRing size="sm" probability={forecast.probability} />
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-body font-medium text-fg">{forecast.short_title}</span>
          <ForecastMeta forecast={forecast} className="hidden @3xl:flex" />
        </span>

        <ForecastSparkline forecast={forecast} className="h-8 w-full self-center @3xl:h-9" />

        {/* Narrow lists: the figures and the meta line sit under the title. */}
        <span className="col-start-2 col-end-4 flex min-w-0 flex-col gap-1 @3xl:hidden">
          <MetaList>
            <ChangeFigure change={forecast.change_24h} />
            {volumeText(forecast)}
            <EndsFigure end={forecast.end_date} now={now} prefix="Ends" />
          </MetaList>
          <ForecastMeta forecast={forecast} showCategory={false} />
        </span>

        <ChangeFigure change={forecast.change_24h} className="hidden text-right text-body @3xl:block" />
        <VolumeFigure forecast={forecast} className="hidden text-right text-body @3xl:block" />
        <EndsFigure end={forecast.end_date} now={now} className="hidden text-right text-body text-fg-muted @3xl:block" />
        <ChevronRight
          aria-hidden
          className="hidden size-4 text-fg-subtle transition-colors group-hover:text-fg-muted @3xl:block"
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
        <MetaList>
          <ProviderName forecast={forecast} />
          {volumeText(forecast)}
          {forecast.updated_at && <TimeAgo value={forecast.updated_at} prefix="Updated" />}
        </MetaList>
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
          <MetaList>
            {story.analysed ? <ImpactWord impact={story.impact} direction={story.direction} /> : <DraftLabel />}
            {story.region && <span className="max-w-48 truncate">{story.region.name}</span>}
            {story.kind === "projected"
              ? "Possible effect"
              : story.first_seen && <TimeAgo value={story.first_seen} />}
            {story.is_sample && <SampleBadge iconOnly />}
          </MetaList>
        </span>
        <ChevronRight aria-hidden className="mt-2.5 size-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}
