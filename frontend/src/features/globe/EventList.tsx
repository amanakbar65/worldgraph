import { ListX, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { TimeWindow } from "@/api/contract";
import { EmptyState } from "@/components/EmptyState";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { StoryCard } from "@/components/StoryCard";
import { Button } from "@/components/ui/button";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";

import { GLASS } from "./GlobeControls";
import { eventAsStory, nextRow, sortEventsForList, type GlobeEvent } from "./model";

const LIST_PAGE = 40;

export interface EventListProps {
  events: readonly GlobeEvent[];
  window: TimeWindow;
  allSample: boolean;
  /** Shown above the rows, e.g. when the list stands in for a globe that can't be drawn. */
  note?: ReactNode;
  onOpen: (event: GlobeEvent) => void;
  onFocusItem: (id: string | null) => void;
  onClose?: () => void;
  /** What to show when there is nothing to list. */
  empty?: ReactNode;
  className?: string;
}

/**
 * Everything on the globe as a list: the keyboard and screen-reader route to
 * the same events, most important first. Tab or the arrow keys move between
 * rows (Home and End jump to the ends); Enter opens the story.
 */
export function EventList({ events, window, allSample, note, onOpen, onFocusItem, onClose, empty, className }: EventListProps) {
  const headingId = useId();
  const sorted = useMemo(() => sortEventsForList(events), [events]);
  const [shown, setShown] = useState(LIST_PAGE);
  const list = useRef<HTMLUListElement>(null);
  const visible = sorted.slice(0, shown);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button") ?? []);
    const current = buttons.findIndex((b) => b === document.activeElement);
    const next = nextRow(e.key, Math.max(0, current), buttons.length);
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn(GLASS, "flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl", className)}
    >
      <SectionHeader
        id={headingId}
        title="All events"
        count={sorted.length}
        description={`${WINDOW_LABELS[window].long} · most important first`}
        action={
          (allSample || onClose) && (
            <>
              {allSample && <SampleBadge />}
              {onClose && (
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the list">
                  <X aria-hidden />
                </Button>
              )}
            </>
          )
        }
        className="shrink-0 px-4 pt-3 pb-1"
      />
      {note}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {sorted.length === 0 ? (
          (empty ?? <EmptyState compact icon={ListX} title="No events to list" />)
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
                    story={eventAsStory(event, { isSample: allSample })}
                    variant="compact"
                    rank={i + 1}
                    onOpen={() => onOpen(event)}
                  />
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
    </section>
  );
}
