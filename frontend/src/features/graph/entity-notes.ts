/**
 * Private notes on entity pages. The stored value and its rules live in
 * state/notes.ts (one shared store, so undo and redo show at once); this
 * module adds what the page needs on top: [[links]] and where it's kept.
 */
import type { UserStore } from "@/platform/storage";

export { cleanNotes, NOTE_MAX, noteChanged, noteFor, NOTES_MAX, withNote, type Notes } from "@/state/notes";

/** Wait this long after the last keystroke before saving. */
export const SAVE_DELAY_MS = 700;

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
