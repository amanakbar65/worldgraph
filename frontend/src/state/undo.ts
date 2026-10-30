/**
 * Personal undo and redo (Phase A4): the viewer's own edits (notes on
 * entity pages, the business profile, the watchlist and alert settings)
 * keep a change list of the last 50, stored with the viewer's own data
 * (the user store, key "undo": `data/users/<id>` in the test link, this
 * browser on the website), so it survives a reload.
 *
 * Each entry keeps only what changed: for an object value the changed
 * fields (a note per entity id, a profile list), for a list the whole list.
 * Undo writes the "before" side back through the value's own store; redo
 * the "after" side. A new edit clears redo. World-graph corrections are not
 * here: they go through the pipeline (`wg history revert`).
 *
 * The values register themselves (stored-value.ts), so this module
 * imports none of them.
 */
import { create } from "zustand";

import { getUserStore } from "@/platform/storage";

/** The values that take part, by their storage key. */
export const UNDO_KEYS = ["notes", "profile", "watchlist", "alerts"] as const;
export type UndoKey = (typeof UNDO_KEYS)[number];

/** How many edits are kept (undo) and how many undone ones (redo). */
export const UNDO_MAX = 50;
/** Edits with the same merge key this close together undo as one (a burst of typing). */
export const MERGE_MS = 5000;
/** The stored list's key in the user store. */
export const UNDO_STORAGE_KEY = "undo";

/** One value's change. */
export interface UndoChange {
  key: UndoKey;
  /** True: before and after are whole values (lists). False: they map each changed field to its value (null: absent). */
  whole: boolean;
  before: unknown;
  after: unknown;
}

/** One edit, as the viewer made it (it may change more than one value). */
export interface UndoEntry {
  id: string;
  /** When (ms since the epoch); a merged entry has its latest edit's time. */
  at: number;
  /** What changed, in a few words: "note on DP World". */
  label: string;
  changes: UndoChange[];
  merge?: string;
}

export interface UndoLog {
  /** Oldest first; the last is undone first. */
  done: UndoEntry[];
  /** Undone edits, the last undone at the end; redo takes it first. */
  undone: UndoEntry[];
}

export const EMPTY_LOG: UndoLog = { done: [], undone: [] };

// ---------------------------------------------------------------------------
// Pure helpers (tested on their own)
// ---------------------------------------------------------------------------

type Fields = Record<string, unknown>;

const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed between two values of `key`; null when nothing did. */
export function diffValues(key: UndoKey, before: unknown, after: unknown): UndoChange | null {
  if (isFields(before) && isFields(after)) {
    const b: Fields = {};
    const a: Fields = {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(before[field], after[field])) continue;
      b[field] = before[field] ?? null;
      a[field] = after[field] ?? null;
    }
    return Object.keys(a).length ? { key, whole: false, before: b, after: a } : null;
  }
  return same(before, after) ? null : { key, whole: true, before, after };
}

/** The value with one side of a change put back ("before" undoes, "after" redoes). */
export function applyChange(current: unknown, change: UndoChange, side: "before" | "after"): unknown {
  const patch = change[side];
  if (change.whole || !isFields(patch)) return patch;
  const next: Fields = isFields(current) ? { ...current } : {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete next[field];
    else next[field] = value;
  }
  return next;
}

/** Two changes of the same value, one after the other, as one. */
function combine(first: UndoChange, second: UndoChange): UndoChange | null {
  if (first.whole || second.whole) {
    return same(first.before, second.after) ? null : { ...second, whole: true, before: first.before };
  }
  const before = { ...(second.before as Fields), ...(first.before as Fields) };
  const after = { ...(first.after as Fields), ...(second.after as Fields) };
  for (const field of Object.keys(after)) {
    if (same(before[field], after[field])) {
      delete before[field];
      delete after[field];
    }
  }
  return Object.keys(after).length ? { key: first.key, whole: false, before, after } : null;
}

/** Changes in order, with repeated values combined. */
export function combineChanges(changes: UndoChange[]): UndoChange[] {
  const out: UndoChange[] = [];
  for (const change of changes) {
    const at = out.findIndex((c) => c.key === change.key);
    if (at < 0) {
      out.push(change);
      continue;
    }
    const merged = combine(out[at], change);
    if (merged) out[at] = merged;
    else out.splice(at, 1);
  }
  return out;
}

/**
 * The list after a new edit: it goes on the end (or merges into the last
 * entry when both have the same merge key and came within MERGE_MS), redo
 * is cleared, and only the newest UNDO_MAX are kept.
 */
export function pushEntry(log: UndoLog, entry: UndoEntry): UndoLog {
  const last = log.done[log.done.length - 1];
  if (entry.merge && last && last.merge === entry.merge && entry.at - last.at <= MERGE_MS) {
    const changes = combineChanges([...last.changes, ...entry.changes]);
    const done = log.done.slice(0, -1);
    if (changes.length) done.push({ ...last, at: entry.at, label: entry.label, changes });
    return { done, undone: [] };
  }
  return { done: [...log.done, entry].slice(-UNDO_MAX), undone: [] };
}

/** Which entries an Undo button acts on (all, by default). */
export type UndoScope = (entry: UndoEntry) => boolean;

/** Entries that change `key` (and, for an object value, its `field`: one note, say). */
export function touching(key: UndoKey, field?: string): UndoScope {
  return (entry) =>
    entry.changes.some(
      (c) =>
        c.key === key &&
        (field === undefined || c.whole || (isFields(c.after) && field in c.after) || (isFields(c.before) && field in c.before)),
    );
}

/** Entries that change any of these values. */
export function touchingAny(keys: readonly UndoKey[]): UndoScope {
  return (entry) => entry.changes.some((c) => keys.includes(c.key));
}

function lastIndex(list: UndoEntry[], scope: UndoScope | undefined): number {
  for (let i = list.length - 1; i >= 0; i--) if (!scope || scope(list[i])) return i;
  return -1;
}

/** The entry the next undo takes, or null. */
export function nextUndo(log: UndoLog, scope?: UndoScope): UndoEntry | null {
  const i = lastIndex(log.done, scope);
  return i < 0 ? null : log.done[i];
}

/** The entry the next redo takes, or null. */
export function nextRedo(log: UndoLog, scope?: UndoScope): UndoEntry | null {
  const i = lastIndex(log.undone, scope);
  return i < 0 ? null : log.undone[i];
}

/** Move the latest entry in scope from done to undone. */
export function undoStep(log: UndoLog, scope?: UndoScope): { log: UndoLog; entry: UndoEntry } | null {
  const i = lastIndex(log.done, scope);
  if (i < 0) return null;
  const entry = log.done[i];
  return {
    entry,
    log: { done: log.done.filter((_, j) => j !== i), undone: [...log.undone, entry].slice(-UNDO_MAX) },
  };
}

/** Move the latest undone entry in scope back to done. */
export function redoStep(log: UndoLog, scope?: UndoScope): { log: UndoLog; entry: UndoEntry } | null {
  const i = lastIndex(log.undone, scope);
  if (i < 0) return null;
  const entry = log.undone[i];
  return {
    entry,
    log: { done: [...log.done, entry].slice(-UNDO_MAX), undone: log.undone.filter((_, j) => j !== i) },
  };
}

const isKey = (k: unknown): k is UndoKey => (UNDO_KEYS as readonly unknown[]).includes(k);

function cleanEntry(raw: unknown): UndoEntry | null {
  if (!isFields(raw)) return null;
  const { id, at, label, changes, merge } = raw;
  if (typeof id !== "string" || typeof at !== "number" || typeof label !== "string" || !Array.isArray(changes)) {
    return null;
  }
  const clean: UndoChange[] = [];
  for (const c of changes) {
    if (!isFields(c) || !isKey(c.key) || typeof c.whole !== "boolean") return null;
    if (!c.whole && (!isFields(c.before) || !isFields(c.after))) return null;
    clean.push({ key: c.key, whole: c.whole, before: c.before, after: c.after });
  }
  if (!clean.length) return null;
  return { id, at, label: label.slice(0, 120), changes: clean, ...(typeof merge === "string" ? { merge } : {}) };
}

/** A stored list, made safe: unknown shapes dropped, the limits applied. */
export function normalizeLog(raw: unknown): UndoLog {
  if (!isFields(raw)) return EMPTY_LOG;
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map(cleanEntry)
      .filter((e): e is UndoEntry => e !== null)
      .slice(-UNDO_MAX);
  return { done: list(raw.done), undone: list(raw.undone) };
}

// ---------------------------------------------------------------------------
// The values (registered by stored-value.ts)
// ---------------------------------------------------------------------------

export interface UndoTarget {
  get: () => unknown;
  /** Write a value without recording it. */
  apply: (value: unknown) => void;
  /** Resolves once the stored value has been read. */
  ready: () => Promise<void>;
}

const targets = new Map<UndoKey, UndoTarget>();

export function registerUndoTarget(key: UndoKey, target: UndoTarget): void {
  targets.set(key, target);
}

/**
 * Names for ids in labels ("added Gujarat to your watchlist"): whatever
 * this visit has seen (registered by the screens that know names).
 */
let nameResolver: (id: string) => string | null = () => null;

export function setUndoNameResolver(resolve: (id: string) => string | null): void {
  nameResolver = resolve;
}

/** A readable name for an id: a known one, else from its slug ("commodity:crude-oil" → "Crude oil"). */
export function nameForLabel(id: string): string {
  const known = nameResolver(id);
  if (known) return known;
  const slug = id.slice(id.indexOf(":") + 1).split(".").pop() ?? id;
  const words = slug.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// The viewer's list
// ---------------------------------------------------------------------------

interface UndoState extends UndoLog {
  /** The stored list has been read (edits made before that are kept). */
  loaded: boolean;
  /** The last thing said ("Undone: note on DP World"), for the polite live region. */
  message: { text: string; n: number } | null;
}

export const useUndo = create<UndoState>(() => ({ ...EMPTY_LOG, loaded: false, message: null }));

let loading: Promise<void> | null = null;
let saving: Promise<void> = Promise.resolve();
let pending: { label: string; merge?: string; changes: UndoChange[] } | null = null;
let busy = false;
let nextId = 0;

const newId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

function save(): void {
  const { done, undone } = useUndo.getState();
  const value = { v: 1, done, undone };
  saving = saving
    .then(() => getUserStore())
    .then((store) => store.set(UNDO_STORAGE_KEY, value))
    .catch(() => undefined); // Not saved: the list still works for this visit.
}

/** Read the stored list once; edits made before it arrives go after it. */
export function loadUndoLog(): Promise<void> {
  loading ??= (async () => {
    let stored = EMPTY_LOG;
    try {
      const store = await getUserStore();
      stored = normalizeLog(await store.get<unknown>(UNDO_STORAGE_KEY));
    } catch {
      // Unreadable: start empty.
    }
    const now = useUndo.getState();
    useUndo.setState({
      done: [...stored.done, ...now.done].slice(-UNDO_MAX),
      // A new edit clears redo, including what was stored.
      undone: now.done.length ? now.undone : [...stored.undone, ...now.undone].slice(-UNDO_MAX),
      loaded: true,
    });
    if (now.done.length || now.undone.length) save();
  })();
  return loading;
}

/** Put the edits of this moment (one tap may change two values) on the list. */
function flush(): void {
  if (!pending) return;
  const { label, merge, changes } = pending;
  pending = null;
  const combined = combineChanges(changes);
  if (!combined.length) return;
  const entry: UndoEntry = { id: newId(), at: Date.now(), label, changes: combined, ...(merge ? { merge } : {}) };
  const { done, undone } = useUndo.getState();
  useUndo.setState(pushEntry({ done, undone }, entry));
  save();
}

/**
 * Record an edit of one value (stored-value.ts calls this on every change
 * it is asked to make). Edits made in the same moment become one entry,
 * named after the first.
 */
export function recordChange(
  key: UndoKey,
  before: unknown,
  after: unknown,
  options: { label: string; merge?: string },
): void {
  const change = diffValues(key, before, after);
  if (!change) return;
  if (pending) {
    pending.changes.push(change);
    if (pending.merge !== options.merge) pending.merge = undefined;
    return;
  }
  pending = { label: options.label, merge: options.merge, changes: [change] };
  queueMicrotask(flush);
}

function announce(text: string): void {
  const n = (useUndo.getState().message?.n ?? 0) + 1;
  useUndo.setState({ message: { text, n } });
}

async function step(kind: "undo" | "redo", scope?: UndoScope): Promise<UndoEntry | null> {
  flush();
  await loadUndoLog();
  if (busy) return null;
  const { done, undone } = useUndo.getState();
  const taken = kind === "undo" ? undoStep({ done, undone }, scope) : redoStep({ done, undone }, scope);
  if (!taken) {
    announce(kind === "undo" ? "Nothing to undo" : "Nothing to redo");
    return null;
  }
  busy = true;
  try {
    const changes = kind === "undo" ? [...taken.entry.changes].reverse() : taken.entry.changes;
    for (const change of changes) {
      const target = targets.get(change.key);
      if (!target) throw new Error(`Nothing to apply ${change.key} to`);
      await target.ready();
      target.apply(applyChange(target.get(), change, kind === "undo" ? "before" : "after"));
    }
    useUndo.setState(taken.log);
    save();
    announce(`${kind === "undo" ? "Undone" : "Redone"}: ${taken.entry.label}`);
    return taken.entry;
  } catch {
    announce(kind === "undo" ? "Couldn't undo that" : "Couldn't redo that");
    return null;
  } finally {
    busy = false;
  }
}

/** Undo the latest edit (in scope); says "Undone: …" politely. */
export const undo = (scope?: UndoScope) => step("undo", scope);
/** Redo the latest undone edit (in scope); says "Redone: …" politely. */
export const redo = (scope?: UndoScope) => step("redo", scope);

/** Tests only. */
export const __testing = {
  reset: () => {
    loading = null;
    saving = Promise.resolve();
    pending = null;
    busy = false;
    useUndo.setState({ ...EMPTY_LOG, loaded: false, message: null });
  },
  flush,
  /** Wait for queued saves. */
  saved: () => saving,
};
