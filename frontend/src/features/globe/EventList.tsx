import { ListX, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { StorySummary, TimeWindow } from "@/api/contract";
import { EmptyState } from "@/components/EmptyState";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { StoryCard } from "@/components/StoryCard";
import { Button } from "@/components/ui/button";
import { formatCompact } from "@/lib/format";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";

import { GLASS } from "./GlobeControls";
import { nextRow, sortEventsForList, storyForEvent, type GlobeEvent, type GlobeSample } from "./model";
import { DraftNote } from "./TopNow";

const LIST_PAGE = 40;

export interface EventListProps {
  events: readonly GlobeEvent[];
  window: TimeWindow;
  /** Sample data on the globe: "all" (no live data yet) or "some" (sample switched on beside live data). */
  sample: GlobeSample;
  /** Full stories another call already sent (the Top 5), so a story looks the same in both. */
  knownStories?: ReadonlyMap<string, StorySummary>;
  /** Shown above the rows, e.g. when the list stands in for a globe that can't be drawn. */
  note?: ReactNode;
  onOpen: (event: GlobeEvent) => void;
  onFocusItem: (id: string | null) => void;
  /** What to show when there is nothing to list (instead of the suggestions below). */
  empty?: ReactNode;
  /** Sector lens on: an empty list offers to clear it. */
  lensOn?: boolean;
  onClearLens?: () => void;
  /** Null when the window is already the longest. */
  onWiderWindow?: (() => void) | null;
  /** The id of a visible heading that names the list; without one the list brings its own (for screen readers). */
  labelledBy?: string;
}

/**
 * Everything on the globe as a list: the keyboard and screen-reader route to
 * the same events, most important first. Tab or the arrow keys move between
 * rows (Home and End jump to the ends); Enter opens the story.
 */
export function EventListBody({
  events,
  window,
  sample,
  knownStories,
  note,
  onOpen,
  onFocusItem,
  empty,
  labelledBy,
  lensOn = false,
  onClearLens,
  onWiderWindow,
}: EventListProps) {
  const ownHeadingId = useId();
  const headingId = labelledBy ?? ownHeadingId;
  const sorted = useMemo(() => sortEventsForList(events), [events]);
  const [shown, setShown] = useState(LIST_PAGE);
  const list = useRef<HTMLUListElement>(null);
  const visible = sorted.slice(0, shown);
  const rowStory = (event: GlobeEvent) => {
    const story = storyForEvent(event, sample, knownStories);
    // One badge above covers a list that is all sample data; beside live news, each sample row carries its own.
    return sample === "all" ? { ...story, is_sample: false } : story;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button") ?? [],
    );
    const current = buttons.findIndex((b) => b === document.activeElement);
    const next = nextRow(e.key, Math.max(0, current), buttons.length);
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <>
      <div className="flex min-h-8 shrink-0 items-center gap-2 px-4 pt-1">
        {!labelledBy && (
          <h2 id={headingId} className="sr-only">
            All events
          </h2>
        )}
        <p className="min-w-0 flex-1 truncate text-label text-fg-muted tabular-nums">
          {formatCompact(sorted.length)} {sorted.length === 1 ? "event" : "events"} · by importance
        </p>
        {sample === "all" && <SampleBadge />}
        {sample === "some" && (
          <span className="flex shrink-0 items-center gap-1 text-label text-fg-muted">
            Includes <SampleBadge />
          </span>
        )}
      </div>
      {note}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {sorted.length === 0 ? (
          (empty ?? (
            <EmptyState
              compact
              icon={ListX}
              title={
                lensOn
                  ? "No events for this sector lens"
                  : `No events in the ${WINDOW_LABELS[window].long.toLowerCase()}`
              }
              description={lensOn ? "Try all sectors, or a longer window." : "Try a longer window."}
              action={
                lensOn && onClearLens
                  ? { label: "Show all sectors", onClick: onClearLens }
                  : onWiderWindow
                    ? { label: "Show 30 days", onClick: onWiderWindow }
                    : undefined
              }
              secondaryAction={
                lensOn && onClearLens && onWiderWindow
                  ? { label: "Show 30 days", onClick: onWiderWindow }
                  : undefined
              }
            />
          ))
        ) : (
          <>
            <ul ref={list} aria-labelledby={headingId} onKeyDown={onKeyDown} className="flex flex-col">
              {visible.map((event, i) => (
                <li
                  key={event.id}
                  onMouseEnter={() => onFocusItem(event.id)}
                  onMouseLeave={() => onFocusItem(null)}
                  onFocus={() => onFocusItem(event.id)}
                  onBlur={() => onFocusItem(null)}
                >
                  <StoryCard
                    story={rowStory(event)}
                    variant="compact"
                    rank={i + 1}
                    onOpen={() => onOpen(event)}
                  />
                  {event.analysed === false && <DraftNote className="-mt-1.5 pb-2 pl-20" />}
                </li>
              ))}
            </ul>
            {shown < sorted.length && (
              <div className="flex justify-center p-2">
                <Button variant="outline" onClick={() => setShown((n) => n + LIST_PAGE)}>
                  Show {Math.min(LIST_PAGE, sorted.length - shown)} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Phones: the list as its own card, with a close button. */
export function EventList({
  onClose,
  className,
  ...props
}: EventListProps & { onClose?: () => void; className?: string }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(GLASS, "flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl", className)}
    >
      <SectionHeader
        id={titleId}
        title="All events"
        action={
          onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the list">
              <X aria-hidden />
            </Button>
          )
        }
        className="shrink-0 pt-1 pr-1 pl-4"
      />
      <EventListBody {...props} labelledBy={titleId} />
    </section>
  );
}
