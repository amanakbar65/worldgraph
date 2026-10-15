/**
 * Settings as plain data: the choices, the one-line explanation for each,
 * what the AI costs, where personal data is kept, and the data summary
 * line built from api.meta.
 */
import type { MetaResponse } from "@/api/contract";
import type { AiEngine } from "@/ai/engine";
import type { UserStore } from "@/platform/storage";
import type { Settings } from "@/state/settings";
import { relativeTime } from "@/lib/time";

export const THEME_CHOICES: readonly { value: Settings["theme"]; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export const SAMPLE_CHOICES: readonly { value: Settings["sample"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export const BORDER_CHOICES: readonly { value: Settings["borders"]; label: string; ariaLabel: string }[] = [
  { value: "auto", label: "Auto", ariaLabel: "Automatic" },
  { value: "india", label: "India's view", ariaLabel: "India's official view" },
  { value: "international", label: "International", ariaLabel: "International" },
];

/** One line on what the chosen sample setting does. */
export function sampleExplanation(choice: Settings["sample"]): string {
  switch (choice) {
    case "on":
      return "Always mixed in with live news, each item labelled “Sample data”.";
    case "off":
      return "Never shown. Some screens stay empty until live news arrives.";
    default:
      return "Shown only while there is no live news yet, then hidden.";
  }
}

/** What the database is serving right now, when the setting is Auto. */
export function sampleNow(meta: MetaResponse["data"] | undefined): string | null {
  if (!meta) return null;
  return meta.showing_sample ? "Right now: sample data, as live news hasn't arrived yet." : "Right now: live news only.";
}

/** One line on what the chosen border setting does. */
export function bordersExplanation(choice: Settings["borders"], looksIndian: boolean): string {
  switch (choice) {
    case "india":
      return "Maps always show India's borders as India officially defines them.";
    case "international":
      return "Maps always show the international default borders (Natural Earth).";
    default:
      return looksIndian
        ? "India's official view, because your time zone is in India. International elsewhere."
        : "International borders here. Viewers in India see India's official view.";
  }
}

/** What using the AI costs the viewer, in one short line. */
export function aiCostLine(kind: AiEngine["kind"]): string {
  switch (kind) {
    case "artifact":
      return "Uses your Claude account while the app is open";
    case "api":
      return "WorldGraph AI, daily limit";
    default:
      return "Not available in this view";
  }
}

/**
 * The AI row: the engine's name, then what it costs and what it does. The
 * website's cost line already names the engine, so it gets a plainer title.
 */
export function aiRow(engine: Pick<AiEngine, "kind" | "label">): { title: string; cost: string; detail: string } {
  switch (engine.kind) {
    case "artifact":
      return {
        title: engine.label,
        cost: aiCostLine("artifact"),
        detail: "Summarises new stories and answers Ask. Nothing runs when the app is closed.",
      };
    case "api":
      return {
        title: aiCostLine("api"),
        cost: "Shared by everyone using the website; it resets at midnight UTC.",
        detail: "Summarises new stories and answers Ask.",
      };
    default:
      return {
        title: engine.label,
        cost: aiCostLine("none"),
        detail: "Stored stories, links and forecasts still work. New summaries and Ask need AI.",
      };
  }
}

export interface StoreCopy {
  title: string;
  description: string;
}

/** Where the business profile, watchlist and notes are kept. */
export function storeCopy(kind: UserStore["kind"]): StoreCopy {
  switch (kind) {
    case "cloud":
      return {
        title: "Saved to your Claude account",
        description: "Your business profile, watchlist and notes are private to you and follow you across devices.",
      };
    case "browser":
      return {
        title: "Saved in this browser",
        description: "Your business profile, watchlist and notes stay on this device. Clearing site data removes them.",
      };
    default:
      return {
        title: "Kept for this visit only",
        description: "Storage is blocked here, so your profile, watchlist and notes go when you close the page.",
      };
  }
}

/** A whole number with the viewer's digit grouping, e.g. 1,041 or 1,04,100. */
export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** "1,041 live stories · 171 sample stories · 31 crowd forecasts". */
export function dataSummary(meta: MetaResponse["data"], locale?: string): string {
  const plural = (n: number, one: string, many: string) => `${formatCount(n, locale)} ${n === 1 ? one : many}`;
  const parts = [plural(meta.live_stories, "live story", "live stories")];
  if (meta.sample_stories > 0) parts.push(plural(meta.sample_stories, "sample story", "sample stories"));
  parts.push(plural(meta.forecasts, "crowd forecast", "crowd forecasts"));
  return parts.join(" · ");
}

/** "News last checked 12 min ago", or that live news hasn't started. */
export function ingestLine(meta: MetaResponse["data"], now: number = Date.now(), locale?: string): string {
  if (!meta.last_ingest_at) return "Live news hasn't arrived yet.";
  return `News last checked ${relativeTime(meta.last_ingest_at, now, locale)}.`;
}

export const ABOUT_TEXT =
  "WorldGraph shows how world events reach your business: what is happening on a globe, the causes and effects that link events, and what crowds expect next. Facts come from named sources. Links and summaries written by AI show their type and confidence. Crowd forecasts are estimates, never facts, and are shown for information only.";
