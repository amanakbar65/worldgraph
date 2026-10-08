import { ChevronDown, Flame, Users } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { ForecastSummary, StorySummary, TimeWindow, TopResponse } from "@/api/contract";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { StoryCard } from "@/components/StoryCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";

import { GLASS } from "./GlobeControls";
import { sampleLabelling } from "./model";

export interface TopNowProps {
  data: TopResponse | undefined;
  error: Error | null;
  loading: boolean;
  window: TimeWindow;
  /** Sector lens on: the empty state offers to clear it. */
  lensOn: boolean;
  onRetry: () => void;
  onWiderWindow: (() => void) | null;
  onClearLens: () => void;
  onOpenStory: (story: StorySummary) => void;
  onOpenForecast: (forecast: ForecastSummary) => void;
  /** Hovering or focusing a row lights its place on the globe. */
  onFocusItem: (id: string | null) => void;
}

/** A draft from the live news pipeline: its source headline, waiting for the AI. */
export function DraftNote({ className }: { className?: string }) {
  return <p className={cn("text-label text-fg-subtle", className)}>Draft · awaiting analysis</p>;
}

/** The stories and movers to show, with their own "Sample" marks dropped when one badge covers them all. */
function useRows(data: TopResponse | undefined) {
  const stories = data?.stories ?? [];
  const movers = data?.movers ?? [];
  const labelling = sampleLabelling([...stories, ...movers]);
  const strip = labelling === "all";
  return {
    stories: strip ? stories.map((s) => ({ ...s, is_sample: false })) : stories,
    movers: strip ? movers.map((m) => ({ ...m, is_sample: false })) : movers,
    allSample: strip,
  };
}

function StoryRows({ stories, props, carousel }: { stories: StorySummary[]; props: TopNowProps; carousel?: boolean }) {
  return (
    <>
      {stories.map((story, i) => (
        <li
          key={story.id}
          className={cn(carousel && cn(GLASS, "w-[84%] shrink-0 snap-start rounded-xl"))}
          onMouseEnter={() => props.onFocusItem(story.id)}
          onMouseLeave={() => props.onFocusItem(null)}
          onFocus={() => props.onFocusItem(story.id)}
          onBlur={() => props.onFocusItem(null)}
        >
          <StoryCard story={story} variant="compact" rank={i + 1} onOpen={props.onOpenStory} />
          {/* Lined up under the headline: card padding, rank, icon and gaps. */}
          {!story.analysed && <DraftNote className="-mt-1.5 pb-2 pl-[5.5rem]" />}
        </li>
      ))}
    </>
  );
}

function MoverRows({ movers, props, carousel }: { movers: ForecastSummary[]; props: TopNowProps; carousel?: boolean }) {
  return (
    <>
      {movers.map((forecast) => (
        <li
          key={forecast.id}
          className={cn(carousel && cn(GLASS, "w-[84%] shrink-0 snap-start rounded-xl"))}
          onMouseEnter={() => props.onFocusItem(forecast.id)}
          onMouseLeave={() => props.onFocusItem(null)}
          onFocus={() => props.onFocusItem(forecast.id)}
          onBlur={() => props.onFocusItem(null)}
        >
          <ForecastRow forecast={forecast} short onOpen={props.onOpenForecast} />
        </li>
      ))}
    </>
  );
}

function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading the top stories" className="flex flex-col gap-4 p-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ props }: { props: TopNowProps }) {
  const title = props.lensOn
    ? "Nothing for this sector lens"
    : `Nothing in the ${WINDOW_LABELS[props.window].long.toLowerCase()}`;
  return (
    <EmptyState
      compact
      icon={Flame}
      title={title}
      description={props.lensOn ? "Try all sectors, or a longer window." : "Try a longer window."}
      action={
        props.lensOn
          ? { label: "Show all sectors", onClick: props.onClearLens }
          : props.onWiderWindow
            ? { label: "Show 30 days", onClick: props.onWiderWindow }
            : undefined
      }
      secondaryAction={props.lensOn && props.onWiderWindow ? { label: "Show 30 days", onClick: props.onWiderWindow } : undefined}
    />
  );
}

/**
 * Desktop: the "Top 5 now" side card's content: the five most important
 * stories, then the crowd forecasts that moved most in 24 hours.
 */
export function TopNowBody(props: TopNowProps) {
  const headingId = useId();
  const { data, error, loading } = props;
  const { stories, movers, allSample } = useRows(data);

  let body: ReactNode;
  if (error && !data) body = <ErrorState error={error} onRetry={props.onRetry} compact />;
  else if (loading && !data) body = <Loading />;
  else if (stories.length === 0 && movers.length === 0) body = <Empty props={props} />;
  else
    body = (
      <>
        {stories.length > 0 ? (
          <ul aria-labelledby={headingId} className="flex flex-col">
            <StoryRows stories={stories} props={props} />
          </ul>
        ) : (
          <Empty props={props} />
        )}
        {movers.length > 0 && (
          <section aria-labelledby={`${headingId}-movers`} className="mt-1 border-t border-line pt-1">
            <SectionHeader
              id={`${headingId}-movers`}
              as="h3"
              icon={Users}
              title="Crowd forecasts that moved"
              description="Biggest 24-hour moves"
              className="px-2"
            />
            <ul className="flex flex-col">
              <MoverRows movers={movers} props={props} />
            </ul>
          </section>
        )}
      </>
    );

  return (
    <>
      <div className="flex min-h-8 shrink-0 items-center gap-2 px-4 pt-1">
        <h2 id={headingId} className="sr-only">
          Top 5 now
        </h2>
        <p className="min-w-0 flex-1 truncate text-label text-fg-muted">
          {WINDOW_LABELS[props.window].long} · most important first
        </p>
        {allSample && <SampleBadge />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">{body}</div>
    </>
  );
}

/** Phones: a bar at the bottom that opens into a row of cards you swipe through. */
export function TopNowStrip(props: TopNowProps & { collapsed: boolean; onCollapsedChange: (c: boolean) => void }) {
  const headingId = useId();
  const listId = useId();
  const { data, error, loading, collapsed } = props;
  const { stories, movers, allSample } = useRows(data);
  const lead = stories[0];

  let body: ReactNode = null;
  if (!collapsed) {
    if (error && !data) body = <ErrorState error={error} onRetry={props.onRetry} compact className={cn(GLASS, "rounded-xl")} />;
    else if (loading && !data)
      body = (
        <div className={cn(GLASS, "rounded-xl")}>
          <Loading rows={1} />
        </div>
      );
    else if (stories.length === 0 && movers.length === 0)
      body = (
        <div className={cn(GLASS, "rounded-xl")}>
          <Empty props={props} />
        </div>
      );
    else
      body = (
        <ul
          aria-label="Top stories and crowd moves, swipe for more"
          className="-mx-3 flex snap-x snap-mandatory scroll-px-3 items-start gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <StoryRows stories={stories} props={props} carousel />
          <MoverRows movers={movers} props={props} carousel />
        </ul>
      );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className={cn(GLASS, "flex h-10 max-w-full items-center gap-2 self-start rounded-full pr-1 pl-3")}>
        <h2 id={headingId} className="flex shrink-0 items-center gap-1.5 text-body font-semibold text-fg">
          <Flame aria-hidden className="size-4 text-fg-muted" />
          Top 5 now
        </h2>
        {allSample && <SampleBadge compact />}
        {collapsed && lead && <span className="min-w-0 truncate text-label text-fg-muted">{lead.headline}</span>}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={collapsed ? "Show the top stories" : "Hide the top stories"}
          onClick={() => props.onCollapsedChange(!collapsed)}
        >
          <ChevronDown aria-hidden className={cn("transition-transform", collapsed && "rotate-180")} />
        </Button>
      </div>
      <div id={listId} hidden={collapsed}>
        {body}
      </div>
    </section>
  );
}
