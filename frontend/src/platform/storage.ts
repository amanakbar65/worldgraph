/**
 * Per-viewer data that should survive a reload: the business profile,
 * watchlist, alert rules and entity notes.
 *
 * - Test link (claude.ai Artifact): the `db` capability, in the viewer's own
 *   private subtree `data/users/<id>/...` (needs `user` for the id). It
 *   follows the viewer across devices.
 * - Otherwise (website, previews, db unavailable): this browser's
 *   localStorage, falling back to memory when storage is blocked.
 *
 * Values are JSON. Keys are short slugs ("profile", "watchlist", "notes").
 */
import { useCallback, useEffect, useState } from "react";

import { capability } from "./runtime";

export interface UserStore {
  /** "cloud": saved to the viewer's Claude account; "browser": this browser; "memory": this visit only. */
  readonly kind: "cloud" | "browser" | "memory";
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFIX = "worldgraph.user.";

function checkKey(key: string): void {
  if (!KEY.test(key)) throw new TypeError(`Bad storage key: ${key}`);
}

function memoryStore(): UserStore {
  const values = new Map<string, string>();
  return {
    kind: "memory",
    get: async <T,>(key: string) => {
      checkKey(key);
      const raw = values.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    set: async (key, value) => {
      checkKey(key);
      values.set(key, JSON.stringify(value));
    },
    remove: async (key) => {
      checkKey(key);
      values.delete(key);
    },
  };
}

function browserStore(): UserStore | null {
  try {
    const probe = `${PREFIX}probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
  } catch {
    return null;
  }
  return {
    kind: "browser",
    get: async <T,>(key: string) => {
      checkKey(key);
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? null : (JSON.parse(raw) as T);
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      checkKey(key);
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    },
    remove: async (key) => {
      checkKey(key);
      localStorage.removeItem(PREFIX + key);
    },
  };
}

async function cloudStore(): Promise<UserStore | null> {
  const [db, user] = await Promise.all([capability("db"), capability("user")]);
  if (!db || !user) return null;
  let uid: string | null = null;
  try {
    uid = await user.id();
  } catch {
    return null;
  }
  if (!uid) return null;
  const base = `data/users/${uid}`;
  return {
    kind: "cloud",
    get: async <T,>(key: string) => {
      checkKey(key);
      const snap = await db.doc(`${base}/${key}`).get();
      if (!snap.exists) return null;
      const data = snap.data() as { value?: unknown } | undefined;
      return (data?.value ?? null) as T | null;
    },
    set: async (key, value) => {
      checkKey(key);
      await db.doc(`${base}/${key}`).set({ value: value as unknown, updated_at: new Date().toISOString() });
    },
    remove: async (key) => {
      checkKey(key);
      await db.doc(`${base}/${key}`).delete();
    },
  };
}

let storePromise: Promise<UserStore> | null = null;

/** The best store available in this view (resolved once). */
export function getUserStore(): Promise<UserStore> {
  storePromise ??= cloudStore()
    .catch(() => null)
    .then((cloud) => cloud ?? browserStore() ?? memoryStore());
  return storePromise;
}

/**
 * A stored value as React state. Writes go through to the store; a failed
 * write keeps the new value for this visit and reports `saveError`.
 */
export function useUserValue<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<UserStore["kind"] | null>(null);
  const [saveError, setSaveError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    void getUserStore().then(async (store) => {
      try {
        const stored = await store.get<T>(key);
        if (alive && stored !== null) setValue(stored);
      } catch {
        // Unreadable: keep the fallback.
      }
      if (alive) {
        setKind(store.kind);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const save = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        void getUserStore()
          .then((store) => store.set(key, resolved))
          .then(() => setSaveError(null))
          .catch((error: unknown) => setSaveError(error instanceof Error ? error : new Error(String(error))));
        return resolved;
      });
    },
    [key],
  );

  return { value, setValue: save, loading, kind, saveError } as const;
}

export const __testing = { memoryStore, browserStore, reset: () => (storePromise = null) };
