import type { DataError } from "@/api/source";
import type { SnapshotKind } from "@/lib/snapshot-plan";
import { relativeTime } from "@/lib/time";

type Text = { long: string; short: string };

/** "22 Oct, 14:05" (or "Oct 22, 2:05 PM") in the viewer's own time, with the year when it isn't this one. */
function clock(at: number, now: number, locale?: string): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/**
 * What the status pill calls a snapshot on screen: a live one with the time
 * it was taken ("Snapshot as of 22 Oct, 14:05", or "Snapshot · 3 h ago" on
 * phones), never "Live data"; a sample one as a sample.
 */
export function snapshotText(
  kind: SnapshotKind | null,
  asOf: string | null,
  now: number,
  locale?: string,
): Text {
  if (kind !== "live") return { long: "Sample snapshot", short: "Sample snapshot" };
  const at = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(at)) return { long: "Snapshot", short: "Snapshot" };
  return {
    long: `Snapshot as of ${clock(at, now, locale)}`,
    short: `Snapshot · ${relativeTime(at, now, locale)}`,
  };
}

/**
 * Why live data isn't on screen, in a few words. The connector's own
 * message for a declined approval says sample data is showing, which is
 * no longer always so; this never claims what's on screen.
 */
export function reasonText(reason: DataError): string {
  return reason.kind === "not_allowed" ? "Live data wasn't approved." : reason.message;
}
