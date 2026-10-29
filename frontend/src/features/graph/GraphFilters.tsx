import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { EntityType, PropertyDef, RelationDirection, SchemaResponse, SectorId } from "@/api/contract";
import { SECTOR_IDS } from "@/api/contract";
import { useRpc } from "@/api/client";
import { MinConfidenceSlider } from "@/components/MinConfidenceSlider";
import { SectorChip } from "@/components/SectorChip";
import { ChipButton } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { DEFAULT_RELATION_ICON, ENTITY_TYPE_ICONS, IMPACT_ICONS, RELATION_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";

import {
  DEFAULT_TYPES,
  filterableProperties,
  GRAPH_TYPES,
  LIMIT_OPTIONS,
  relationIndex,
  TYPE_NAMES,
  type NodeLimit,
  type PropCondition,
} from "./graph-data";
import { useGraphState } from "./graph-state";
import { useDebounced } from "./use-debounced";
import { useGraphFeatures, useSchema } from "./use-graph-schema";

const LIMITS = LIMIT_OPTIONS.map((n) => ({ value: String(n) as `${NodeLimit}`, label: String(n), ariaLabel: `Up to ${n} items` }));

const DIRECTIONS: { value: RelationDirection; label: string; icon: typeof ArrowLeftRight; ariaLabel: string }[] = [
  { value: "both", label: "Both", icon: ArrowLeftRight, ariaLabel: "Links both ways" },
  { value: "out", label: "Out", icon: ArrowUpRight, ariaLabel: "Only links leaving it" },
  { value: "in", label: "In", icon: ArrowDownLeft, ariaLabel: "Only links arriving at it" },
];

/**
 * The graph's filters: which kinds to show, the sector lens, places,
 * which relations, how sure a cause-and-effect link must be, and how many
 * nodes to draw. With exactly one kind chosen, its properties too. Changes
 * apply straight away.
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
  const features = useGraphFeatures();
  const schema = useSchema(features.relations || features.properties);
  const allOn = GRAPH_TYPES.every((t) => filters.types.includes(t));
  const oneType = filters.types.length === 1 ? filters.types[0] : null;

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
        {features.properties && !oneType && (
          <p className="text-label text-fg-subtle">Choose one kind to filter by its properties.</p>
        )}
      </FilterGroup>

      {features.properties && oneType && (
        <PropertiesFilter type={oneType} types={schema.data?.types} loading={schema.isPending} />
      )}

      {features.relations && <RelationsFilter relations={schema.data?.relations} />}

      {features.relations && local && <DirectionFilter />}

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

      <FilterGroup title="Cause-and-effect links">
        <MinConfidenceSlider />
        <p className="text-label text-fg-subtle">The same setting applies to the cascade and the globe.</p>
      </FilterGroup>

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

const linkButton =
  "cursor-pointer rounded px-1 text-label text-fg-muted underline-offset-2 hover:text-fg hover:underline";

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

// Relations ---------------------------------------------------------------------

/**
 * Only links of the chosen relations. Chips come from api.schema (relations
 * with links, plus any already chosen); without it, the built-in list.
 */
function RelationsFilter({ relations }: { relations: SchemaResponse["relations"] | undefined }) {
  const chosen = useGraphState((s) => s.filters.relations);
  const toggleRelation = useGraphState((s) => s.toggleRelation);
  const setRelations = useGraphState((s) => s.setRelations);
  const options = relations
    ? relations.filter((r) => r.count > 0 || chosen.includes(r.key)).map((r) => ({ key: r.key, label: r.label, icon: r.icon, description: r.description }))
    : [...relationIndex().values()].map((r) => ({ key: r.key, label: r.label, icon: r.icon, description: null }));
  return (
    <FilterGroup
      title="Relations"
      action={
        chosen.length > 0 ? (
          <button type="button" onClick={() => setRelations([])} className={linkButton}>
            Every relation
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {options.map((r) => {
          const Icon = (RELATION_ICONS[r.key] ?? DEFAULT_RELATION_ICON).icon;
          const on = chosen.includes(r.key);
          return (
            <ChipButton
              key={r.key}
              selected={on}
              onClick={() => toggleRelation(r.key)}
              title={r.description ?? undefined}
              className={cn(!on && "opacity-70")}
            >
              <Icon aria-hidden className="text-fg-muted" />
              {r.label}
            </ChipButton>
          );
        })}
      </div>
      {chosen.length === 0 && <p className="text-label text-fg-subtle">Every relation shows. Choose some to see only those links.</p>}
    </FilterGroup>
  );
}

function DirectionFilter() {
  const direction = useGraphState((s) => s.filters.direction);
  const setDirection = useGraphState((s) => s.setDirection);
  return (
    <FilterGroup title="Direction">
      <Segmented<RelationDirection>
        size="sm"
        fill
        aria-label="Which links of this node"
        value={direction}
        onValueChange={setDirection}
        options={DIRECTIONS}
      />
    </FilterGroup>
  );
}

// Properties ----------------------------------------------------------------------

/** Conditions on the one chosen kind's properties (api.schema types[].properties). */
function PropertiesFilter({
  type,
  types,
  loading,
}: {
  type: EntityType;
  types: SchemaResponse["types"] | undefined;
  loading: boolean;
}) {
  const props = useGraphState((s) => (s.filters.props?.type === type ? s.filters.props.byKey : null));
  const setPropCondition = useGraphState((s) => s.setPropCondition);
  const clearProps = useGraphState((s) => s.clearProps);
  const defs = filterableProperties(types?.find((t) => t.key === type)?.properties ?? []);
  if (!types) {
    return loading ? (
      <FilterGroup title={`${TYPE_NAMES[type].one} properties`}>
        <p className="text-label text-fg-subtle">Loading…</p>
      </FilterGroup>
    ) : null;
  }
  if (defs.length === 0) return null;
  const set = (key: string, condition: PropCondition | null) => setPropCondition(type, key, condition);
  return (
    <FilterGroup
      title={`${TYPE_NAMES[type].one} properties`}
      action={
        props ? (
          <button type="button" onClick={clearProps} className={linkButton}>
            Clear
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {defs.map((def) => (
          <PropertyControlRow key={def.key} def={def} condition={props?.[def.key]} onChange={(c) => set(def.key, c)} />
        ))}
      </div>
    </FilterGroup>
  );
}

function PropertyControlRow({
  def,
  condition,
  onChange,
}: {
  def: PropertyDef & { control: "choice" | "number" | "date" | "text" };
  condition: PropCondition | undefined;
  onChange: (condition: PropCondition | null) => void;
}) {
  const labelId = useId();
  const unit = def.unit ? ` (${def.unit})` : "";
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <span id={labelId} className="text-label text-fg">
        {def.label}
        {def.control === "date" ? " (year)" : unit}
      </span>
      {def.control === "choice" && (
        <div className="flex flex-wrap gap-1.5">
          {(def.choices ?? []).map((choice) => {
            const values = condition?.kind === "choice" ? condition.values : [];
            const on = values.includes(choice.key);
            return (
              <ChipButton
                key={choice.key}
                size="sm"
                selected={on}
                onClick={() => {
                  const next = on ? values.filter((v) => v !== choice.key) : [...values, choice.key];
                  onChange(next.length ? { kind: "choice", values: next } : null);
                }}
              >
                {choice.label}
              </ChipButton>
            );
          })}
        </div>
      )}
      {(def.control === "number" || def.control === "date") && (
        <RangeInputs def={def} condition={condition} onChange={onChange} />
      )}
      {def.control === "text" && (
        <DraftInput
          type="search"
          label={`${def.label} contains`}
          placeholder="Contains…"
          value={condition?.kind === "text" ? condition.text : ""}
          onCommit={(text) => onChange(text.trim() ? { kind: "text", text } : null)}
        />
      )}
    </div>
  );
}

function RangeInputs({
  def,
  condition,
  onChange,
}: {
  def: PropertyDef & { control: "choice" | "number" | "date" | "text" };
  condition: PropCondition | undefined;
  onChange: (condition: PropCondition | null) => void;
}) {
  const kind = def.control === "date" ? "date" : "number";
  const range = condition && (condition.kind === "number" || condition.kind === "date") ? condition : null;
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  const commit = (next: { min: number | null; max: number | null }) =>
    onChange(next.min === null && next.max === null ? null : { kind, ...next });
  const parse = (text: string): number | null => {
    if (text.trim() === "") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };
  const hint = (v: number | null | undefined) => (typeof v === "number" ? String(v) : undefined);
  return (
    <div className="flex items-center gap-2">
      <DraftInput
        type="number"
        label={`${def.label}${kind === "date" ? ", from year" : ", at least"}`}
        placeholder={kind === "date" ? "From" : (hint(def.min) ?? "Min")}
        value={min === null ? "" : String(min)}
        onCommit={(text) => commit({ min: parse(text), max })}
      />
      <span aria-hidden className="text-label text-fg-subtle">
        to
      </span>
      <DraftInput
        type="number"
        label={`${def.label}${kind === "date" ? ", to year" : ", at most"}`}
        placeholder={kind === "date" ? "To" : (hint(def.max) ?? "Max")}
        value={max === null ? "" : String(max)}
        onCommit={(text) => commit({ min, max: parse(text) })}
      />
    </div>
  );
}

/** An input that applies its value once typing rests (the graph reloads once, not per key). */
function DraftInput({
  type,
  label,
  placeholder,
  value,
  onCommit,
}: {
  type: "number" | "search";
  label: string;
  placeholder?: string;
  value: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Cleared from outside (Clear, Reset filters): follow it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = (text: string) => {
    clearTimeout(timer.current);
    if (text !== value) onCommit(text);
  };
  return (
    <input
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(text), 500);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
      }}
      className="h-10 w-full min-w-0 rounded-lg border border-line bg-bg-sunken/60 px-3 text-body text-fg placeholder:text-fg-subtle hover:border-line-strong"
    />
  );
}

// Places ----------------------------------------------------------------------------

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
