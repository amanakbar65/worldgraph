import { CalendarClock, History, Undo2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isAsOfDay, useNav } from "@/state/nav";

import { clampDay, formatDay, historyStartFromError, today, UNAVAILABLE_REASON, useHistoryStart } from "./as-of";
import type { AsOfState } from "./use-as-of";

/**
 * The scope bar's date control: "Now", or the day the graph shows. It opens
 * a small form to pick a day between the start of history and today. With
 * sample data or a saved snapshot it stays visible but off, and says why.
 */
export function AsOfControl({ asOf }: { asOf: AsOfState }) {
  const [open, setOpen] = useState(false);
  const { requested, unavailable } = asOf;
  const off = unavailable !== null;
  const label = off
    ? `Past dates: ${UNAVAILABLE_REASON[unavailable].short}`
    : requested
      ? `As of ${formatDay(requested)}. Change the date`
      : "Show the graph on a past date";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          title={off ? UNAVAILABLE_REASON[unavailable].short : undefined}
          aria-disabled={off || undefined}
          data-testid="as-of-control"
          className={cn(
            "border-line px-3",
            off && "text-fg-subtle hover:bg-transparent",
            requested && !off && "border-fg/60 bg-surface-2",
          )}
        >
          <CalendarClock aria-hidden />
          <span className="hidden sm:inline">{requested && !off ? formatDay(requested) : "Now"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(320px,calc(100vw-24px))] p-4">
        {off ? (
          <div className="flex flex-col gap-1.5" role="status">
            <p className="font-medium">{UNAVAILABLE_REASON[unavailable].short}</p>
            <p className="text-label text-fg-muted">{UNAVAILABLE_REASON[unavailable].long}</p>
          </div>
        ) : (
          <AsOfForm requested={requested} onDone={() => setOpen(false)} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function AsOfForm({ requested, onDone }: { requested: string | null; onDone: () => void }) {
  const setAsOf = useNav((s) => s.setAsOf);
  const start = useHistoryStart((s) => s.day);
  const max = today();
  const [draft, setDraft] = useState(requested ?? max);
  const inputId = useId();
  const hintId = useId();
  const valid = isAsOfDay(draft);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setAsOf(clampDay(draft, start, max));
    onDone();
  };

  return (
    // noValidate: a day outside history or in the future is pulled inside (clampDay), not refused.
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Show the graph as it was</p>
        <p id={hintId} className="text-label text-fg-muted">
          What WorldGraph knew at the end of that day.
          {start ? ` History starts on ${formatDay(start)}.` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Day
        </label>
        <input
          id={inputId}
          type="date"
          value={draft}
          min={start ?? undefined}
          max={max}
          required
          aria-describedby={hintId}
          onChange={(e) => setDraft(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg-sunken/60 px-3 text-body text-fg tabular-nums hover:border-fg/40"
        />
        <Button type="submit" disabled={!valid}>
          Show
        </Button>
      </div>
      {requested && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start px-2"
          onClick={() => {
            setAsOf(null);
            onDone();
          }}
        >
          <Undo2 aria-hidden />
          Back to now
        </Button>
      )}
    </form>
  );
}

/**
 * While the graph shows a past day: a clear banner with that day and a way
 * back to now. With sample data or a snapshot (a deep link from someone
 * else, say) it says the day can't be shown here and shows now instead.
 */
export function AsOfBanner({ asOf, loading }: { asOf: AsOfState; loading: boolean }) {
  const setAsOf = useNav((s) => s.setAsOf);
  const { requested, unavailable, waiting } = asOf;
  // Without kg.history (once api.meta has said so) there is no "as of" at all.
  if (!requested || (!asOf.enabled && !waiting)) return null;
  const day = formatDay(requested);
  const off = unavailable !== null;
  loading ||= waiting;
  return (
    <div
      data-testid="as-of-banner"
      className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-fg py-1 pr-1 pl-2.5 text-bg shadow-panel"
    >
      <History aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 text-label">
        {off ? (
          <>
            <span className="font-semibold">Can't show {day}</span>
            {` · ${UNAVAILABLE_REASON[unavailable].short}. Showing now.`}
          </>
        ) : (
          <>
            <span className="font-semibold">As of {day}</span>
            <span className="opacity-80"> · {loading ? "Loading…" : "what WorldGraph knew then"}</span>
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAsOf(null)}
        className="ml-auto bg-bg/15 px-2.5 text-bg hover:bg-bg/25 hover:text-bg"
      >
        <Undo2 aria-hidden />
        Back to now
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {off ? `Can't show ${day}; showing now.` : loading ? "" : `Showing the graph as of ${day}.`}
      </span>
    </div>
  );
}

/**
 * The graph didn't load as of a day: before history starts that is a
 * normal answer ("History starts on …") with a way to its first day, not
 * an error; anything else is the usual error state.
 */
export function AsOfErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const setAsOf = useNav((s) => s.setAsOf);
  const start = historyStartFromError(error);
  if (!start) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <EmptyState
      icon={CalendarClock}
      title={`History starts on ${formatDay(start)}`}
      description="WorldGraph keeps its history from that day on."
      action={{ label: `Show ${formatDay(start)}`, onClick: () => setAsOf(start) }}
      secondaryAction={{ label: "Back to now", onClick: () => setAsOf(null) }}
    />
  );
}
