/** The brief's cards: a shared frame, story rows, and the six card bodies. */
import { ChevronRight, CornerDownRight, MapPin, Waypoints, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { ForecastSummary, RegionRef, StorySummary } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState, type StateAction } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CrowdForecastRow } from "@/features/ask/ask-parts";
import { DEFAULT_CASCADE_DEPTH, directLinks } from "@/features/story/cascade-data";
import { DraftLabel, LinkedStoryRow, StoryMeta } from "@/features/story/story-parts";
import type { Tone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { CARD_INFO, spotlightImpact, type BriefKind } from "./brief-data";

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function BriefCardFrame({
  kind,
  icon: Icon,
  tone,
  children,
  footer,
  className,
}: {
  kind: BriefKind;
  icon: LucideIcon;
  tone: Pick<Tone, "text" | "tint" | "border">;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const info = CARD_INFO[kind];
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col rounded-xl border border-line bg-surface", className)}
    >
      <header className="flex items-start gap-3 px-4 pt-4 pb-2">
        <span
          aria-hidden
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", tone.tint, tone.border)}
        >
          <Icon className={cn("size-4", tone.text)} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-body font-semibold text-fg">
            {info.title}
          </h2>
          <p className="text-label text-fg-muted">{info.description}</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col px-2 pb-2">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A card with nothing in it: says so and offers a quiet next tap. */
export function EmptyCard({ kind, action }: { kind: BriefKind; action?: StateAction }) {
  return (
    <EmptyState compact title={CARD_INFO[kind].empty} secondaryAction={action} className="flex-1 justify-center" />
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A story: headline, why it matters, then impact, place and time. Drafts
 * from the news feed show their source headline and a draft label, never
 * a summary.
 */
export function BriefStoryRow({
  story,
  rank,
  showSample,
  onOpen,
}: {
  story: StorySummary;
  rank?: number;
  showSample: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(story.id)}
        className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-surface-2/70"
      >
        {rank !== undefined && (
          <span aria-hidden className="w-3 shrink-0 text-center text-body font-semibold text-fg-subtle tabular-nums">
            {rank}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-3 text-body font-medium text-fg">{story.headline}</span>
          {story.analysed ? (
            <>
              {story.so_what && <span className="line-clamp-3 text-body text-fg-muted">{story.so_what}</span>}
              <StoryMeta story={story} oneLine showSample={showSample} />
            </>
          ) : (
            <DraftLabel className="self-start" />
          )}
        </span>
        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}

export function StoryList({
  stories,
  ranked = true,
  showSample,
  onOpen,
}: {
  stories: readonly StorySummary[];
  ranked?: boolean;
  showSample: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ol className="flex flex-col">
      {stories.map((story, i) => (
        <BriefStoryRow
          key={story.id}
          story={story}
          rank={ranked ? i + 1 : undefined}
          showSample={showSample}
          onOpen={onOpen}
        />
      ))}
    </ol>
  );
}

export function ForecastList({
  forecasts,
  showSample,
  onOpen,
}: {
  forecasts: readonly ForecastSummary[];
  showSample: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {forecasts.map((f) => (
        <li key={f.id}>
          <CrowdForecastRow forecast={f} onOpen={onOpen} showSample={showSample} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Cascade and region
// ---------------------------------------------------------------------------

export function CascadeFooter({ effects, onOpen }: { effects: number; onOpen: () => void }) {
  return (
    <>
      <span className="text-label text-fg-muted tabular-nums">
        Sets off {effects} linked {effects === 1 ? "effect" : "effects"}
      </span>
      <Button variant="outline" size="sm" onClick={onOpen} className="h-10">
        <Waypoints aria-hidden />
        Open the cascade
      </Button>
    </>
  );
}

export function SpotlightHeader({
  region,
  score,
  onOpen,
}: {
  region: RegionRef;
  score: number;
  onOpen: (id: string) => void;
}) {
  const mood = spotlightImpact(score);
  return (
    <div className="flex flex-wrap items-center gap-2 px-2.5 pt-1 pb-2">
      <EntityChip entity={{ id: region.id, type: "region", name: region.name }} onClick={() => onOpen(region.id)} />
      <ImpactBadge impact={mood.impact} label={mood.label} />
    </div>
  );
}

export function SpotlightFooter({ region, onOpen }: { region: RegionRef; onOpen: (id: string) => void }) {
  return (
    <Button variant="outline" size="sm" onClick={() => onOpen(region.id)} className="ml-auto h-10">
      <MapPin aria-hidden />
      Open {region.name}
    </Button>
  );
}

/** The focus story's direct effects, with each link's mechanism, type and confidence. */
export function CascadePreview({
  focusId,
  showSample,
  onOpenStory,
}: {
  focusId: string;
  /** Off when one badge already labels the whole brief as sample data. */
  showSample: boolean;
  onOpenStory: (id: string) => void;
}) {
  // The same arguments as the story card, so opening the story is instant.
  const query = useRpc("cascade", { id: focusId, depth: DEFAULT_CASCADE_DEPTH });
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3 px-2.5 py-2" aria-busy="true" aria-label="Loading its effects">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!query.data) return null;
  const { effects } = directLinks(query.data);
  if (effects.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 px-2.5 pt-1">
      <h3 className="flex items-center gap-1.5 text-label font-medium text-fg-muted">
        <CornerDownRight aria-hidden className="size-3.5" />
        What it leads to
      </h3>
      <ul className="-mx-2 flex flex-col">
        {effects.slice(0, 3).map((e) => (
          <LinkedStoryRow
            key={e.link.id}
            story={showSample ? e.story : { ...e.story, is_sample: false }}
            link={e.link}
            branch={e.branch}
            onOpen={onOpenStory}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function BriefSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
          {[0, 1, 2].map((j) => (
            <div key={j} className="flex flex-col gap-1.5 pl-6">
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
