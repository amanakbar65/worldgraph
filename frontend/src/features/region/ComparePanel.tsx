import { Activity, Columns3, Gauge, MapPin, Newspaper, Plus, RotateCcw, X } from "lucide-react";
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";

import type { CompareResponse, Kpi, RegionRef } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { KpiTile } from "@/components/KpiTile";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { IMPACT_ICONS, SECTORS } from "@/lib/icons";
import { impactTone, kpiChangeImpact } from "@/lib/meaning";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNav, type Panel } from "@/state/nav";
import { sampleArg, useSettings } from "@/state/settings";

import {
  MAX_COMPARE,
  MIN_COMPARE,
  addRegion,
  alignKpis,
  cleanIds,
  columnsFor,
  comparePulseRows,
  describeKpiChange,
  formatKpiChange,
  formatKpiValue,
  maxTotal,
  removeRegion,
  usesCountryFigures,
  type CompareRegion,
  type PulseRow,
} from "./compare-data";
import { levelLabel, shortLevelLabel, totalOf, windowWords, type PulseTile } from "./region-data";
import { ImpactCountsInline, ImpactSplitBar, MomentumArrow, Updating, WindowSwitch } from "./region-parts";
import { RegionPicker } from "./RegionPicker";
import { useRegionNav, type RegionNav } from "./use-region-nav";

/** Big economies to start from when nothing is picked yet. */
const STARTERS: { id: string; name: string }[] = [
  { id: "region:us", name: "United States" },
  { id: "region:cn", name: "China" },
  { id: "region:in", name: "India" },
  { id: "region:de", name: "Germany" },
];

type Seed = { region: { id: string; name: string; subtype: string; breadcrumb: RegionRef[] }; children: { id: string; name: string; count: number }[] };

/**
 * Two or three places side by side: story counts, the same key numbers
 * lined up row by row, and the sector pulse as bars. Places are added with
 * search (or a quick pick) and removed from their chip; the choice lives in
 * the link.
 */
export default function ComparePanel({ panel }: { panel: Extract<Panel, { kind: "compare" }> }) {
  const ids = useMemo(() => cleanIds(panel.ids), [panel.ids]);
  const timeWindow = useNav((s) => s.window);
  const sampleSetting = useSettings((s) => s.sample);
  const sample = sampleArg(sampleSetting);
  const nav = useRegionNav();
  const ready = ids.length >= MIN_COMPARE;

  const query = useRpc(
    "compare",
    { ids, window: timeWindow, sample },
    // Columns are looked up by id, so the last answer can stay up while a new place loads.
    { enabled: ready, placeholderData: (previous) => previous },
  );
  // api.compare doesn't flag sample stories, so label the view whenever sample data is on show.
  const meta = useRpc("meta", {});
  const showingSample =
    sampleSetting === "on" ||
    (sampleSetting === "auto" && meta.data?.data.showing_sample === true) ||
    (ready && !!query.data?.regions.some((r) => r.kpis.some((k) => k.is_sample)));
  // With one place picked, its own panel data gives its name and quick picks (usually cached already).
  const seedQuery = useRpc("region", { id: ids[0] ?? "", window: timeWindow, sample }, { enabled: ids.length === 1 });
  const seed: Seed | undefined = ids.length === 1 && seedQuery.data?.region.id === ids[0] ? seedQuery.data : undefined;

  const names = new Map<string, string>();
  for (const r of query.data?.regions ?? []) names.set(r.region.id, r.region.name);
  if (seed) names.set(seed.region.id, seed.region.name);

  const add = (id: string) => nav.setCompare(addRegion(ids, id));
  const remove = (id: string) => nav.setCompare(removeRegion(ids, id));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 pb-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-2 text-figure font-semibold tracking-tight text-fg">
            <Columns3 aria-hidden className="size-6 text-fg-muted" />
            Compare
          </h2>
          {showingSample && <SampleBadge />}
          <span className="ml-auto flex items-center gap-3">
            <Updating active={ready && query.isPlaceholderData} />
            <WindowSwitch />
          </span>
        </div>
        <p className="text-body text-fg-muted">
          Up to {MAX_COMPARE} places side by side: stories, key numbers and sector pulse in the{" "}
          {windowWords(timeWindow, true)}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {ids.length > 0 && (
            <ul aria-label="Places in the comparison" className="flex flex-wrap items-center gap-2">
              {ids.map((id) => {
                const name = names.get(id);
                return (
                  <li key={id}>
                    {name ? (
                      <ChipButton size="lg" onClick={() => remove(id)} aria-label={`Remove ${name}`} title={`Remove ${name}`}>
                        <MapPin aria-hidden className="text-type-region" />
                        <span className="max-w-48 truncate text-fg">{name}</span>
                        <X aria-hidden />
                      </ChipButton>
                    ) : (
                      <Skeleton className="h-10 w-28 rounded-full" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {ids.length < MAX_COMPARE ? (
            <RegionPicker
              exclude={ids}
              onPick={(r) => add(r.id)}
              placeholder={ids.length === 0 ? "Find a country, state or city" : "Add a country, state or city"}
              className="w-full sm:w-72"
            />
          ) : (
            <p className="text-label text-fg-muted">That's the most at once. Remove one to add another.</p>
          )}
        </div>
      </header>

      {ids.length === 0 && <NothingPicked onAdd={add} />}
      {ids.length === 1 && <OnePicked id={ids[0]} seed={seed} onAdd={add} nav={nav} />}
      {ready &&
        (query.isError && !query.data ? (
          <div className="flex flex-col items-center gap-2">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            <Button variant="ghost" size="sm" onClick={() => nav.setCompare([])}>
              <RotateCcw aria-hidden />
              Start over
            </Button>
          </div>
        ) : (
          <CompareGrid ids={ids} data={query.data} nav={nav} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fewer than two places
// ---------------------------------------------------------------------------

function NothingPicked({ onAdd }: { onAdd: (id: string) => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong pb-8">
      <EmptyState icon={Columns3} title="Pick places to compare" description="Search above, or start with one of these." />
      <QuickPicks picks={STARTERS} onAdd={onAdd} />
    </div>
  );
}

function OnePicked({ id, seed, onAdd, nav }: { id: string; seed: Seed | undefined; onAdd: (id: string) => void; nav: RegionNav }) {
  const picks: { id: string; name: string }[] = [];
  if (seed) {
    const parent = seed.region.breadcrumb.at(-1);
    if (parent) picks.push({ id: parent.id, name: parent.name });
    for (const child of seed.children.filter((c) => c.count > 0).slice(0, 3)) picks.push({ id: child.id, name: child.name });
  }
  for (const s of STARTERS) if (picks.length < 4 && s.id !== id && !picks.some((p) => p.id === s.id)) picks.push(s);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {seed ? (
        <ColumnHead
          region={{ id, name: seed.region.name, subtype: seed.region.subtype, country_id: null }}
          kpis={[]}
          onOpen={() => nav.openRegion(id)}
        />
      ) : (
        <Skeleton className="h-16 rounded-xl" />
      )}
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong p-4">
        <EmptyState
          compact
          icon={Plus}
          title="Add one more place"
          description={seed ? `Compare ${seed.region.name} with:` : "Search above, or pick one of these."}
          className="py-2"
        />
        <QuickPicks picks={picks} onAdd={onAdd} />
      </div>
    </div>
  );
}

function QuickPicks({ picks, onAdd }: { picks: { id: string; name: string }[]; onAdd: (id: string) => void }) {
  if (picks.length === 0) return null;
  return (
    <ul aria-label="Quick picks" className="flex flex-wrap justify-center gap-2">
      {picks.map((p) => (
        <li key={p.id}>
          <ChipButton size="lg" onClick={() => onAdd(p.id)} aria-label={`Add ${p.name}`}>
            <Plus aria-hidden />
            {p.name}
          </ChipButton>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** Every row uses the same columns: a label column on wide screens, then one per place. */
function rowStyle(n: number): CSSProperties {
  return { "--n": n } as CSSProperties;
}
const ROW = "grid grid-cols-[repeat(var(--n),minmax(0,1fr))] gap-2 md:grid-cols-[10rem_repeat(var(--n),minmax(0,1fr))] md:gap-3";
const LABEL = "col-span-full flex min-w-0 items-center gap-1.5 text-label font-medium text-fg-muted md:col-span-1";

function CompareGrid({ ids, data, nav }: { ids: string[]; data: CompareResponse | undefined; nav: RegionNav }) {
  const timeWindow = useNav((s) => s.window);
  const columns = useMemo(() => columnsFor(ids, data), [ids, data]);
  const n = columns.length;
  const loaded = columns.filter((c): c is CompareRegion => c !== null);
  const kpiRows = useMemo(() => alignKpis(columns), [columns]);
  const pulseRows = useMemo(() => comparePulseRows(columns, timeWindow), [columns, timeWindow]);
  const top = maxTotal(columns.map((c) => c?.counts ?? null));
  // Three tiles don't fit a phone's width; there, each figure gets a compact cell.
  const compactOnPhones = n >= 3;

  return (
    <div className="flex flex-col gap-6">
      {/* Column heads stay in view while scrolling. */}
      <div className={cn(ROW, "sticky top-0 z-10 -mx-4 border-b border-line bg-glass px-4 py-2 backdrop-blur-xl")} style={rowStyle(n)}>
        <div aria-hidden className="hidden md:block" />
        {columns.map((c, i) =>
          c ? (
            <ColumnHead key={c.region.id} region={c.region} kpis={c.kpis} onOpen={() => nav.openRegion(c.region.id)} />
          ) : (
            <Skeleton key={ids[i]} className="h-14 rounded-xl" />
          ),
        )}
      </div>

      <CompareSection icon={Newspaper} title="Stories" description={`How many stories, and which way they lean, in the ${windowWords(timeWindow, true)}.`}>
        <div className={ROW} style={rowStyle(n)}>
          <div className={cn(LABEL, "max-md:sr-only")}>All stories</div>
          {columns.map((c, i) => (c ? <CountsCell key={c.region.id} column={c} max={top} /> : <Skeleton key={ids[i]} className="h-24 rounded-lg" />))}
        </div>
      </CompareSection>

      <CompareSection icon={Gauge} title="Key numbers" description="The same measure sits in the same row. Money stays in each place's own currency.">
        {loaded.length > 0 && kpiRows.length === 0 ? (
          <EmptyState
            compact
            icon={Gauge}
            title="No key numbers for these places yet"
            description="Try countries: they usually have inflation, rates and fuel prices."
            className="rounded-lg border border-dashed border-line"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {kpiRows.map((row) => (
              <div key={row.key} role="group" aria-label={row.label} className={ROW} style={rowStyle(n)}>
                <div className={LABEL}>
                  <span className="truncate">{row.label}</span>
                </div>
                {row.cells.map((kpi, i) => (
                  <KpiCell key={ids[i]} kpi={kpi} rowLabel={row.label} column={columns[i]} compactOnPhones={compactOnPhones} nav={nav} />
                ))}
              </div>
            ))}
            {loaded.length === 0 &&
              [0, 1].map((r) => (
                <div key={r} className={ROW} style={rowStyle(n)}>
                  <Skeleton className="col-span-full h-4 w-24 md:col-span-1" />
                  {ids.map((id) => (
                    <Skeleton key={id} className="h-24 rounded-lg" />
                  ))}
                </div>
              ))}
          </div>
        )}
      </CompareSection>

      <CompareSection
        icon={Activity}
        title="Sector pulse"
        description={`Stories per sector; the bar compares places. ▲▼ against the previous ${windowWords(timeWindow)}.`}
      >
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {pulseRows.map((row) => (
            <PulseCompareRow key={row.sector} row={row} columns={columns} n={n} />
          ))}
        </div>
      </CompareSection>
    </div>
  );
}

function CompareSection({
  icon,
  title,
  description,
  children,
}: {
  icon: Parameters<typeof SectionHeader>[0]["icon"];
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeader as="h3" id={id} title={title} icon={icon} description={description} />
      {children}
    </section>
  );
}

/** A column's name and level; tapping opens the place. */
function ColumnHead({ region, kpis, onOpen }: { region: Pick<RegionRef, "id" | "name" | "subtype" | "country_id">; kpis: Kpi[]; onOpen: () => void }) {
  const national = usesCountryFigures(region, kpis);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${region.name}`}
      title={region.name}
      className="flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-line-strong"
    >
      <MapPin aria-hidden className="size-4 shrink-0 text-type-region max-md:hidden" />
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-body leading-tight font-semibold break-words text-fg">{region.name}</span>
        <span className="truncate text-label text-fg-muted">
          <span className="md:hidden">{shortLevelLabel(region.subtype)}</span>
          <span className="max-md:hidden">{levelLabel(region.subtype)}</span>
          {national && " · national figures"}
        </span>
      </span>
    </button>
  );
}

function CountsCell({ column, max }: { column: CompareRegion; max: number }) {
  const total = totalOf(column.counts);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface-2/50 p-3">
      <span className="sr-only">{column.region.name}: </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-figure font-semibold text-fg tabular-nums">{total}</span>
        <span className="text-label text-fg-muted">{total === 1 ? "story" : "stories"}</span>
      </span>
      <ImpactSplitBar counts={column.counts} scale={max > 0 ? total / max : 0} />
      <ImpactCountsInline counts={column.counts} className="flex-wrap gap-x-2 gap-y-1" />
    </div>
  );
}

function KpiCell({
  kpi,
  rowLabel,
  column,
  compactOnPhones,
  nav,
}: {
  kpi: Kpi | null;
  rowLabel: string;
  column: CompareRegion | null;
  compactOnPhones: boolean;
  nav: RegionNav;
}) {
  if (!column) return <Skeleton className="h-24 rounded-lg" />;
  if (!kpi) {
    return (
      <div className="flex min-h-12 items-center justify-center rounded-lg bg-surface-2/20 p-3 text-center text-label text-fg-subtle md:min-h-24">
        <span className="sr-only">{column.region.name}: not tracked here</span>
        <span aria-hidden>—</span>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <span className="sr-only">{column.region.name}: </span>
      <KpiTile kpi={kpi} onClick={(k) => nav.openEntityPage(k.id)} className={cn("h-full w-full", compactOnPhones && "max-md:hidden")} />
      {compactOnPhones && <CompactKpi kpi={kpi} rowLabel={rowLabel} onOpen={() => nav.openEntityPage(kpi.id)} className="md:hidden" />}
    </div>
  );
}

/** The figure, its unit and its change: what a KPI tile says, in a third of a phone's width. */
function CompactKpi({ kpi, rowLabel, onOpen, className }: { kpi: Kpi; rowLabel: string; onOpen: () => void; className?: string }) {
  const impact = kpiChangeImpact(kpi.change, kpi.higher_is);
  const tone = impactTone(impact);
  const percent = kpi.unit.trim() === "%";
  const value = `${formatKpiValue(kpi.latest)}${percent ? "%" : ""}`;
  const change = formatKpiChange(kpi);
  const changeWords = describeKpiChange(kpi);
  const summary = `${kpi.name}: ${value}${percent ? "" : ` ${kpi.unit}`}${changeWords ? `, ${changeWords}` : ""}${
    impact !== "neutral" ? ` (${tone.label.toLowerCase()})` : ""
  }, as of ${formatDate(kpi.as_of)}. Source: ${kpi.source_name}.`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`As of ${formatDate(kpi.as_of)} · ${kpi.source_name}`}
      className={cn(
        "flex h-full min-h-24 w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-line bg-surface-2/50 p-2.5 text-left transition-colors hover:border-line-strong",
        className,
      )}
    >
      <span className="sr-only">{summary}</span>
      {kpi.name !== rowLabel && (
        <span aria-hidden className="w-full truncate text-label text-fg-muted">
          {kpi.name}
        </span>
      )}
      <span aria-hidden className="text-figure font-semibold text-fg tabular-nums">
        {value}
      </span>
      {!percent && (
        <span aria-hidden className="w-full truncate text-label text-fg-muted">
          {kpi.unit}
        </span>
      )}
      {change && (
        <span aria-hidden className={cn("mt-auto text-label font-medium whitespace-nowrap tabular-nums", tone.text)}>
          {change}
        </span>
      )}
    </button>
  );
}

function PulseCompareRow({ row, columns, n }: { row: PulseRow; columns: (CompareRegion | null)[]; n: number }) {
  const Icon = SECTORS[row.sector].icon;
  return (
    <div role="group" aria-label={row.label} className={cn(ROW, "items-center px-3 py-2")} style={rowStyle(n)}>
      <div className={LABEL}>
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{row.label}</span>
      </div>
      {row.cells.map((cell, i) => (
        <PulseCell key={columns[i]?.region.id ?? i} tile={cell} share={row.shares[i]} regionName={columns[i]?.region.name ?? null} />
      ))}
    </div>
  );
}

function PulseCell({ tile, share, regionName }: { tile: PulseTile | null; share: number; regionName: string | null }) {
  if (!tile) return <Skeleton className="h-5 rounded-md" />;
  const tone = impactTone(tile.impact);
  const Icon = IMPACT_ICONS[tile.impact].icon;
  const quiet = tile.count === 0;
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-1.5" title={tile.description}>
      <span className="sr-only">
        {regionName}: {tile.description}
      </span>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", quiet ? "invisible" : tone.text)} />
      <span aria-hidden className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
        <span className={cn("h-full rounded-full", tone.bg)} style={{ width: `${share * 100}%` }} />
      </span>
      <span aria-hidden className={cn("w-5 shrink-0 text-right text-label tabular-nums", quiet ? "text-fg-subtle" : "font-medium text-fg")}>
        {tile.count}
      </span>
      <span aria-hidden className="w-2.5 shrink-0 text-label">
        <MomentumArrow direction={tile.direction} />
      </span>
    </div>
  );
}
