import { useSyncExternalStore } from "react";

import { formatDateTime, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// One shared clock for every TimeAgo on the page; it ticks every 30 seconds
// while at least one is mounted.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let clock = Date.now();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    clock = Date.now();
    timer = setInterval(() => {
      clock = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getClock = () => clock;

export interface TimeAgoProps {
  /** ISO 8601 timestamp. Null renders nothing. */
  value: string | null | undefined;
  /** Words before the time, e.g. "Updated" → "Updated 12 min ago", "Ends" → "Ends in 5 d". */
  prefix?: string;
  /** Used instead of `prefix` once the time has passed, e.g. "Ended" → "Ended 2 d ago". */
  pastPrefix?: string;
  /** A fixed "now" (tests, previews); by default the label refreshes on its own. */
  now?: number;
  className?: string;
}

/**
 * "12 min ago", "3 h ago", "in 5 d" in a `<time>` element, with the full
 * date and time as its tooltip.
 */
export function TimeAgo({ value, prefix, pastPrefix, now, className }: TimeAgoProps) {
  const current = useSyncExternalStore(subscribe, getClock, getClock);
  if (!value) return null;
  const reference = now ?? current;
  const label = relativeTime(value, reference);
  if (!label) return null;
  const words = pastPrefix && Date.parse(value) <= reference ? pastPrefix : prefix;
  return (
    <time dateTime={value} title={formatDateTime(value)} className={cn("tabular-nums", className)}>
      {words ? `${words} ${label}` : label}
    </time>
  );
}
