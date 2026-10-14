import { ArrowUpDown, ChevronDown, FlaskConical, Info, Layers, MapPin, SearchX, TrendingUpDown, Users, X } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";

import { SECTOR_IDS, type ForecastSummary, type SectorId } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState, StateButton } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { SectorChip } from "@/components/SectorChip";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { RegionPicker } from "@/features/region/RegionPicker";
import { SECTORS } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useUserValue } from "@/platform/storage";
import { currentPanel, useNav } from "@/state/nav";
import { sampleArg, useSettings } from "@/state/settings";

import { useForecastFilters } from "./filters-store";
import {
  CATEGORIES,
  CATEGORY_IDS,
  DEFAULT_FILTERS,
  MAX_REGIONS,
  SORT_OPTIONS,
  forecastsArgs,
  hasActiveFilters,
  pickMovers,
  shapeList,
  usableProfile,
  type ForecastFilters,
  type ForecastSort,
} from "./forecast-data";
import { ForecastListRow, ListHeader, MoverCard } from "./forecast-parts";
import { useLatest } from "./use-latest";
import { useNow } from "./use-now";

/**
 * Crowd forecasts: the biggest moves of the last 24 hours, then every open
 * forecast with filters (category, place, the shared sector lens, thin
 * markets) and four sorts. Tapping a forecast opens its panel.
 */
export default function ForecastsView() {
  const sample = sampleArg(useSettings((s) => s.sample));
  const sectors = useNav((s) => s.sectors);
  const top = useNav(currentPanel);
  const open = useNav((s) => s.open);
  const sidePanel = top !== null && top.kind !== "cascade" && top.kind !== "compare";
  const selectedId = top?.kind === "forecast" ? top.id : null;

  const categories = useForecastFilters((s) => s.categories);
  const regions = useForecastFilters((s) => s.regions);
  const includeThin = useForecastFilters((s) => s.includeThin);
  const sort = useForecastFilters((s) => s.sort);
  const filters = useMemo<ForecastFilters>(
    () => ({ categories, regions, includeThin, sort }),
    [categories, regions, includeThin, sort],
  );

  // The business profile (from My Business) makes "Most relevant" personal.
  const stored = useUserValue<unknown>("profile", null);
  const profile = useMemo(() => usableProfile(stored.value), [stored.value]);

  const args = useMemo(
    () => forecastsArgs({ filters, sectors, sample, profile }),
    [filters, sectors, sample, profile],
  );
  const query = useRpc("forecasts", args);
  const latest = useLatest(query.data);
  const now = useNow();

  const onOpen = (forecast: ForecastSummary) => open({ kind: "forecast", id: forecast.id });
  const list = useMemo(
    () => (latest.value ? shapeList(latest.value.forecasts, filters) : null),
    [latest.value, filters],
  );
  const anySample = list?.some((f) => f.is_sample) ?? false;

  return (
    <div
      className={cn(
        "h-full overflow-y-auto overscroll-contain transition-[padding] duration-200",
        sidePanel && "lg:pr-[456px]",
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-5 pb-24 sm:px-6 sm:pt-6">
        <header className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-forecast/40 bg-forecast/12"
          >
            <Users className="size-5 text-forecast" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-figure font-semibold tracking-tight text-fg">Crowd forecasts</h1>
            <p className="flex items-start gap-1.5 text-body text-fg-muted">
              <Info aria-hidden className="mt-[3px] size-4 shrink-0" />
              Crowd forecasts are what forecasters expect, not facts. Play-money sources are labelled.
            </p>
          </div>
          {anySample && <SampleBadge className="mt-1.5 hidden sm:inline-flex" />}
        </header>

        <Movers sectors={sectors} sample={sample} now={now} onOpen={onOpen} />

        <AllForecasts
          filters={filters}
          sectors={sectors}
          list={list}
          stale={latest.stale || (query.isFetching && query.isPlaceholderData)}
          error={query.isError && !latest.value ? query.error : null}
          onRetry={() => void query.refetch()}
          profileUsed={args.profile !== undefined}
          anySample={anySample}
          selectedId={selectedId}
          now={now}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------

function Movers({
  sectors,
  sample,
  now,
  onOpen,
}: {
  sectors: SectorId[];
  sample: boolean | undefined;
  now: number;
  onOpen: (forecast: ForecastSummary) => void;
}) {
  const id = useId();
  // The unfiltered list (same request as the list with no filters), so the
  // movers stay put while the filters below change.
  const args = useMemo(() => forecastsArgs({ filters: DEFAULT_FILTERS, sectors, sample }), [sectors, sample]);
  const query = useRpc("forecasts", args);
  const latest = useLatest(query.data);
  const movers = useMemo(() => (latest.value ? pickMovers(latest.value.forecasts) : null), [latest.value]);

  if (query.isError && !latest.value) return null; // the list below explains the problem

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeader
        id={id}
        title="Biggest moves in 24 hours"
        icon={TrendingUpDown}
        description={sectors.length > 0 ? "Within your sector lens." : "Where the crowd changed its mind most since yesterday."}
      />
      {movers === null ? (
        <div aria-busy="true" aria-label="Loading the biggest moves" className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("flex items-center gap-4 rounded-xl border border-line p-4", i > 0 && "hidden md:flex")}>
              <Skeleton className="size-[88px] shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : movers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-body text-fg-muted">
          No big moves in the last 24 hours. The crowd's numbers have held steady.
        </p>
      ) : (
        <ul
          className={cn(
            // Phones: a row to swipe through; wider screens: a grid of three.
            "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6",
            "md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0",
          )}
        >
          {movers.map((f) => (
            <li key={f.id} className="w-[min(20rem,82%)] shrink-0 snap-start md:w-auto">
              <MoverCard forecast={f} now={now} onOpen={onOpen} className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// All forecasts: filters and the list
// ---------------------------------------------------------------------------

function AllForecasts({
  filters,
  sectors,
  list,
  stale,
  error,
  onRetry,
  profileUsed,
  anySample,
  selectedId,
  now,
  onOpen,
}: {
  filters: ForecastFilters;
  sectors: SectorId[];
  list: ForecastSummary[] | null;
  stale: boolean;
  error: Error | null;
  onRetry: () => void;
  profileUsed: boolean;
  anySample: boolean;
  selectedId: string | null;
  now: number;
  onOpen: (forecast: ForecastSummary) => void;
}) {
  const id = useId();
  const active = hasActiveFilters(filters, sectors);
  const clearFilters = useForecastFilters((s) => s.clearFilters);
  const clearSectors = useNav((s) => s.clearSectors);
  const clearAll = () => {
    clearFilters();
    clearSectors();
  };

  let body: ReactNode;
  if (error) {
    body = (
      <div className="flex flex-col items-center pb-6">
        <ErrorState error={error} onRetry={onRetry} />
        {active && <StateButton action={{ label: "Clear filters", onClick: clearAll, icon: X }} />}
      </div>
    );
  } else if (list === null || (stale && list.length === 0)) {
    body = <ListSkeleton />;
  } else if (list.length === 0) {
    body = <NoForecasts active={active} includeThin={filters.includeThin} onClear={clearAll} />;
  } else {
    body = (
      <ul aria-busy={stale || undefined} className={cn("flex flex-col p-1.5 transition-opacity", stale && "opacity-60")}>
        {list.map((f) => (
          <ForecastListRow key={f.id} forecast={f} now={now} selected={f.id === selectedId} onOpen={onOpen} />
        ))}
      </ul>
    );
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label.toLowerCase() ?? "";

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeader
        id={id}
        title="All forecasts"
        icon={Users}
        count={list && !stale ? list.length : undefined}
        description={
          filters.sort === "relevance" && profileUsed
            ? "Most relevant to your business first."
            : `Sorted by ${sortLabel}.`
        }
        action={anySample ? <SampleBadge className="sm:hidden" /> : undefined}
      />

      <Toolbar filters={filters} sectors={sectors} />
      <ActiveFilters filters={filters} sectors={sectors} onClearAll={clearAll} />

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {list !== null && list.length > 0 && !error && <ListHeader />}
        {body}
        <p role="status" className="sr-only">
          {stale ? "Updating forecasts…" : list ? `${list.length} forecasts` : ""}
        </p>
      </div>
    </section>
  );
}

function Toolbar({ filters, sectors }: { filters: ForecastFilters; sectors: SectorId[] }) {
  const toggleCategory = useForecastFilters((s) => s.toggleCategory);
  const clearCategories = useForecastFilters((s) => s.clearCategories);
  const addRegion = useForecastFilters((s) => s.addRegion);
  const setIncludeThin = useForecastFilters((s) => s.setIncludeThin);
  const setSort = useForecastFilters((s) => s.setSort);
  const thinId = useId();
  const sortId = useId();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <RegionPicker
          className="w-full sm:w-72"
          exclude={filters.regions.map((r) => r.id)}
          onPick={addRegion}
          label="Filter forecasts by place"
          placeholder="Filter by country, state or city"
          disabled={filters.regions.length >= MAX_REGIONS}
        />
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <SectorLens sectors={sectors} />
          <label
            htmlFor={thinId}
            className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong px-3 text-body text-fg"
            title="Markets with few forecasters and little volume; their numbers swing easily"
          >
            <Switch id={thinId} checked={filters.includeThin} onCheckedChange={setIncludeThin} />
            Include thin markets
          </label>
          <div className="relative sm:ml-auto">
            <ArrowUpDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
            />
            <label htmlFor={sortId} className="sr-only">
              Sort forecasts
            </label>
            <select
              id={sortId}
              value={filters.sort}
              onChange={(e) => setSort(e.target.value as ForecastSort)}
              className="h-10 cursor-pointer appearance-none rounded-lg border border-line-strong bg-surface pr-9 pl-9 text-body text-fg"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
            />
          </div>
        </div>
      </div>

      <div
        role="group"
        aria-label="Categories"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      >
        <ChipButton selected={filters.categories.length === 0} onClick={clearCategories}>
          All
        </ChipButton>
        {CATEGORY_IDS.map((category) => {
          const Icon = CATEGORIES[category].icon;
          return (
            <ChipButton
              key={category}
              selected={filters.categories.includes(category)}
              onClick={() => toggleCategory(category)}
            >
              <Icon aria-hidden />
              {CATEGORIES[category].label}
            </ChipButton>
          );
        })}
      </div>
    </div>
  );
}

/** The sector lens, shared with the globe: nine toggles in a popover. */
function SectorLens({ sectors }: { sectors: SectorId[] }) {
  const toggleSector = useNav((s) => s.toggleSector);
  const clearSectors = useNav((s) => s.clearSectors);
  const titleId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={`Sector lens${sectors.length ? `: ${sectors.length} on` : ": off"}`}>
          <Layers aria-hidden />
          Sectors
          {sectors.length > 0 && (
            <span className="rounded-full bg-fg/15 px-1.5 text-label font-medium text-fg tabular-nums">
              {sectors.length}
            </span>
          )}
          <ChevronDown aria-hidden className="text-fg-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-labelledby={titleId} className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p id={titleId} className="text-body font-medium text-fg">
              Sector lens
            </p>
            <p className="text-label text-fg-muted">Shows forecasts that touch these sectors. The globe uses it too.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SECTOR_IDS.map((sector) => (
              <SectorChip key={sector} sector={sector} selected={sectors.includes(sector)} onClick={toggleSector} />
            ))}
          </div>
          {sectors.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSectors} className="self-start">
              <X aria-hidden />
              Clear the lens
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What narrows the list right now, each with a way to remove it. */
function ActiveFilters({
  filters,
  sectors,
  onClearAll,
}: {
  filters: ForecastFilters;
  sectors: SectorId[];
  onClearAll: () => void;
}) {
  const removeRegion = useForecastFilters((s) => s.removeRegion);
  const toggleSector = useNav((s) => s.toggleSector);
  if (filters.regions.length === 0 && sectors.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      {filters.regions.map((region) => (
        <ChipButton key={region.id} onClick={() => removeRegion(region.id)} aria-label={`Remove ${region.name}`}>
          <MapPin aria-hidden className="text-type-region" />
          {region.name}
          <X aria-hidden className="text-fg-muted" />
        </ChipButton>
      ))}
      {sectors.map((sector) => {
        const Icon = SECTORS[sector].icon;
        return (
          <ChipButton
            key={sector}
            onClick={() => toggleSector(sector)}
            aria-label={`Remove the ${SECTORS[sector].label} lens`}
          >
            <Icon aria-hidden />
            {SECTORS[sector].label}
            <X aria-hidden className="text-fg-muted" />
          </ChipButton>
        );
      })}
      <Button variant="ghost" size="sm" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
}

function NoForecasts({ active, includeThin, onClear }: { active: boolean; includeThin: boolean; onClear: () => void }) {
  const setIncludeThin = useForecastFilters((s) => s.setIncludeThin);
  const sampleSetting = useSettings((s) => s.sample);
  const update = useSettings((s) => s.update);
  if (active) {
    return (
      <EmptyState
        icon={SearchX}
        title="No forecasts match these filters"
        description="Try fewer filters or another place. Forecasts cover economy, policy, trade and markets."
        action={{ label: "Clear filters", onClick: onClear, icon: X }}
        secondaryAction={includeThin ? undefined : { label: "Include thin markets", onClick: () => setIncludeThin(true) }}
      />
    );
  }
  const showSample =
    sampleSetting === "on"
      ? undefined
      : { label: "Show sample data", onClick: () => update({ sample: "on" }), icon: FlaskConical };
  if (includeThin) {
    return (
      <EmptyState
        icon={Users}
        title="No crowd forecasts yet"
        description="Forecasts appear here after the next data update."
        action={showSample}
      />
    );
  }
  return (
    <EmptyState
      icon={Users}
      title="No forecasts to show"
      description="Thin markets are hidden because their numbers swing easily. Include them, or check back later."
      action={{ label: "Include thin markets", onClick: () => setIncludeThin(true) }}
      secondaryAction={showSample}
    />
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading forecasts" className="flex flex-col p-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-8 w-28 md:block" />
          <Skeleton className="hidden h-4 w-12 md:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}
