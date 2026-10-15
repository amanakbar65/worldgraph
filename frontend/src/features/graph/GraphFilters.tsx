import { MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { EntityType, SectorId } from "@/api/contract";
import { SECTOR_IDS } from "@/api/contract";
import { useRpc } from "@/api/client";
import { SectorChip } from "@/components/SectorChip";
import { ChipButton } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";

import { DEFAULT_TYPES, GRAPH_TYPES, LIMIT_OPTIONS, TYPE_NAMES, type NodeLimit } from "./graph-data";
import { useGraphState } from "./graph-state";
import { useDebounced } from "./use-debounced";

const LIMITS = LIMIT_OPTIONS.map((n) => ({ value: String(n) as `${NodeLimit}`, label: String(n), ariaLabel: `Up to ${n} items` }));

/**
 * The graph's filters: which kinds to show, the sector lens, places,
 * how sure a cause-and-effect link must be, and how many nodes to draw.
 * Changes apply straight away.
 */
export function GraphFilters({ local }: { local: boolean }) {
  const filters = useGraphState((s) => s.filters);
  const toggleType = useGraphState((s) => s.toggleType);
  const setTypes = useGraphState((s) => s.setTypes);
  const setLimit = useGraphState((s) => s.setLimit);
  const resetFilters = useGraphState((s) => s.resetFilters);
  const sectors = useNav((s) => s.sectors);
  const toggleSector = useNav((s) => s.toggleSector);
  const clearSectors = useNav((s) => s.clearSectors);
  const allOn = GRAPH_TYPES.every((t) => filters.types.includes(t));

  return (
    <div className="flex flex-col gap-4">
      {local && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-label text-fg-muted">
          Showing everything linked to this node, at any time. Kinds and confidence apply here; sectors, places and
          the time window apply to the whole graph.
        </p>
      )}

      <FilterGroup
        title="Show"
        action={
          <button
            type="button"
            onClick={() => setTypes(allOn ? [...DEFAULT_TYPES] : [...GRAPH_TYPES])}
            className="cursor-pointer rounded px-1 text-label text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            {allOn ? "Default kinds" : "All kinds"}
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {GRAPH_TYPES.map((type) => (
            <TypeToggle key={type} type={type} selected={filters.types.includes(type)} onToggle={toggleType} />
          ))}
        </div>
      </FilterGroup>

      {!local && (
        <FilterGroup
          title="Sector lens"
          action={
            sectors.length > 0 ? (
              <button
                type="button"
                onClick={clearSectors}
                className="cursor-pointer rounded px-1 text-label text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              >
                All sectors
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {SECTOR_IDS.map((sector: SectorId) => (
              <SectorChip key={sector} sector={sector} selected={sectors.includes(sector)} onClick={toggleSector} />
            ))}
          </div>
        </FilterGroup>
      )}

      {!local && <PlacesFilter />}

      <ConfidenceFilter />

      {!local && (
        <FilterGroup title="Most items to draw">
          <Segmented<`${NodeLimit}`>
            size="sm"
            fill
            aria-label="Most items to draw"
            value={String(filters.limit) as `${NodeLimit}`}
            onValueChange={(v) => setLimit(Number(v) as NodeLimit)}
            options={LIMITS}
          />
        </FilterGroup>
      )}

      <div className="flex justify-end border-t border-line pt-3">
        <button
          type="button"
          onClick={() => {
            resetFilters();
            if (!local) clearSectors();
          }}
          className="h-8 cursor-pointer rounded-md px-2 text-label font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}

function FilterGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-label font-medium text-fg-muted">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TypeToggle({ type, selected, onToggle }: { type: EntityType; selected: boolean; onToggle: (t: EntityType) => void }) {
  const tone = entityTypeTone(type);
  const story = type === "story";
  const Icon = story ? IMPACT_ICONS.neutral.icon : (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.story).icon;
  return (
    <ChipButton selected={selected} onClick={() => onToggle(type)} className={cn(!selected && "opacity-70")}>
      {story ? (
        <span aria-hidden className="inline-flex items-center gap-0.5">
          {(["risk", "opportunity"] as const).map((impact) => {
            const ImpactIcon = IMPACT_ICONS[impact].icon;
            return <ImpactIcon key={impact} className={cn("size-3", impact === "risk" ? "text-risk" : "text-opportunity")} />;
          })}
        </span>
      ) : (
        <Icon aria-hidden className={tone.text} />
      )}
      {TYPE_NAMES[type].many}
    </ChipButton>
  );
}

function PlacesFilter() {
  const regions = useGraphState((s) => s.filters.regions);
  const addRegion = useGraphState((s) => s.addRegion);
  const removeRegion = useGraphState((s) => s.removeRegion);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const results = useRpc("search", { q, types: ["region"], limit: 5 }, { enabled: q.length >= 2, refetchInterval: false });
  const inputId = useId();
  const options = q.length >= 2 ? (results.data?.results ?? []).filter((r) => !regions.some((x) => x.id === r.id)) : [];

  return (
    <FilterGroup title="Places">
      {regions.length > 0 && (
        <ul aria-label="Chosen places" className="flex flex-wrap gap-1.5">
          {regions.map((r) => (
            <li key={r.id}>
              <ChipButton
                selected
                onClick={() => removeRegion(r.id)}
                aria-label={`Remove ${r.name}`}
                className="pr-1.5"
              >
                <MapPin aria-hidden className="text-type-region" />
                {r.name}
                <X aria-hidden className="size-3.5" />
              </ChipButton>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={inputId} className="sr-only">
        Add a place
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={regions.length ? "Add another place" : "Any place. Type to choose one"}
        className="h-10 w-full rounded-lg border border-line bg-bg-sunken/60 px-3 text-body text-fg placeholder:text-fg-subtle hover:border-line-strong"
      />
      {options.length > 0 && (
        <ul aria-label="Matching places" className="-mt-1 flex flex-col">
          {options.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  addRegion({ id: r.id, name: r.name });
                  setQuery("");
                }}
                className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left hover:bg-surface-2"
              >
                <MapPin aria-hidden className="size-4 shrink-0 text-type-region" />
                <span className="min-w-0 flex-1 truncate text-body text-fg">{r.name}</span>
                {r.context && <span className="shrink-0 text-label text-fg-muted">{r.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.length >= 2 && results.data && options.length === 0 && (
        <p className="text-label text-fg-muted">No other places match “{q}”.</p>
      )}
    </FilterGroup>
  );
}

function ConfidenceFilter() {
  const value = useGraphState((s) => s.filters.minConfidence);
  const setMinConfidence = useGraphState((s) => s.setMinConfidence);
  const [draft, setDraft] = useState(Math.round(value * 100));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  // The graph reloads once the slider rests.
  const onChange = (next: number) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMinConfidence(next / 100), 300);
  };

  // Reset from outside (Reset filters): follow it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(Math.round(value * 100));
  }

  return (
    <FilterGroup title="Cause-and-effect links">
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={90}
          step={5}
          value={draft}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Lowest confidence to show"
          aria-valuetext={draft === 0 ? "Any confidence" : `At least ${draft}% confidence`}
          className="h-10 min-w-0 flex-1 cursor-pointer accent-[var(--ring)]"
        />
        <output htmlFor={id} className="w-28 shrink-0 text-right text-label text-fg-muted tabular-nums">
          {draft === 0 ? "Any confidence" : `At least ${draft}%`}
        </output>
      </div>
    </FilterGroup>
  );
}
