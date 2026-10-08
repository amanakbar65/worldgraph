/**
 * Short, calm time labels: "just now", "12 min ago", "3 h ago", "2 d ago",
 * "in 5 d". Older or further dates show the date itself ("12 Mar",
 * "12 Mar 2025"), formatted in the viewer's locale.
 */
import type { TimeWindow } from "@/api/contract";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past this many days a relative label stops being useful; show the date. */
const MAX_RELATIVE_DAYS = 30;

type DateInput = string | number | Date;

function toMs(value: DateInput): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

/**
 * A relative label for a timestamp, measured from `now`.
 * Returns "" for an unparseable date.
 */
export function relativeTime(value: DateInput, now: DateInput = Date.now(), locale?: string): string {
  const t = toMs(value);
  const n = toMs(now);
  if (Number.isNaN(t) || Number.isNaN(n)) return "";
  const diff = n - t; // > 0 in the past
  const abs = Math.abs(diff);
  const future = diff < 0;

  if (abs < MINUTE) return future ? "in under a minute" : "just now";

  let amount: string;
  if (abs < HOUR) amount = `${Math.floor(abs / MINUTE)} min`;
  else if (abs < DAY) amount = `${Math.floor(abs / HOUR)} h`;
  else if (abs < MAX_RELATIVE_DAYS * DAY) amount = `${Math.floor(abs / DAY)} d`;
  else return formatDate(t, n, locale);

  return future ? `in ${amount}` : `${amount} ago`;
}

/**
 * A short date: "12 Mar", with the year when it isn't the current one.
 * `now` decides which year counts as current.
 */
export function formatDate(value: DateInput, now: DateInput = Date.now(), locale?: string): string {
  const t = toMs(value);
  if (Number.isNaN(t)) return "";
  const date = new Date(t);
  const sameYear = date.getUTCFullYear() === new Date(toMs(now)).getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** A full date and time for tooltips and `title` attributes, in the viewer's zone. */
export function formatDateTime(value: DateInput, locale?: string): string {
  const t = toMs(value);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(t));
}

/** True when the timestamp is less than an hour old (the globe pulses these). */
export function isFresh(value: DateInput, now: DateInput = Date.now()): boolean {
  const age = toMs(now) - toMs(value);
  return age >= 0 && age < HOUR;
}

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

export const TIME_WINDOWS: readonly TimeWindow[] = ["24h", "7d", "30d"];

export const WINDOW_LABELS: Record<TimeWindow, { short: string; long: string }> = {
  "24h": { short: "24 h", long: "Last 24 hours" },
  "7d": { short: "7 d", long: "Last 7 days" },
  "30d": { short: "30 d", long: "Last 30 days" },
};

/** The window's length in milliseconds. */
export const WINDOW_MS: Record<TimeWindow, number> = {
  "24h": DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};
