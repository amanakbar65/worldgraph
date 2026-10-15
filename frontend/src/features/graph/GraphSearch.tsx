import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { EntityType, Impact } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS } from "@/lib/icons";
import { entityTypeTone, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { searchNodes, TYPE_NAMES, type VizGraph, type VizNode } from "./graph-data";
import { useDebounced } from "./use-debounced";

export interface SearchPick {
  id: string;
  name: string;
  type: EntityType;
}

interface Option {
  key: string;
  pick: SearchPick;
  impact: Impact | null;
  context: string;
  /** In the current drawing (focus it) or elsewhere (show the graph around it). */
  inView: boolean;
}

export interface GraphSearchProps {
  graph: VizGraph | null;
  /** A node in the current drawing. */
  onFocus: (node: VizNode) => void;
  /** A node that isn't drawn: show the graph around it. */
  onShowAround: (pick: SearchPick) => void;
  className?: string;
}

/**
 * Find a node: names in the current drawing first (instant), then matches
 * from the whole database, which open the graph around them.
 */
export function GraphSearch({ graph, onFocus, onShowAround, className }: GraphSearchProps) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = query.trim();
  const debounced = useDebounced(q, 250);
  const remote = useRpc("search", { q: debounced, limit: 8 }, { enabled: open && debounced.length >= 2, refetchInterval: false });

  const options = useMemo<Option[]>(() => {
    if (!q) return [];
    const local = graph ? searchNodes(graph.nodes, q, 6) : [];
    const shown = new Set(local.map((n) => n.id));
    const out: Option[] = local.map((n) => ({
      key: `in-${n.id}`,
      pick: { id: n.id, name: n.name, type: n.type },
      impact: n.impact,
      context: `${TYPE_NAMES[n.type]?.one ?? n.type} · ${n.degree} ${n.degree === 1 ? "link" : "links"}`,
      inView: true,
    }));
    if (debounced === q && remote.data) {
      for (const r of remote.data.results) {
        if (shown.has(r.id) || r.type === "user_entity" || out.length >= 10) continue;
        out.push({
          key: `out-${r.id}`,
          pick: { id: r.id, name: r.name, type: r.type },
          impact: null,
          context: r.context ?? TYPE_NAMES[r.type]?.one ?? r.type,
          inView: false,
        });
      }
    }
    return out;
  }, [q, debounced, graph, remote.data]);

  const choose = (option: Option | undefined) => {
    if (!option) return;
    setOpen(false);
    setQuery("");
    if (option.inView) {
      const node = graph?.byId.get(option.pick.id);
      if (node) onFocus(node);
    } else onShowAround(option.pick);
    input.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active] ?? options[0]);
    } else if (e.key === "Escape") {
      if (query) {
        e.stopPropagation();
        setQuery("");
      }
      setOpen(false);
    }
  };

  const expanded = open && q.length > 0;
  const firstOut = options.findIndex((o) => !o.inView);
  const searching = remote.isFetching || debounced !== q;

  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Find something in the graph"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && options[active] ? `${id}-${active}` : undefined}
        placeholder="Find in graph"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-lg border border-line bg-surface pr-9 pl-9 text-body text-fg placeholder:text-fg-subtle hover:border-line-strong [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matches"
        hidden={!expanded}
        className="absolute top-full right-0 left-0 z-30 mt-1.5 max-h-[min(60vh,420px)] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-panel"
      >
        {options.map((option, i) => (
          <OptionRow
            key={option.key}
            id={`${id}-${i}`}
            option={option}
            active={i === active}
            heading={i === firstOut ? (firstOut === 0 ? "Not in this view" : "Elsewhere") : i === 0 ? "In this view" : null}
            onHover={() => setActive(i)}
            onChoose={() => choose(option)}
          />
        ))}
        {options.length === 0 && (
          <li role="presentation" className="px-3 py-2.5 text-body text-fg-muted">
            {searching ? "Searching…" : "No matches"}
          </li>
        )}
      </ul>
    </div>
  );
}

function OptionRow({
  id,
  option,
  active,
  heading,
  onHover,
  onChoose,
}: {
  id: string;
  option: Option;
  active: boolean;
  heading: string | null;
  onHover: () => void;
  onChoose: () => void;
}) {
  const { pick } = option;
  const story = pick.type === "story";
  const tone = story ? impactTone(option.impact ?? "neutral") : entityTypeTone(pick.type);
  const Icon = story
    ? IMPACT_ICONS[option.impact ?? "neutral"].icon
    : (ENTITY_TYPE_ICONS[pick.type] ?? ENTITY_TYPE_ICONS.story).icon;
  return (
    <>
      {heading && (
        <li role="presentation" className="px-2.5 pt-2 pb-1 text-label font-medium text-fg-subtle">
          {heading}
        </li>
      )}
      <li
        id={id}
        role="option"
        aria-selected={active}
        // Keep focus in the input while choosing.
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={onHover}
        onClick={onChoose}
        className={cn(
          "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5",
          active && "bg-surface-2",
        )}
      >
        <span
          aria-hidden
          className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border", tone.border, tone.tint)}
        >
          <Icon className={cn("size-3.5", tone.text)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body text-fg">{pick.name}</span>
          <span className="truncate text-label text-fg-muted">
            {option.context}
            {!option.inView && " · show around it"}
          </span>
        </span>
      </li>
    </>
  );
}
