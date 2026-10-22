/**
 * The daily brief as data: the six cards in order, what each one is
 * called, whether there is anything to show, and the brief as plain text
 * (for "Copy as text").
 */
import { Profile, type BriefCard, type BriefResponse, type ForecastSummary, type StorySummary } from "@/api/contract";
import { formatCompact, formatPointChange, formatProbability } from "@/lib/format";
import { formatDateTime } from "@/lib/time";

export type BriefKind = BriefCard["kind"];
export type CardOf<K extends BriefKind> = Extract<BriefCard, { kind: K }>;

/** The six cards, in the order the brief shows them. */
export const BRIEF_ORDER: readonly BriefKind[] = [
  "top_risks",
  "top_opportunities",
  "biggest_movers",
  "odds_moved",
  "cascade_to_watch",
  "region_spotlight",
];

export interface CardInfo {
  title: string;
  /** One short line under the title. */
  description: string;
  /** What the empty card says. */
  empty: string;
}

export const CARD_INFO: Record<BriefKind, CardInfo> = {
  top_risks: {
    title: "Top risks",
    description: "What could hurt, most important first.",
    empty: "No risks stand out right now.",
  },
  top_opportunities: {
    title: "Top opportunities",
    description: "What could help, most important first.",
    empty: "No new opportunities stand out yet.",
  },
  biggest_movers: {
    title: "Most reported",
    description: "The stories with the most sources.",
    empty: "It's quiet so far.",
  },
  odds_moved: {
    title: "Crowd forecasts that moved",
    description: "Biggest 24-hour changes. Estimates, not facts.",
    empty: "No crowd forecast moved much.",
  },
  cascade_to_watch: {
    title: "Cascade to watch",
    description: "One event and the effects it sets off.",
    empty: "No chain of effects stands out this week.",
  },
  region_spotlight: {
    title: "Region spotlight",
    description: "The country with the most going on.",
    empty: "No country stands out yet.",
  },
};

/** The cards by kind (whatever order they arrive in). */
export function cardsByKind(brief: BriefResponse): { [K in BriefKind]?: CardOf<K> } {
  const out: { [K in BriefKind]?: CardOf<K> } = {};
  for (const card of brief.cards) (out as Record<string, BriefCard>)[card.kind] = card;
  return out;
}

/** The stories and forecasts a card holds (for counting and sample labels). */
export function cardItems(card: BriefCard | undefined): (StorySummary | ForecastSummary)[] {
  if (!card) return [];
  switch (card.kind) {
    case "odds_moved":
      return card.forecasts;
    case "cascade_to_watch":
      return card.focus ? [card.focus] : [];
    default:
      return card.stories;
  }
}

export function isCardEmpty(card: BriefCard | undefined): boolean {
  return cardItems(card).length === 0;
}

/** True when not one card has anything to show. */
export function isBriefEmpty(brief: BriefResponse): boolean {
  return brief.cards.every((c) => isCardEmpty(c));
}

/** "all" when every item is sample data (one badge covers the brief), "some", or "none". */
export function sampleShare(brief: BriefResponse): "all" | "some" | "none" {
  const items = brief.cards.flatMap((c) => cardItems(c));
  const n = items.filter((i) => i.is_sample).length;
  if (n === 0) return "none";
  return n === items.length ? "all" : "some";
}

/** A spotlight score (−1 all risk … +1 all opportunity) as an impact. */
export function spotlightImpact(score: number): { impact: "risk" | "opportunity" | "neutral"; label: string } {
  if (score >= 0.2) return { impact: "opportunity", label: "Mostly opportunity" };
  if (score <= -0.2) return { impact: "risk", label: "Mostly risk" };
  return { impact: "neutral", label: "Mixed" };
}

/** "Thursday 15 October", in the viewer's locale and time zone. */
export function briefDate(iso: string, locale?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(t));
}

/**
 * The stored business profile, when it is one and says something; null
 * otherwise. Read only: My Business owns it.
 */
export function usableProfile(value: unknown): Profile | null {
  const parsed = Profile.safeParse(value);
  if (!parsed.success) return null;
  const p = { ...parsed.data, name: null };
  const lists = [p.sectors, p.locations, p.inputs, p.suppliers, p.markets, p.competitors, p.keywords];
  return lists.some((list) => list.length > 0) ? p : null;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/**
 * `markSample`: tag each invented item. Needed when sample data sits beside
 * live news; when everything is sample, the note at the top says so once.
 */
function storyLinesOf(story: StorySummary, markSample: boolean): string[] {
  const place = story.region ? ` (${story.region.name})` : "";
  const tags: string[] = [];
  if (!story.analysed) tags.push("draft, awaiting analysis");
  if (markSample && story.is_sample) tags.push("sample data");
  const tag = tags.length > 0 ? ` [${tags.join("; ")}]` : "";
  if (!story.analysed) return [`- ${story.headline}${place}${tag}`];
  const lines = [`- ${story.headline}${place}${tag}`];
  if (story.so_what) lines.push(`  Why it matters: ${story.so_what}`);
  return lines;
}

function forecastLine(f: ForecastSummary, markSample: boolean, locale?: string): string {
  const parts = [`${formatProbability(f.probability)} crowd forecast`];
  if (f.change_24h !== null) parts.push(`${formatPointChange(f.change_24h)} points in 24 h`);
  parts.push(f.provider_name);
  parts.push(f.volume === null ? "volume not reported" : `${formatCompact(f.volume, locale)}${f.volume_unit ? ` ${f.volume_unit}` : ""} volume`);
  if (f.updated_at) parts.push(`updated ${formatDateTime(f.updated_at, locale)}`);
  const tag = markSample && f.is_sample ? " [sample data]" : "";
  return `- ${f.short_title}${tag} ${parts.join(" · ")}`;
}

/**
 * The brief as plain text for pasting into an email or chat: the date,
 * where it comes from, then each card. Drafts keep their source headline
 * and are marked; forecasts carry their source, volume and update time.
 */
export function briefAsText(brief: BriefResponse, options: { locale?: string; profileUsed?: boolean } = {}): string {
  const { locale, profileUsed = false } = options;
  const cards = cardsByKind(brief);
  const out: string[] = [`WorldGraph daily brief · ${briefDate(brief.generated_at, locale)}`];
  const notes = ["Generated from stored data"];
  if (profileUsed) notes.push("tuned to your business");
  const sample = sampleShare(brief);
  if (sample !== "none") notes.push(sample === "all" ? "sample data, not real events" : "includes sample data");
  out.push(notes.join(" · "));
  // Beside live news, each invented item says so: a pasted line must never pass for news.
  const mark = sample === "some";
  const storyLines = (s: StorySummary) => storyLinesOf(s, mark);

  for (const kind of BRIEF_ORDER) {
    const card = cards[kind];
    const info = CARD_INFO[kind];
    out.push("", info.title.toUpperCase());
    if (!card || isCardEmpty(card)) {
      out.push(info.empty);
      continue;
    }
    switch (card.kind) {
      case "odds_moved":
        out.push("Crowd forecasts are estimates, not facts.");
        for (const f of card.forecasts) out.push(forecastLine(f, mark, locale));
        break;
      case "cascade_to_watch":
        if (card.focus) {
          out.push(...storyLines(card.focus));
          out.push(`  Sets off ${card.effects} linked ${card.effects === 1 ? "effect" : "effects"}`);
        }
        break;
      case "region_spotlight":
        if (card.region) out.push(`${card.region.name}: ${spotlightImpact(card.score).label.toLowerCase()}`);
        for (const s of card.stories) out.push(...storyLines(s));
        break;
      default:
        for (const s of card.stories) out.push(...storyLines(s));
    }
  }
  return out.join("\n");
}
