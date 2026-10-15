/**
 * Ask, as plain data: what we send to the AI (a compact copy of the
 * retrieved context), how its reply is checked against that context
 * (citations, cascade steps and forecasts it didn't get are dropped), and
 * the suggested questions.
 */
import type {
  AskContextResponse,
  CascadeLink,
  EntityType,
  ForecastSummary,
  LinkType,
  SectorId,
} from "@/api/contract";
import type { AskAnswer } from "@/ai/schemas";
import { SECTORS } from "@/lib/icons";

export type AskStory = AskContextResponse["stories"][number];

/** How many stories api.ask_context returns (it allows 1–25). */
export const CONTEXT_LIMIT = 12;
export const MIN_QUESTION = 3;
export const MAX_QUESTION = 300;

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

/** A question as sent: single spaces, trimmed, at most 300 characters. */
export function cleanQuestion(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION).trim();
}

export function isAskable(raw: string): boolean {
  return cleanQuestion(raw).length >= MIN_QUESTION;
}

// ---------------------------------------------------------------------------
// The context the AI sees
// ---------------------------------------------------------------------------

export interface CompactStory {
  id: string;
  headline: string;
  /** Null for drafts the AI hasn't analysed yet. */
  so_what: string | null;
  region: string | null;
  first_seen: string | null;
  /** Source names only, without repeats. */
  sources: string[];
  actions: string[];
}

export interface CompactLink {
  from: string;
  to: string;
  type: LinkType;
  mechanism: string;
  confidence: number;
}

export interface CompactForecast {
  id: string;
  short_title: string;
  probability: number;
  provider: string;
  volume: number | null;
  unit: string | null;
  updated_at: string | null;
}

export interface CompactContext {
  stories: CompactStory[];
  links: CompactLink[];
  forecasts: CompactForecast[];
}

const MAX_SOURCES = 4;
const round2 = (n: number) => Math.round(n * 100) / 100;

function uniqueNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/**
 * The retrieved context, cut down to what the answer needs: no URLs,
 * snippets, coordinates or sparklines. Links whose two stories aren't both
 * in the context are left out (the answer can only cite stories it has).
 */
export function compactContext(ctx: AskContextResponse): CompactContext {
  const ids = new Set(ctx.stories.map((s) => s.id));
  return {
    stories: ctx.stories.map((s) => ({
      id: s.id,
      headline: s.headline,
      so_what: s.analysed ? s.so_what : null,
      region: s.region?.name ?? null,
      first_seen: s.first_seen,
      sources: uniqueNames(s.sources.map((src) => src.source_name)),
      actions: s.analysed ? s.actions.slice(0, 3) : [],
    })),
    links: ctx.links
      .filter((l) => ids.has(l.src) && ids.has(l.dst) && l.src !== l.dst)
      .map((l) => ({
        from: l.src,
        to: l.dst,
        type: l.link_type,
        mechanism: l.mechanism,
        confidence: round2(l.confidence),
      })),
    forecasts: ctx.forecasts.map((f) => ({
      id: f.id,
      short_title: f.short_title,
      probability: round2(f.probability),
      provider: f.provider_name,
      volume: f.volume === null ? null : Math.round(f.volume),
      unit: f.volume_unit,
      updated_at: f.updated_at,
    })),
  };
}

/** Nothing the answer could cite: every bullet must cite a story. */
export function isEmptyContext(ctx: AskContextResponse): boolean {
  return ctx.stories.length === 0;
}

// ---------------------------------------------------------------------------
// The answer, checked against the context
// ---------------------------------------------------------------------------

export interface AnswerBullet {
  text: string;
  cites: AskStory[];
}

/** A run of linked stories: nodes[i] → links[i] → nodes[i + 1]. */
export interface CascadeChain {
  nodes: AskStory[];
  links: CascadeLink[];
}

export interface ShapedAnswer {
  status: "answered" | "not_enough_evidence";
  bullets: AnswerBullet[];
  cascade: CascadeChain[];
  forecasts: ForecastSummary[];
  followUps: string[];
  /** Citations, steps and forecast ids the reply named that the context doesn't hold. */
  dropped: number;
}

const MAX_BULLETS = 3;
const MAX_STEPS = 4;
const MAX_FORECASTS = 2;
const MAX_FOLLOW_UPS = 3;

/** Follow-up questions: trimmed, no repeats (ignoring case), at most three. */
export function cleanFollowUps(list: readonly string[], exclude: readonly string[] = []): string[] {
  const seen = new Set(exclude.map((q) => cleanQuestion(q).toLowerCase()));
  const out: string[] = [];
  for (const raw of list) {
    const q = cleanQuestion(raw).slice(0, 120);
    const key = q.toLowerCase();
    if (q.length < MIN_QUESTION || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_FOLLOW_UPS) break;
  }
  return out;
}

/** Steps in order, joined into chains where one step starts where the last ended. */
export function chainSteps(steps: readonly { from: AskStory; to: AskStory; link: CascadeLink }[]): CascadeChain[] {
  const chains: CascadeChain[] = [];
  for (const step of steps) {
    const last = chains[chains.length - 1];
    const tail = last?.nodes[last.nodes.length - 1];
    if (last && tail?.id === step.from.id && !last.nodes.some((n) => n.id === step.to.id)) {
      last.nodes.push(step.to);
      last.links.push(step.link);
    } else {
      chains.push({ nodes: [step.from, step.to], links: [step.link] });
    }
  }
  return chains;
}

/**
 * Keep only what the context supports: citations of stories it holds,
 * cascade steps that are stored links between two of its stories, and its
 * forecasts. A bullet left with no citation is dropped; with no bullets
 * left, the answer is "not enough evidence".
 */
export function shapeAnswer(raw: AskAnswer, ctx: AskContextResponse, question = ""): ShapedAnswer {
  const stories = new Map(ctx.stories.map((s) => [s.id, s]));
  let dropped = 0;

  const bullets: AnswerBullet[] = [];
  for (const bullet of raw.bullets) {
    const cites: AskStory[] = [];
    for (const id of bullet.cite) {
      const story = stories.get(id);
      if (!story) dropped += 1;
      else if (!cites.includes(story)) cites.push(story);
    }
    const text = bullet.text.trim();
    if (cites.length > 0 && text) bullets.push({ text, cites });
    if (bullets.length >= MAX_BULLETS) break;
  }

  const followUps = cleanFollowUps(raw.follow_up, question ? [question] : []);
  if (raw.status !== "answered" || bullets.length === 0) {
    return { status: "not_enough_evidence", bullets: [], cascade: [], forecasts: [], followUps, dropped };
  }

  const steps: { from: AskStory; to: AskStory; link: CascadeLink }[] = [];
  const used = new Set<number>();
  for (const step of raw.cascade) {
    const from = stories.get(step.from);
    const to = stories.get(step.to);
    const link = ctx.links.find((l) => l.src === step.from && l.dst === step.to);
    if (!from || !to || !link || from === to) {
      dropped += 1;
      continue;
    }
    if (used.has(link.id)) continue;
    used.add(link.id);
    steps.push({ from, to, link });
    if (steps.length >= MAX_STEPS) break;
  }

  const forecastsById = new Map(ctx.forecasts.map((f) => [f.id, f]));
  const forecasts: ForecastSummary[] = [];
  for (const id of raw.forecasts) {
    const forecast = forecastsById.get(id);
    if (!forecast) dropped += 1;
    else if (!forecasts.includes(forecast)) forecasts.push(forecast);
    if (forecasts.length >= MAX_FORECASTS) break;
  }

  return { status: "answered", bullets, cascade: chainSteps(steps), forecasts, followUps, dropped };
}

/** "Not enough evidence" without asking the AI (the context was empty). */
export function notEnoughEvidence(followUps: readonly string[] = []): ShapedAnswer {
  return {
    status: "not_enough_evidence",
    bullets: [],
    cascade: [],
    forecasts: [],
    followUps: cleanFollowUps(followUps),
    dropped: 0,
  };
}

/** The stories an answer cites, in order of first citation. */
export function citedStories(answer: ShapedAnswer): AskStory[] {
  const out: AskStory[] = [];
  for (const bullet of answer.bullets) for (const s of bullet.cites) if (!out.includes(s)) out.push(s);
  return out;
}

// ---------------------------------------------------------------------------
// Suggested questions
// ---------------------------------------------------------------------------

/** What Ask was opened about (a region, story, forecast or other entity). */
export interface AskScope {
  id: string;
  type: EntityType;
  name: string;
  /** A place to mention, e.g. the story's region. */
  place?: string | null;
  /** The main thing a story or forecast is about, e.g. the commodity "Crude oil". */
  topic?: { name: string; type: EntityType } | null;
  /** The region's busiest sector. */
  sector?: SectorId | null;
}

/** Questions that work on the sample data and on live news alike. */
export const DEFAULT_SUGGESTIONS: readonly string[] = [
  "What's driving fuel costs in India?",
  "How are Red Sea detours affecting shipping costs?",
  "Where are the new opportunities in solar power?",
  "What could a Fed rate cut change for borrowers?",
];

/** Lowercase the first letter of a name used mid-sentence, unless it looks like an acronym ("GDP"). */
export function midSentence(name: string): string {
  if (name.length > 1 && name[1] === name[1].toLowerCase()) return name.charAt(0).toLowerCase() + name.slice(1);
  return name;
}

/** A name as it reads mid-sentence: commodities and sectors are common nouns, the rest are names. */
export function inSentence(name: string, type: EntityType): string {
  return type === "commodity" || type === "sector" ? midSentence(name) : name;
}

function sectorWords(sector: SectorId): string {
  return midSentence(SECTORS[sector]?.label ?? sector);
}

function unique(list: (string | null | false | undefined)[], max: number): string[] {
  const out: string[] = [];
  for (const q of list) if (q && !out.includes(q)) out.push(q);
  return out.slice(0, max);
}

/**
 * Three or four questions about the scope, worded so retrieval finds it
 * (they name the place or thing). Without a scope: the defaults, led by
 * the viewer's own sector when a business profile has one.
 */
export function suggestionsFor(scope: AskScope | null, profileSectors: readonly SectorId[] = []): string[] {
  if (!scope) {
    const mine = profileSectors[0];
    return unique([mine && `What's changing for ${sectorWords(mine)} businesses?`, ...DEFAULT_SUGGESTIONS], 4);
  }
  const name = inSentence(scope.name, scope.type);
  switch (scope.type) {
    case "region":
      return unique(
        [
          `What's changing for business in ${name}?`,
          scope.sector && `How is ${sectorWords(scope.sector)} doing in ${name}?`,
          `Where are the opportunities in ${name}?`,
          `Which risks should businesses in ${name} watch?`,
        ],
        4,
      );
    case "commodity":
      return [
        `What's driving ${name} prices?`,
        `Who is affected by ${name} prices?`,
        `What does the crowd expect for ${name}?`,
      ];
    case "sector":
      return [
        `What's moving the ${name} sector?`,
        `Where are the opportunities in ${name}?`,
        `Which risks face ${name} businesses?`,
      ];
    case "story":
    case "forecast": {
      const topic = scope.topic ? inSentence(scope.topic.name, scope.topic.type) : (scope.place ?? null);
      if (!topic) return suggestionsFor(null);
      return unique(
        [
          `What's driving ${topic}?`,
          `What could happen next for ${topic}?`,
          scope.place && scope.place !== topic && `How could ${topic} affect ${scope.place}?`,
        ],
        3,
      );
    }
    default:
      return [`What's changing around ${name}?`, `Which businesses does ${name} affect?`, `Which risks involve ${name}?`];
  }
}

/** The main non-place thing among a story's or forecast's entities (commodities first). */
export function mainTopic(
  entities: readonly { name: string; type: EntityType }[],
): { name: string; type: EntityType } | null {
  const rank: Partial<Record<EntityType, number>> = {
    commodity: 0,
    infrastructure: 1,
    policy: 2,
    organization: 3,
    indicator: 4,
  };
  let best: { name: string; type: EntityType } | null = null;
  for (const e of entities) {
    const r = rank[e.type];
    if (r === undefined) continue;
    if (!best || r < (rank[best.type] ?? 9)) best = { name: e.name, type: e.type };
  }
  return best;
}
