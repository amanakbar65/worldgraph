import {
  Activity,
  ChevronRight,
  Columns3,
  Gauge,
  Info,
  Layers,
  MapPin,
  MessageCircleQuestion,
  Network,
  Newspaper,
  Star,
  Users,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import type { RegionResponse } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { KpiTile } from "@/components/KpiTile";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNav, type Panel } from "@/state/nav";
import { sampleArg, useSettings } from "@/state/settings";
import { useUserValue } from "@/platform/storage";

import { ConnectionsGraph } from "./ConnectionsGraph";
import {
  buildBreadcrumb,
  childrenTitle,
  kpiScopeRegion,
  levelLabel,
  shapeSectorPulse,
  showsSample,
  windowWords,
} from "./region-data";
import { ChildRow, RegionStoryRow, SectorPulseGrid, Updating, WindowSwitch } from "./region-parts";
import { useRegionNav, type RegionNav } from "./use-region-nav";

type Data = RegionResponse;

const STORY_LIMIT = 5;
const DECISION_LIMIT = 3;
const CHILD_LIMIT = 6;

/**
 * A place at a glance, at any level (bloc, country, state, city): where it
 * sits, its key numbers, which sectors are busy and which way, the top
 * stories, the decisions ahead, the places inside it and what it connects
 * to. Changing the window keeps the current figures on screen until the
 * new ones arrive.
 */
export default function RegionPanel({ panel }: { panel: Extract<Panel, { kind: "region" }> }) {
  const timeWindow = useNav((s) => s.window);
  const sample = useSettings((s) => s.sample);
  const id = panel.id;
  const query = useRpc(
    "region",
    { id, window: timeWindow, sample: sampleArg(sample) },
    // Keep this region's figures while another window loads; never show another region's.
    { placeholderData: (previous) => (previous && previous.region.id === id ? previous : undefined) },
  );
  const nav = useRegionNav();

  if (query.isPending) return <RegionSkeleton />;
  if (query.isError && !query.data) {
    return (
      <div className="p-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  // Keyed by region: going from one place to the next starts fresh (toggles, notes, highlights).
  return <RegionBody key={query.data.region.id} data={query.data} nav={nav} updating={query.isPlaceholderData} />;
}

function RegionBody({ data, nav, updating }: { data: Data; nav: RegionNav; updating: boolean }) {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 p-4 pb-8">
      <RegionHeader data={data} nav={nav} headingId={headingId} updating={updating} />
      <KpiSection data={data} nav={nav} />
      <PulseSection data={data} nav={nav} />
      <StoriesSection data={data} nav={nav} />
      <DecisionsSection data={data} nav={nav} />
      <ChildrenSection data={data} nav={nav} />
      <ConnectionsSection data={data} nav={nav} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function RegionHeader({
  data,
  nav,
  headingId,
  updating,
}: {
  data: Data;
  nav: RegionNav;
  headingId: string;
  updating: boolean;
}) {
  const { region } = data;
  const timeWindow = useNav((s) => s.window);
  const crumbs = buildBreadcrumb(region);
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const facts = [levelLabel(region.subtype)];
  if (region.population !== null && region.population > 0) facts.push(`Population ${formatCompact(region.population)}`);

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {crumbs.length > 1 && (
          <nav aria-label="Where this is">
            <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-label text-fg-muted">
              {crumbs.map((crumb, i) => (
                <li key={crumb.id} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />}
                  {crumb.current ? (
                    <span aria-current="page" className="truncate px-1 font-medium text-fg">
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => nav.openRegion(crumb.id)}
                      className="relative cursor-pointer truncate rounded px-1 py-0.5 underline-offset-2 transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-[''] hover:text-fg hover:underline"
                    >
                      {crumb.name}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl border border-type-region/40 bg-type-region/12"
          >
            <MapPin className="size-5 text-type-region" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={headingId} className="text-figure font-semibold tracking-tight text-fg">
              {region.name}
            </h2>
            <p className="text-label text-fg-muted">
              {facts.join(" · ")}
              {parent && <span className="sr-only">, in {parent.name}</span>}
            </p>
          </div>
          {showsSample(data) && <SampleBadge className="mt-2" />}
        </div>
      </div>

      <RegionActions regionId={region.id} regionName={region.name} nav={nav} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label text-fg-muted">
          Activity in the {windowWords(timeWindow, true)}{" "}
          <Updating active={updating} />
        </p>
        <WindowSwitch />
      </div>
    </header>
  );
}

function RegionActions({ regionId, regionName, nav }: { regionId: string; regionName: string; nav: RegionNav }) {
  const watchlist = useUserValue<string[]>("watchlist", []);
  const watching = watchlist.value.includes(regionId);
  const [note, setNote] = useState("");
  const toggleWatch = () => {
    watchlist.setValue((prev) => (prev.includes(regionId) ? prev.filter((x) => x !== regionId) : [...prev, regionId]));
    setNote(watching ? `${regionName} removed from your watchlist.` : `${regionName} added to your watchlist.`);
  };
  const action = "h-14 flex-col gap-1 px-2 text-label";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          className={action}
          onClick={() => nav.ask(regionId)}
          aria-label="Ask about this region"
          title={`Ask about ${regionName}`}
        >
          <MessageCircleQuestion aria-hidden />
          Ask
        </Button>
        <Button
          variant="secondary"
          className={action}
          onClick={() => nav.openCompare([regionId])}
          aria-label={`Compare ${regionName} with other regions`}
        >
          <Columns3 aria-hidden />
          Compare
        </Button>
        <Button
          variant="secondary"
          className={cn(action, "aria-pressed:bg-fg/15 aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--line-strong)]")}
          onClick={toggleWatch}
          disabled={watchlist.loading}
          aria-pressed={watching}
          aria-label={`Watch ${regionName}`}
          title={
            watchlist.kind === "memory"
              ? "Saved for this visit only"
              : watching
                ? `On your watchlist. Tap to remove ${regionName}.`
                : `Add ${regionName} to your watchlist`
          }
        >
          <Star aria-hidden className={cn(watching && "fill-current")} />
          Watch
        </Button>
      </div>
      <p role="status" aria-live="polite" className={cn("text-label text-fg-muted", !note && !watchlist.saveError && "sr-only")}>
        {watchlist.saveError ? "Couldn't save your watchlist; it's kept for this visit." : note}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key numbers
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  description,
  action,
  count,
  children,
}: {
  icon: Parameters<typeof SectionHeader>[0]["icon"];
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title={title} icon={icon} description={description} action={action} count={count} />
      {children}
    </section>
  );
}

function KpiSection({ data, nav }: { data: Data; nav: RegionNav }) {
  const scope = kpiScopeRegion(data);
  return (
    <Section
      icon={Gauge}
      title="Key numbers"
      description={
        scope ? (
          <span className="inline-flex items-center gap-1">
            <Info aria-hidden className="size-3.5 shrink-0" />
            {scope.name ? `Figures for ${scope.name} as a whole` : "Figures for the wider country"}
          </span>
        ) : undefined
      }
    >
      {data.kpis.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {data.kpis.slice(0, 4).map((kpi) => (
            <KpiTile key={kpi.id} kpi={kpi} onClick={(k) => nav.openEntityPage(k.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon={Gauge}
          title="No key numbers here yet"
          description="Figures such as inflation or fuel prices appear when a source covers this place."
          className="rounded-lg border border-dashed border-line"
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sector pulse
// ---------------------------------------------------------------------------

function PulseSection({ data, nav }: { data: Data; nav: RegionNav }) {
  const timeWindow = useNav((s) => s.window);
  const lens = useNav((s) => s.sectors);
  const tiles = useMemo(() => shapeSectorPulse(data.sector_pulse, timeWindow), [data.sector_pulse, timeWindow]);
  return (
    <Section
      icon={Activity}
      title="Sector pulse"
      description={`Stories per sector. ▲▼ against the previous ${windowWords(timeWindow)}. Tap one to filter the map.`}
    >
      <SectorPulseGrid tiles={tiles} selected={lens} onToggle={(tile) => nav.toggleSector(tile.sector)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

function StoriesSection({ data, nav }: { data: Data; nav: RegionNav }) {
  const [all, setAll] = useState(false);
  const timeWindow = useNav((s) => s.window);
  const setWindow = useNav((s) => s.setWindow);
  const stories = all ? data.stories : data.stories.slice(0, STORY_LIMIT);
  return (
    <Section
      icon={Newspaper}
      title="Top stories"
      action={
        data.stories.length > STORY_LIMIT ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${data.stories.length}`}
          </Button>
        ) : undefined
      }
    >
      {data.stories.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {stories.map((story) => (
            <li key={story.id}>
              <RegionStoryRow story={story} onOpen={nav.openStory} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Newspaper}
          title={`No stories in the ${windowWords(timeWindow, true)}`}
          description={timeWindow === "30d" ? "It has been quiet here. Try a nearby place." : "Try a longer window."}
          action={timeWindow === "30d" ? undefined : { label: "Show 30 days", onClick: () => setWindow("30d") }}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Decisions ahead (crowd forecasts)
// ---------------------------------------------------------------------------

function DecisionsSection({ data, nav }: { data: Data; nav: RegionNav }) {
  const [all, setAll] = useState(false);
  const { region, decisions } = data;
  const wider = decisions
    .map((f) => f.region)
    .filter((r): r is NonNullable<typeof r> => !!r && r.id !== region.id)
    .find((r) => region.breadcrumb.some((b) => b.id === r.id));
  const about = wider ? `${region.name} and ${wider.name}` : region.name;
  const shown = all ? decisions : decisions.slice(0, DECISION_LIMIT);
  return (
    <Section
      icon={Users}
      title="Decisions ahead"
      description={`Crowd forecasts about ${about}, soonest first. Not facts; for information only.`}
      action={
        decisions.length > DECISION_LIMIT ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${decisions.length}`}
          </Button>
        ) : undefined
      }
    >
      {decisions.length > 0 ? (
        <div className="-mx-3 flex flex-col">
          {shown.map((forecast) => (
            <ForecastRow key={forecast.id} forecast={forecast} short onOpen={(f) => nav.openForecast(f.id)} />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon={Users}
          title="No upcoming decisions tracked"
          description="Elections, rate decisions and trade deals appear here when the crowd forecasts them."
          action={{ label: "Browse forecasts", onClick: nav.showForecasts }}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Places inside
// ---------------------------------------------------------------------------

function ChildrenSection({ data, nav }: { data: Data; nav: RegionNav }) {
  const [all, setAll] = useState(false);
  const { children, region } = data;
  if (children.length === 0) return null;
  const max = Math.max(0, ...children.map((c) => c.count));
  const shown = all ? children : children.slice(0, CHILD_LIMIT);
  const quiet = children.every((c) => c.count === 0);
  return (
    <Section
      icon={Layers}
      title={childrenTitle(region.subtype, children.map((c) => c.subtype))}
      count={children.length}
      description={quiet ? "No stories in any of them in this window." : "Busiest first."}
      action={
        children.length > CHILD_LIMIT ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : "Show all"}
          </Button>
        ) : undefined
      }
    >
      <ul className="-mx-2 flex flex-col">
        {shown.map((child) => (
          <li key={child.id}>
            <ChildRow child={child} max={max} onOpen={nav.openRegion} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function ConnectionsSection({ data, nav }: { data: Data; nav: RegionNav }) {
  return (
    <Section icon={Network} title="Connections" description="Who and what this place is linked to. Tap to open.">
      <ConnectionsGraph
        graph={data.graph}
        focusId={data.region.id}
        regionName={data.region.name}
        onOpen={nav.openNode}
        onSeeAll={() => nav.openEntityPage(data.region.id)}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function RegionSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4" aria-busy="true" aria-label="Loading region">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <SkeletonText lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
