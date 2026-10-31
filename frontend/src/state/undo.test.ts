import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __testing as storage } from "@/platform/storage";

import { notesValue, saveNote } from "./notes";
import { __testing as profileStore, emptyProfile } from "./profile";
import {
  __testing as undoStore,
  applyChange,
  diffValues,
  EMPTY_LOG,
  MERGE_MS,
  nextRedo,
  normalizeLog,
  pushEntry,
  redo,
  setUndoNameResolver,
  touching,
  undo,
  UNDO_MAX,
  UNDO_STORAGE_KEY,
  useUndo,
  type UndoEntry,
  type UndoLog,
} from "./undo";

const entry = (n: number, extra: Partial<UndoEntry> = {}): UndoEntry => ({
  id: `e${n}`,
  at: 1_000_000 + n * 60_000,
  label: `edit ${n}`,
  changes: [{ key: "notes", whole: false, before: { [`org:n${n}`]: null }, after: { [`org:n${n}`]: `note ${n}` } }],
  ...extra,
});

describe("the change list (pure)", () => {
  it("keeps only what changed, and puts either side back", () => {
    const before = { "org:a": "one", "org:b": "two" };
    const after = { "org:a": "one", "org:c": "three" };
    const change = diffValues("notes", before, after)!;
    expect(change).toEqual({
      key: "notes",
      whole: false,
      before: { "org:b": "two", "org:c": null },
      after: { "org:b": null, "org:c": "three" },
    });
    expect(applyChange(after, change, "before")).toEqual(before);
    expect(applyChange(before, change, "after")).toEqual(after);
    // Another note changed since stays as it is.
    expect(applyChange({ ...after, "org:d": "four" }, change, "before")).toEqual({ ...before, "org:d": "four" });
    expect(diffValues("notes", before, { ...before })).toBeNull();
  });

  it("keeps whole lists", () => {
    const change = diffValues("watchlist", ["region:in"], ["region:in", "forecast:fed-cut"])!;
    expect(change.whole).toBe(true);
    expect(applyChange(["anything"], change, "before")).toEqual(["region:in"]);
    expect(diffValues("watchlist", ["region:in"], ["region:in"])).toBeNull();
  });

  it(`keeps the last ${UNDO_MAX} edits`, () => {
    let log: UndoLog = EMPTY_LOG;
    for (let n = 1; n <= UNDO_MAX + 10; n++) log = pushEntry(log, entry(n));
    expect(log.done).toHaveLength(UNDO_MAX);
    expect(log.done[0].id).toBe("e11");
    expect(log.done.at(-1)?.id).toBe(`e${UNDO_MAX + 10}`);
  });

  it("clears redo on a new edit", () => {
    const log = pushEntry({ done: [entry(1)], undone: [entry(2)] }, entry(3));
    expect(log.undone).toEqual([]);
    expect(nextRedo(log)).toBeNull();
  });

  it("merges a burst of typing in one note, and not after a pause", () => {
    const a = entry(1, { merge: "note:org:a", changes: [{ key: "notes", whole: false, before: { "org:a": null }, after: { "org:a": "H" } }] });
    const b = { ...a, id: "b", at: a.at + 1000, changes: [{ key: "notes" as const, whole: false, before: { "org:a": "H" }, after: { "org:a": "Hi" } }] };
    const merged = pushEntry(pushEntry(EMPTY_LOG, a), b);
    expect(merged.done).toHaveLength(1);
    expect(merged.done[0].changes[0]).toEqual({ key: "notes", whole: false, before: { "org:a": null }, after: { "org:a": "Hi" } });
    const later = pushEntry(pushEntry(EMPTY_LOG, a), { ...b, at: a.at + MERGE_MS + 1 });
    expect(later.done).toHaveLength(2);
    // Typing back to where it started leaves nothing to undo.
    const back = pushEntry(merged, { ...b, at: b.at + 500, changes: [{ key: "notes", whole: false, before: { "org:a": "Hi" }, after: { "org:a": null } }] });
    expect(back.done).toHaveLength(0);
  });

  it("finds a page's own edits", () => {
    const log = { done: [entry(1), entry(2)], undone: [] };
    expect(touching("notes", "org:n1")(log.done[0])).toBe(true);
    expect(touching("notes", "org:n1")(log.done[1])).toBe(false);
    expect(touching("profile")(log.done[0])).toBe(false);
  });

  it("reads a stored list safely", () => {
    expect(normalizeLog(null)).toEqual(EMPTY_LOG);
    expect(normalizeLog({ done: [entry(1), { id: 3 }, entry(2, { changes: [{ key: "secrets", whole: true, before: 1, after: 2 }] as never })] }).done).toEqual([
      entry(1),
    ]);
  });
});

describe("undo and redo of the viewer's own edits", () => {
  const watch = () => profileStore.stores.watchlist.getState();
  const stored = (key: string) => JSON.parse(localStorage.getItem(`worldgraph.user.${key}`) ?? "null") as unknown;
  const settle = async () => {
    await Promise.resolve(); // the edit joins the list
    await undoStore.saved();
    await new Promise((r) => setTimeout(r, 0));
  };
  /** A reload: every module forgets what it loaded; only storage remains. */
  const reload = () => {
    undoStore.reset();
    profileStore.reset();
    notesValue.reset();
    storage.reset();
  };

  beforeEach(() => {
    localStorage.clear();
    reload();
    setUndoNameResolver((id) => (id === "region:in-gj" ? "Gujarat" : null));
  });
  afterEach(() => setUndoNameResolver(() => null));

  it("undoes and redoes a watchlist change, saying what it did", async () => {
    await watch().refresh();
    watch().set(["region:in-gj"]);
    await settle();
    expect(useUndo.getState().done.at(-1)?.label).toBe("added Gujarat to your watchlist");

    await undo();
    expect(watch().value).toEqual([]);
    expect(useUndo.getState().message?.text).toBe("Undone: added Gujarat to your watchlist");
    await redo();
    expect(watch().value).toEqual(["region:in-gj"]);
    expect(useUndo.getState().message?.text).toBe("Redone: added Gujarat to your watchlist");
    await settle();
    expect(stored("watchlist")).toEqual(["region:in-gj"]);
  });

  it(`undoes at most ${UNDO_MAX} edits`, async () => {
    await notesValue.store.getState().refresh();
    for (let n = 1; n <= UNDO_MAX + 5; n++) {
      saveNote(`org:n${n}`, `Org ${n}`, `note ${n}`);
      await Promise.resolve();
    }
    expect(useUndo.getState().done).toHaveLength(UNDO_MAX);
    for (let n = 0; n < UNDO_MAX; n++) expect(await undo()).not.toBeNull();
    expect(await undo()).toBeNull();
    expect(useUndo.getState().message?.text).toBe("Nothing to undo");
    // The five oldest edits are past the limit: they stay.
    expect(Object.keys(notesValue.store.getState().value)).toEqual(["org:n1", "org:n2", "org:n3", "org:n4", "org:n5"]);
  });

  it("clears redo when a new edit comes", async () => {
    await notesValue.store.getState().refresh();
    saveNote("org:a", "A", "first");
    await settle();
    await undo();
    expect(useUndo.getState().undone).toHaveLength(1);
    saveNote("org:b", "B", "second");
    await settle();
    expect(useUndo.getState().undone).toHaveLength(0);
    expect(await redo()).toBeNull();
    expect(notesValue.store.getState().value).toEqual({ "org:b": "second" });
  });

  it("undoes one page's note from that page, leaving later edits elsewhere", async () => {
    await notesValue.store.getState().refresh();
    await watch().refresh();
    saveNote("org:a", "Acme", "mine");
    await settle();
    watch().set(["region:in-gj"]);
    await settle();
    await undo(touching("notes", "org:a"));
    expect(notesValue.store.getState().value).toEqual({});
    expect(watch().value).toEqual(["region:in-gj"]);
    expect(useUndo.getState().message?.text).toBe("Undone: note on Acme");
  });

  it("survives a reload through the viewer's storage", async () => {
    await notesValue.store.getState().refresh();
    await profileStore.stores.profile.getState().refresh();
    saveNote("org:a", "Acme", "Call the supplier");
    await settle();
    profileStore.stores.profile.getState().set({ ...emptyProfile, sectors: ["energy"] });
    await settle();
    expect((stored(UNDO_STORAGE_KEY) as { done: unknown[] }).done).toHaveLength(2);

    reload();
    expect(useUndo.getState().done).toHaveLength(0);
    await undo(); // reads the list and the profile back first
    expect(stored("profile")).toMatchObject({ sectors: [] });
    await undo();
    await settle();
    expect(stored("notes")).toEqual({});

    reload();
    expect((await redo())?.label).toBe("note on Acme");
    await settle();
    expect(stored("notes")).toEqual({ "org:a": "Call the supplier" });
    expect(useUndo.getState().undone.map((e) => e.label)).toEqual(["added Energy to your sectors"]);
  });

  it("keeps one tap that changes two values as one step", async () => {
    await watch().refresh();
    await profileStore.stores.rules.getState().refresh();
    watch().set(["forecast:fed-cut"]);
    profileStore.stores.rules.getState().set((r) => ({ ...r, thresholds: { "forecast:fed-cut": 0.6 } }));
    await settle();
    watch().set([]);
    profileStore.stores.rules.getState().set((r) => ({ ...r, thresholds: {} }));
    await settle();
    expect(useUndo.getState().done).toHaveLength(2);
    await undo();
    expect(watch().value).toEqual(["forecast:fed-cut"]);
    expect(profileStore.stores.rules.getState().value.thresholds).toEqual({ "forecast:fed-cut": 0.6 });
  });
});
