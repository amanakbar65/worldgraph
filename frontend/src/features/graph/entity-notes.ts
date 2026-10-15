/**
 * Private notes on entity pages. All notes live in one stored value,
 * "notes": an object from entity id to the note's text. Only the viewer
 * can read it (see platform/storage.ts for where it is kept).
 */
import type { UserStore } from "@/platform/storage";

export type Notes = Record<string, string>;

/** The longest note we keep (a short note, not a document). */
export const NOTE_MAX = 2000;
/** How many notes we keep in all; the oldest edits drop off first. */
export const NOTES_MAX = 500;
/** Wait this long after the last keystroke before saving. */
export const SAVE_DELAY_MS = 700;

const ID = /^[a-z_]+:[a-z0-9][a-z0-9.-]*$/;

/** Stored notes, tidied: anything that isn't an id → text pair is dropped. */
export function cleanNotes(value: unknown): Notes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Notes = {};
  for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
    if (ID.test(id) && typeof text === "string" && text.trim() !== "") out[id] = text.slice(0, NOTE_MAX);
  }
  return out;
}

/** The note on one entity ("" when there is none). */
export function noteFor(notes: unknown, id: string): string {
  return cleanNotes(notes)[id] ?? "";
}

/**
 * The notes with one note changed. An empty note is removed, a long one is
 * cut to {@link NOTE_MAX}, and the edited note moves to the end, so when
 * there are more than {@link NOTES_MAX} the ones edited longest ago go.
 * Use {@link noteChanged} first to skip saves that change nothing.
 */
export function withNote(notes: unknown, id: string, text: string): Notes {
  const current = cleanNotes(notes);
  const next = text.slice(0, NOTE_MAX);
  const keep = next.trim() !== "";
  if (keep ? current[id] === next : !(id in current)) return current;
  const { [id]: _old, ...rest } = current;
  if (!keep) return rest;
  const entries = Object.entries(rest);
  const trimmed = entries.slice(Math.max(0, entries.length - (NOTES_MAX - 1)));
  return { ...Object.fromEntries(trimmed), [id]: next };
}

/** True when saving `text` would change what is stored for `id`. */
export function noteChanged(notes: unknown, id: string, text: string): boolean {
  const stored = noteFor(notes, id);
  const next = text.slice(0, NOTE_MAX);
  return next.trim() === "" ? stored !== "" : stored !== next;
}

/**
 * [[Entity Name]] links written in a note: their names, in order, each
 * once (case-insensitive), at most `max`.
 */
export function noteLinks(text: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[\[([^[\]\n]{1,80})\]\]/g)) {
    const name = match[1].trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (name.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** Where a note is kept, in plain words. */
export function savedWhere(kind: UserStore["kind"] | null): string {
  switch (kind) {
    case "cloud":
      return "Private to you. Saved to your Claude account.";
    case "browser":
      return "Private to you. Saved in this browser only.";
    case "memory":
      return "Kept for this visit only: this view can't save notes.";
    default:
      return "Private to you.";
  }
}
