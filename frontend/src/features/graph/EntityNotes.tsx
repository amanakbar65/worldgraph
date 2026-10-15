import { Check, Link2, LockKeyhole, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { EntityType } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EntityChip } from "@/components/EntityChip";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { getUserStore, useUserValue } from "@/platform/storage";

import { NOTE_MAX, noteChanged, noteFor, noteLinks, SAVE_DELAY_MS, savedWhere, withNote, type Notes } from "./entity-notes";
import { useDebounced } from "./use-debounced";

export interface EntityNotesProps {
  id: string;
  name: string;
  /** Open a page linked from the note. */
  onOpen: (node: { id: string; type: EntityType }) => void;
}

type SaveState = "idle" | "pending" | "saved";

/**
 * A short private note on this page. It saves itself a moment after you
 * stop typing (and when you leave the box or the page), says where it is
 * kept, and turns [[Entity Name]] into links to those pages.
 */
export function EntityNotes({ id, name, onOpen }: EntityNotesProps) {
  const notes = useUserValue<Notes>("notes", {});
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SaveState>("idle");

  // Fill the box once the stored notes have loaded.
  if (!ready && !notes.loading) {
    setReady(true);
    setDraft(noteFor(notes.value, id));
  }

  // The latest values, for timers and for saving on the way out.
  const live = useRef({ draft, value: notes.value as unknown, pending: false });
  useEffect(() => {
    live.current.draft = draft;
    live.current.value = notes.value;
  }, [draft, notes.value]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setValue = notes.setValue;

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    if (!live.current.pending) return;
    live.current.pending = false;
    const { draft: text, value } = live.current;
    if (noteChanged(value, id, text)) setValue((prev) => withNote(prev, id, text));
    setState("saved");
  }, [id, setValue]);

  // Leaving the page (another panel, closing it) saves what was typed.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const { draft: text, value, pending } = live.current;
      if (!pending || !noteChanged(value, id, text)) return;
      void getUserStore()
        .then((store) => store.set("notes", withNote(value, id, text)))
        .catch(() => undefined);
    },
    [id],
  );

  const onChange = (text: string) => {
    setDraft(text);
    live.current.draft = text;
    live.current.pending = true;
    setState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, SAVE_DELAY_MS);
  };

  const links = noteLinks(useDebounced(draft, 600));
  const near = draft.length > NOTE_MAX * 0.85;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="sr-only">
        Your note on {name}
      </label>
      <textarea
        id={inputId}
        value={draft}
        disabled={!ready}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        maxLength={NOTE_MAX}
        rows={4}
        aria-describedby={hintId}
        placeholder={ready ? "Jot down what matters to you here. Write [[Name]] to link another page." : "Loading your note…"}
        className="min-h-24 w-full resize-y rounded-lg border border-line bg-bg-sunken/60 px-3 py-2 text-body text-fg placeholder:text-fg-subtle hover:border-line-strong disabled:opacity-60"
      />
      <div id={hintId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-fg-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LockKeyhole aria-hidden className="size-3.5 shrink-0" />
          {savedWhere(notes.kind)}
        </span>
        <span role="status" aria-live="polite" className="ml-auto inline-flex items-center gap-1 tabular-nums">
          {notes.saveError ? (
            "Couldn't save. Kept for this visit."
          ) : state === "pending" ? (
            "Saving…"
          ) : state === "saved" ? (
            <>
              <Check aria-hidden className="size-3.5" />
              Saved
            </>
          ) : null}
          {near && <span className="text-fg-subtle"> · {NOTE_MAX - draft.length} characters left</span>}
        </span>
      </div>
      {links.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <p className="inline-flex items-center gap-1.5 text-label text-fg-muted">
            <Link2 aria-hidden className="size-3.5" />
            Linked in your note
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {links.map((link) => (
              <li key={link.toLowerCase()} className="max-w-full">
                <NoteLink name={link} selfId={id} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One [[link]]: the page with that name, found with search; plain text when there is none. */
function NoteLink({
  name,
  selfId,
  onOpen,
}: {
  name: string;
  selfId: string;
  onOpen: (node: { id: string; type: EntityType }) => void;
}) {
  const search = useRpc("search", { q: name, limit: 5 }, { refetchInterval: false, staleTime: 600_000 });
  const results = (search.data?.results ?? []).filter((r) => r.type !== "user_entity");
  const wanted = name.toLowerCase();
  const match = results.find((r) => r.name.toLowerCase() === wanted) ?? results.find((r) => r.score >= 0.8) ?? null;

  if (search.isPending) {
    return (
      <Chip size="md" className="text-fg-subtle">
        <Search aria-hidden />
        {name}
      </Chip>
    );
  }
  if (!match || match.id === selfId) {
    return (
      <Chip size="md" tone="outline" className={cn("border-dashed")} title="No page with this name">
        {name}
        <span className="text-fg-subtle">{match ? "· this page" : "· no page found"}</span>
      </Chip>
    );
  }
  return <EntityChip entity={{ id: match.id, type: match.type, name: match.name }} onClick={() => onOpen(match)} />;
}
