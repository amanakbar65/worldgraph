import { Search } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { useRpc } from "@/api/client";
import type { EntityType } from "@/api/contract";
import { ENTITY_TYPE_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { useKnownNames } from "./entity-names";
import { useDebounced } from "./use-debounced";

const MIN_CHARS = 2;

export interface PickedEntity {
  id: string;
  name: string;
  type: EntityType;
}

export interface EntityPickerProps {
  /** What the search offers, e.g. ["commodity", "infrastructure"]. */
  types: readonly EntityType[];
  /** Ids already chosen; they don't show in the results. */
  exclude: readonly string[];
  onPick: (entity: PickedEntity) => void;
  /** Accessible name, e.g. "Add a place where you operate". */
  label: string;
  placeholder: string;
  /** Word for the status line, e.g. "place" → "3 places found". */
  noun?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Type a name, pick it from the list: a combobox over api.search for the
 * given node types. Arrow keys move through the results, Enter picks,
 * Escape clears.
 */
export function EntityPicker({
  types,
  exclude,
  onPick,
  label,
  placeholder,
  noun = "match",
  disabled = false,
  className,
}: EntityPickerProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const remember = useKnownNames((s) => s.remember);
  const q = useDebounced(text.trim(), 180);
  const enabled = q.length >= MIN_CHARS && !disabled;
  const query = useRpc(
    "search",
    { q, types: [...types], limit: 8 },
    { enabled, staleTime: 5 * 60_000, refetchInterval: false },
  );
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const typed = text.trim().length >= MIN_CHARS;
  const results = enabled
    ? (query.data?.results ?? []).filter((r) => types.includes(r.type) && !exclude.includes(r.id))
    : [];
  const open = focused && typed && results.length > 0;
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));
  const waiting = typed && (text.trim() !== q || query.isFetching);
  const plural = (n: number) => (n === 1 ? noun : noun.endsWith("h") ? `${noun}es` : `${noun}s`);
  const status = !typed
    ? ""
    : waiting && results.length === 0
      ? "Searching…"
      : enabled && !query.isFetching && results.length === 0
        ? query.isError
          ? "Search isn't available right now."
          : `Nothing matches “${q}”.`
        : open
          ? `${results.length} ${plural(results.length)} found.`
          : "";

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    remember([{ id: r.id, name: r.name, type: r.type }]);
    onPick({ id: r.id, name: r.name, type: r.type });
    setText("");
    setActiveIndex(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActiveIndex((active + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActiveIndex((active - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" && text) {
      e.preventDefault();
      e.stopPropagation();
      setText("");
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        // Let a click on an option land before the list closes.
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-body text-fg placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`Matches for ${label.toLowerCase()}`}
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line-strong bg-surface p-1 shadow-panel"
      >
        {results.map((r, i) => {
          const Icon = (ENTITY_TYPE_ICONS[r.type] ?? ENTITY_TYPE_ICONS.region).icon;
          return (
            <li
              key={r.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5",
                i === active && "bg-surface-2",
              )}
            >
              <Icon aria-hidden className={cn("size-4 shrink-0", entityTypeTone(r.type).text)} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body text-fg">{r.name}</span>
                {r.context && <span className="truncate text-label text-fg-muted">{r.context}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className={cn("mt-1 text-label text-fg-muted", (!status || open) && "sr-only")}>
        {status}
      </p>
    </div>
  );
}
