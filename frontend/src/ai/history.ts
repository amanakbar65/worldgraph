/**
 * The earlier turns of an Ask conversation, as both AI engines send them
 * with a follow-up: each turn is the viewer's question and a short text of
 * what the AI answered. The website's AI function checks them with
 * `parseHistory` (the same limits), so neither side can send more.
 */

/** One earlier exchange, oldest first. */
export interface AiTurn {
  /** What the viewer asked. */
  question: string;
  /** A short text of the answer (its points, or that there wasn't enough evidence). */
  answer: string;
}

/** A follow-up carries at most this many earlier turns (the latest ones). */
export const MAX_TURNS = 6;
export const MAX_TURN_QUESTION = 300;
export const MAX_TURN_ANSWER = 1000;

/** Single spaces (line breaks kept, one at a time), trimmed, cut at a word near `max` characters with "…". */
export function clip(text: string, max: number): string {
  const flat = text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[\s]*/g, "\n")
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The last MAX_TURNS turns, each trimmed; turns left empty are dropped. */
export function trimHistory(turns: readonly AiTurn[]): AiTurn[] {
  const out: AiTurn[] = [];
  for (const t of turns) {
    const question = clip(t.question, MAX_TURN_QUESTION);
    const answer = clip(t.answer, MAX_TURN_ANSWER);
    if (question && answer) out.push({ question, answer });
  }
  return out.slice(-MAX_TURNS);
}

/**
 * History from outside (a request body): an array of at most MAX_TURNS
 * {question, answer} strings within the limits; missing means none ([]).
 * Null when it doesn't fit.
 */
export function parseHistory(raw: unknown): AiTurn[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TURNS) return null;
  const out: AiTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { question, answer } = item as { question?: unknown; answer?: unknown };
    if (typeof question !== "string" || typeof answer !== "string") return null;
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a || q.length > MAX_TURN_QUESTION || a.length > MAX_TURN_ANSWER) return null;
    out.push({ question: q, answer: a });
  }
  return out;
}
