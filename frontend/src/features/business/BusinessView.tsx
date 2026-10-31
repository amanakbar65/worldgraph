import { Briefcase, Building, KeyRound, MapPin, Package, Pencil, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Profile, TimeWindow } from "@/api/contract";
import { EmptyState } from "@/components/EmptyState";
import { SectorChip } from "@/components/SectorChip";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/lib/hooks";
import { TIME_WINDOWS, WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { currentPanel, useNav } from "@/state/nav";
import {
  isEmpty,
  toggleWatch,
  useAlertRules,
  useProfile,
  useWatchlist,
} from "@/state/profile";

import { AffectsFeed } from "./AffectsFeed";
import { AlertsCard, AlertSettings } from "./Alerts";
import { StoreNote } from "./business-parts";
import { NO_FILTER, type FeedFilter } from "./business-data";
import { Exposure } from "./Exposure";
import { ProfileSetup } from "./ProfileSetup";
import { useAffects, useBusinessAlerts, useWatchQueries } from "./use-business";
import { useFirstRun } from "./setup-state";
import { SuggestedForecasts, Watchlist } from "./Watchlist";

/**
 * My Business: a two-minute setup on the first visit, then what affects
 * you (with why), where it reaches your business, crowd forecasts for you,
 * your watchlist, and what's new since your last visit.
 */
export default function BusinessView() {
  const profile = useProfile();
  const phase = useFirstRun((s) => s.phase);
  const [editing, setEditing] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panelOpen = useNav((s) => {
    const panel = currentPanel(s);
    return panel !== null && panel.kind !== "cascade" && panel.kind !== "compare";
  });
  const isDesktop = useIsDesktop();

  const emptyProfile = profile.loaded && isEmpty(profile.value);
  const firstRun = phase === "open" || (phase === "unknown" && emptyProfile);
  useEffect(() => {
    if (profile.loaded && phase === "unknown") useFirstRun.setState({ phase: emptyProfile ? "open" : "done" });
  }, [profile.loaded, phase, emptyProfile]);

  const showSetup = editing !== null || firstRun;
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [showSetup]);

  return (
    <div
      ref={scroller}
      className={cn(
        "h-full overflow-y-auto overscroll-contain",
        // Leave room for the side panel on wide screens so nothing hides under it.
        isDesktop && panelOpen && "xl:pr-[452px]",
      )}
    >
      {!profile.loaded ? (
        <BusinessSkeleton />
      ) : showSetup ? (
        <ProfileSetup
          mode={editing !== null ? "edit" : "first-run"}
          initialStep={editing ?? 0}
          onDone={() => {
            if (editing === null) useFirstRun.setState({ phase: "done" });
            setEditing(null);
          }}
        />
      ) : (
        <Dashboard profile={profile.value} onEdit={(step) => setEditing(step)} />
      )}
    </div>
  );
}

function BusinessSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading My Business"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-4">
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

function Dashboard({ profile, onEdit }: { profile: Profile; onEdit: (step: number) => void }) {
  const stored = useProfile();
  const watchlist = useWatchlist();
  const rules = useAlertRules();
  const affects = useAffects();
  const watch = useWatchQueries(watchlist.value);
  const alerts = useBusinessAlerts(affects, watchlist.value, watch);
  const [filter, setFilter] = useState<FeedFilter>(NO_FILTER);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const empty = isEmpty(profile);

  // This visit counts as seen from now on (today's alerts stay until "Mark all as seen").
  const { ready, recordVisit } = alerts;
  useEffect(() => {
    if (ready) recordVisit();
    // Once per visit to the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const toggle = (id: string) => watchlist.set((prev) => toggleWatch(prev, id));
  const remove = (id: string) => {
    watchlist.set((prev) => prev.filter((x) => x !== id));
    if (rules.value.thresholds[id] !== undefined) setThreshold(id, null);
  };
  const setThreshold = (id: string, t: number | null) =>
    rules.set((prev) => {
      const thresholds = { ...prev.thresholds };
      if (t === null) delete thresholds[id];
      else thresholds[id] = t;
      return { ...prev, thresholds };
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <DashboardHeader
        profile={profile}
        onEdit={onEdit}
        storeKind={stored.kind}
        saveError={stored.saveError ?? watchlist.saveError}
      />

      <AlertsCard
        alerts={alerts.alerts}
        since={alerts.since}
        ready={alerts.ready && (empty || !affects.isPending)}
        onMarkSeen={alerts.markSeen}
      />

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start">
        {empty ? (
          <div className="rounded-xl border border-line bg-surface lg:col-start-1 lg:row-span-4 lg:row-start-1">
            <EmptyState
              icon={Briefcase}
              title="Tell us about your business"
              description="Add a sector, a place or an input, and WorldGraph will show the news that affects you."
              action={{ label: "Set up My Business", onClick: () => onEdit(0), icon: Pencil }}
            />
          </div>
        ) : (
          <>
            <div className="lg:col-start-2 lg:row-start-1">
              <Exposure
                items={affects.data?.items}
                profile={profile}
                loading={affects.isPending}
                selected={filter.node}
                onSelect={(node, name) => {
                  setFilter({ ...filter, node });
                  setNodeName(name);
                }}
              />
            </div>
            <div className="min-w-0 lg:col-start-1 lg:row-span-4 lg:row-start-1">
              <AffectsFeed
                affects={affects}
                profile={profile}
                filter={filter}
                onFilter={(f) => {
                  setFilter(f);
                  if (!f.node) setNodeName(null);
                }}
                nodeName={nodeName}
                onEditProfile={() => onEdit(0)}
              />
            </div>
            <div className="lg:col-start-2 lg:row-start-2">
              <SuggestedForecasts
                forecasts={affects.data?.suggested_forecasts}
                loading={affects.isPending}
                watchlist={watchlist.value}
                onToggleWatch={toggle}
              />
            </div>
          </>
        )}
        <div className="lg:col-start-2 lg:row-start-3">
          <Watchlist
            ids={watchlist.value}
            watch={watch}
            since={alerts.since}
            rules={rules.value}
            onAdd={toggle}
            onRemove={remove}
            onThreshold={setThreshold}
          />
        </div>
        <div className="lg:col-start-2 lg:row-start-4">
          <AlertSettings rules={rules.value} onChange={(next) => rules.set(next)} />
        </div>
      </div>
    </div>
  );
}

function DashboardHeader({
  profile,
  onEdit,
  storeKind,
  saveError,
}: {
  profile: Profile;
  onEdit: (step: number) => void;
  storeKind: ReturnType<typeof useProfile>["kind"];
  saveError: Error | null;
}) {
  const timeWindow = useNav((s) => s.window);
  const setWindow = useNav((s) => s.setWindow);
  const places = profile.locations.length + profile.suppliers.length + profile.markets.length;
  const counts: { n: number; one: string; many: string; icon: typeof MapPin }[] = [
    { n: places, one: "place", many: "places", icon: MapPin },
    { n: profile.inputs.length, one: "input", many: "inputs", icon: Package },
    { n: profile.competitors.length, one: "competitor", many: "competitors", icon: Building },
    { n: profile.keywords.length, one: "keyword", many: "keywords", icon: KeyRound },
  ];

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-figure font-semibold tracking-tight">
          <Store aria-hidden className="size-6 shrink-0 text-fg-muted" />
          <span className="truncate">My Business</span>
        </h1>
        <Button variant="outline" onClick={() => onEdit(0)} aria-label="Edit profile">
          <Pencil aria-hidden />
          <span className="sm:hidden">Edit</span>
          <span className="hidden sm:inline">Edit profile</span>
        </Button>
      </div>
      {!isEmpty(profile) && (
        <ul aria-label="Your profile" className="flex flex-wrap items-center gap-1.5">
          {profile.sectors.map((s) => (
            <li key={s}>
              <SectorChip sector={s} size="sm" />
            </li>
          ))}
          {counts
            .filter((c) => c.n > 0)
            .map((c) => (
              <li key={c.one}>
                <Chip size="sm">
                  <c.icon aria-hidden />
                  <span className="tabular-nums">
                    {c.n} {c.n === 1 ? c.one : c.many}
                  </span>
                </Chip>
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StoreNote kind={storeKind} error={saveError} />
        <Segmented<TimeWindow>
          aria-label="Time window"
          value={timeWindow}
          onValueChange={setWindow}
          className="ml-auto"
          options={TIME_WINDOWS.map((w) => ({
            value: w,
            label: WINDOW_LABELS[w].short,
            ariaLabel: WINDOW_LABELS[w].long,
          }))}
        />
      </div>
    </header>
  );
}
