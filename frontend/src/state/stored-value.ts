/**
 * One per-viewer value (the business profile, the watchlist, notes…) kept
 * in the user store (platform/storage.ts) and shared by every screen, so
 * they always agree. Values that people edit by hand join the personal
 * undo list (state/undo.ts): each change is recorded with a short label,
 * and undo or redo writes the earlier value back through the same store.
 */
import { useEffect } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";

import { getUserStore, type UserStore } from "@/platform/storage";

import { recordChange, registerUndoTarget, type UndoKey } from "./undo";

/** How one edit appears in the undo list. */
export interface EditOptions {
  /** What changed, in a few words ("note on DP World"); the value's own describer otherwise. */
  label?: string;
  /** Edits with the same merge key, close together, undo as one (typing in a note). */
  merge?: string;
}

export interface StoredValue<T> {
  value: T;
  /** False until the stored value has been read. */
  loaded: boolean;
  /** Where it's saved: "cloud" (your Claude account), "browser", or "memory" (this visit only). */
  kind: UserStore["kind"] | null;
  saveError: Error | null;
  /** Change the value; it's saved right away (and can be undone, for edited values). */
  set: (next: T | ((prev: T) => T), options?: EditOptions) => void;
  /** Read the stored value again (another screen may have changed it). */
  refresh: () => Promise<void>;
}

export interface StoredValueHandle<T> {
  store: UseBoundStore<StoreApi<StoredValue<T>>>;
  /** Load once (later calls do nothing). */
  ensure: () => void;
  reset: () => void;
}

/** A value people edit: its place in the undo list and how its changes read. */
export interface UndoableValue<T> {
  key: UndoKey;
  describe: (before: T, after: T) => string;
}

export function createStoredValue<T>(
  key: string,
  fallback: T,
  normalize: (raw: unknown) => T,
  undoable?: UndoableValue<T>,
): StoredValueHandle<T> {
  let version = 0; // bumped by every local change, so a slower read never overwrites it
  let started = false;
  const initial = { value: fallback, loaded: false, kind: null, saveError: null };

  const store = create<StoredValue<T>>((set, get) => ({
    ...initial,
    set: (next, options) => {
      const before = get().value;
      const resolved = normalize(typeof next === "function" ? (next as (prev: T) => T)(before) : next);
      if (undoable) {
        recordChange(undoable.key, before, resolved, {
          label: options?.label ?? undoable.describe(before, resolved),
          merge: options?.merge,
        });
      }
      write(resolved);
    },
    refresh: async () => {
      const at = version;
      const userStore = await getUserStore();
      let value: T | undefined;
      try {
        const raw = await userStore.get<unknown>(key);
        value = raw === null ? undefined : normalize(raw);
      } catch {
        // Unreadable: keep what we have.
      }
      if (version !== at) {
        set({ loaded: true, kind: userStore.kind });
        return;
      }
      set({ loaded: true, kind: userStore.kind, ...(value !== undefined ? { value } : {}) });
    },
  }));

  /** Change and save without recording (what set does after recording; undo and redo use it directly). */
  function write(resolved: T) {
    version += 1;
    store.setState({ value: resolved });
    void getUserStore()
      .then((userStore) => userStore.set(key, resolved))
      .then(() => store.setState({ saveError: null }))
      .catch((error: unknown) =>
        store.setState({ saveError: error instanceof Error ? error : new Error(String(error)) }),
      );
  }

  const ensure = () => {
    if (started) return;
    started = true;
    void store.getState().refresh();
  };

  if (undoable) {
    registerUndoTarget(undoable.key, {
      get: () => store.getState().value,
      apply: (value) => write(normalize(value)),
      ready: async () => {
        if (store.getState().loaded) return;
        started = true;
        await store.getState().refresh();
      },
    });
  }

  return {
    store,
    ensure,
    reset: () => {
      version = 0;
      started = false;
      store.setState({ ...initial });
    },
  };
}

/** The value as React state, loaded on first use. */
export function useStored<T>(handle: StoredValueHandle<T>): StoredValue<T> {
  useEffect(() => handle.ensure(), [handle]);
  return handle.store();
}
