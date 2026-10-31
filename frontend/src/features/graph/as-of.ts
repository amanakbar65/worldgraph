/**
 * "As of" for the graph (Phase A4, flag kg.history): the graph as WorldGraph
 * knew it at the end of a past day, read from api.graph_as_of and
 * api.local_graph_as_of. The day lives in the navigation state (`at=` in the
 * hash), so Back, Forward and deep links work.
 *
 * It is live data only: sample data has no history, and the bundled
 * snapshot has no as-of answers. In those cases the date control is
 * disabled with a short reason (asOfUnavailable) instead of an error.
 */
import { create } from "zustand";

import type { Settings } from "@/state/settings";
import type { ConnectionState } from "@/api/connection";

/** Why the date control is off, or null when it can be used. */
export type AsOfUnavailable = "sample" | "snapshot" | null;

export interface AsOfConditions {
  /** The Sample data setting. */
  sample: Settings["sample"];
  /** api.meta says the app is showing sample data (no live data yet, with Sample data "auto"). */
  showingSample: boolean;
  /** The data connection right now. */
  connection: ConnectionState["status"];
  /** The bundled snapshot holds as-of answers (it never does today). */
  snapshotHasAsOf: boolean;
}

/**
 * May the viewer look back in time? Not with sample data (it has no
 * history) and not from the bundled snapshot (it only holds today's first
 * frames). Everything else (a database still waking up, say) is left to the
 * call itself.
 */
export function asOfUnavailable(c: AsOfConditions): AsOfUnavailable {
  if (c.sample === "on" || (c.sample === "auto" && c.showingSample)) return "sample";
  if ((c.connection === "snapshot" || c.connection === "disconnected") && !c.snapshotHasAsOf) return "snapshot";
  return null;
}

/** The short reason shown on the disabled control. */
export const UNAVAILABLE_REASON: Record<Exclude<AsOfUnavailable, null>, { short: string; long: string }> = {
  sample: {
    short: "Sample data has no history",
    long: "Past dates show live data only. Turn Sample data off in Settings to look back.",
  },
  snapshot: {
    short: "Needs live data",
    long: "Past dates need the live database; this view is showing a saved snapshot.",
  },
};

/** Does this snapshot (its keys) hold any as-of answer? */
export function snapshotHasAsOf(keys: Iterable<string>): boolean {
  for (const key of keys) if (key.startsWith("graph_as_of:") || key.startsWith("local_graph_as_of:")) return true;
  return false;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-10-29" → "29 Oct 2026" (the day as written, whatever the viewer's time zone). */
export function formatDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? DAY_FORMAT.format(new Date(t)) : day;
}

/** Today in the viewer's own calendar, YYYY-MM-DD (the latest day the control offers). */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The UTC day of a time ("2026-10-29T10:12:00Z" → "2026-10-29"), or null. */
export function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The day in the database's "History starts on 29 Oct 2026" error, as
 * YYYY-MM-DD; null for any other error.
 */
export function historyStartFromError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const m = /History starts on (\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/.exec(message);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * When history starts (YYYY-MM-DD), as the latest as-of answer or error
 * said; null until one has come back. It sets the date control's earliest day.
 */
export const useHistoryStart = create<{ day: string | null; learn: (day: string | null) => void }>((set) => ({
  day: null,
  learn: (day) => set((s) => (day && day !== s.day ? { day } : s)),
}));

/**
 * The date control's limits: from the day history starts (when known) to
 * today. A day outside them is pulled inside.
 */
export function clampDay(day: string, min: string | null, max: string): string {
  if (min && day < min) return min;
  return day > max ? max : day;
}
