import { Briefcase, Layers, Lightbulb, MapPin, Pencil, Sparkles } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useRpc } from "@/api/client";
import { SECTOR_IDS, type TimeWindow } from "@/api/contract";
import { EmptyState, type StateAction } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { SectorChip } from "@/components/SectorChip";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/lib/hooks";
import { TIME_WINDOWS, WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { currentPanel, useNav } from "@/state/nav";
import { profilePlaces, useProfile } from "@/state/profile";
import { sampleArg, useSettings } from "@/state/settings";

import { OpportunityCard } from "./OpportunityCard";
import { OpportunityRadar, RadarSkeleton } from "./OpportunityRadar";
import { canRankForYou, opportunitiesArgs, radarSectors, summarise } from "./opportunity-data";
import { useOpportunityPrefs } from "./prefs";

const PAGE = 10;

/**
 * Opportunities: openings in the news (new policies, incentives, demand
 * spikes, supply gaps) on a radar by sector, and as a ranked list of cards.
 * Ranked for the viewer's business when there is a profile.
 */
export default function OpportunitiesView() {
  const profile = useProfile();
  const timeWindow = useNav((s) => s.window);
  const lens = useNav((s) => s.sectors);
  const toggleSector = useNav((s) => s.toggleSector);
  const clearSectors = useNav((s) => s.clearSectors);
  const setView = useNav((s) => s.setView);
  const open = useNav((s) => s.open);
  const sample = useSettings((s) => s.sample);
  const prefs = useOpportunityPrefs();
  const [active, setActive] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const listHeadingId = useId();
  const panelOpen = useNav((s) => {
    const panel = currentPanel(s);
    return panel !== null && panel.kind !== "cascade" && panel.kind !== "compare";
  });
  const isDesktop = useIsDesktop();

  const hasProfile = profile.loaded && canRankForYou(profile.value);
  const forYou = hasProfile && prefs.forYou;
  const places = hasProfile ? profilePlaces(profile.value) : [];
  const placesOnly = prefs.placesOnly && places.length > 0;
  const args = useMemo(
    () =>
      opportunitiesArgs({
        sectors: lens,
        profile: profile.value,
        forYou,
        placesOnly,
        window: timeWindow,
        sample: sampleArg(sample),
      }),
    [lens, profile.value, forYou, placesOnly, timeWindow, sample],
  );
  const query = useRpc("opportunities", args, {
    // Wait for the stored profile, so the list isn't fetched twice on open.
    enabled: profile.loaded,
    placeholderData: (previous) => previous,
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const summary = summarise(items);
  const sectors = useMemo(() => radarSectors(lens), [lens]);
  const yours = hasProfile ? profile.value.sectors : [];
  const windowWords = WINDOW_LABELS[timeWindow].long.toLowerCase();

  const openStory = (id: string) => open({ kind: "story", id });
  const openForecast = (id: string) => open({ kind: "forecast", id });

  const emptyActions: StateAction[] = [];
  if (timeWindow !== "30d") emptyActions.push({ label: "Show 30 days", onClick: () => useNav.getState().setWindow("30d") });
  if (lens.length) emptyActions.push({ label: "All sectors", onClick: clearSectors, icon: Layers });
  if (placesOnly) emptyActions.push({ label: "Anywhere", onClick: () => prefs.set({ placesOnly: false }), icon: MapPin });

  const loading = !profile.loaded || (query.isPending && !query.data);

  return (
    <div className={cn("h-full overflow-y-auto overscroll-contain", isDesktop && panelOpen && "xl:pr-[452px]")}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <h1 className="flex min-w-0 items-center gap-2 text-figure font-semibold tracking-tight">
                <Lightbulb aria-hidden className="hidden size-6 shrink-0 text-fg-muted sm:block" />
                <span className="truncate">Opportunities</span>
              </h1>
              <Segmented<TimeWindow>
                aria-label="Time window"
                value={timeWindow}
                onValueChange={(w) => {
                  setShown(PAGE);
                  useNav.getState().setWindow(w);
                }}
                options={TIME_WINDOWS.map((w) => ({
                  value: w,
                  label: WINDOW_LABELS[w].short,
                  ariaLabel: WINDOW_LABELS[w].long,
                }))}
              />
            </div>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-fg-muted">
              {loading
                ? "Openings in the news: new policies, incentives, demand and supply gaps."
                : summary.total === 0
                  ? `No openings in the ${windowWords}.`
                  : `${summary.total} ${summary.total === 1 ? "opening" : "openings"} in the ${windowWords}${
                      summary.withForecast ? `, ${summary.withForecast} with a crowd forecast` : ""
                    }. ${forYou ? "Ranked for your business." : "Ranked by importance and momentum."}`}
              {summary.sample && <SampleBadge compact />}
              {query.isPlaceholderData && query.isFetching && <span className="text-label">Updating…</span>}
            </p>
          </div>

          {hasProfile && (
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<"you" | "all">
                aria-label="Rank the openings"
                value={forYou ? "you" : "all"}
                onValueChange={(v) => {
                  setShown(PAGE);
                  prefs.set({ forYou: v === "you" });
                }}
                options={[
                  { value: "you", label: "For your business", icon: Briefcase },
                  { value: "all", label: "For everyone", icon: Sparkles },
                ]}
              />
              {places.length > 0 && (
                <ChipButton
                  size="lg"
                  selected={placesOnly}
                  onClick={() => {
                    setShown(PAGE);
                    prefs.set({ placesOnly: !prefs.placesOnly });
                  }}
                >
                  <MapPin aria-hidden />
                  Only your places
                </ChipButton>
              )}
            </div>
          )}

          {profile.loaded && !hasProfile && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
              <Briefcase aria-hidden className="size-4 shrink-0 text-fg-muted" />
              <p className="min-w-0 flex-1 basis-48 text-body text-fg-muted">
                Tell WorldGraph about your business to rank these by how well they fit you.
              </p>
              <Button variant="outline" onClick={() => setView("business")}>
                <Pencil aria-hidden />
                Set up My Business
              </Button>
            </div>
          )}

          <div
            role="group"
            aria-label="Sector lens"
            className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            <ChipButton selected={lens.length === 0} onClick={clearSectors} className="shrink-0">
              <Layers aria-hidden />
              All sectors
            </ChipButton>
            {SECTOR_IDS.map((sector) => (
              <SectorChip
                key={sector}
                sector={sector}
                selected={lens.includes(sector)}
                onClick={(s) => {
                  setShown(PAGE);
                  toggleSector(s);
                }}
                className="shrink-0"
              />
            ))}
          </div>
        </header>

        {loading ? (
          <Layout radar={<RadarSkeleton />} list={<ListSkeleton />} />
        ) : query.isError && !query.data ? (
          <ErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
            className="rounded-xl border border-line bg-surface"
          />
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface">
            <EmptyState
              icon={Lightbulb}
              title={`No openings in the ${windowWords}`}
              description={
                lens.length || placesOnly
                  ? "Nothing matches these filters yet. Widen them to see more."
                  : "New policies, incentives and demand shifts show up here as they're reported."
              }
              action={emptyActions[0]}
              secondaryAction={emptyActions[1]}
            />
          </div>
        ) : (
          <Layout
            radar={
              <OpportunityRadar
                items={items}
                sectors={sectors}
                yours={yours}
                forYou={forYou}
                measure={prefs.measure}
                onMeasure={(measure) => prefs.set({ measure })}
                view={prefs.radarView}
                onView={(radarView) => prefs.set({ radarView })}
                active={active}
                onActive={setActive}
                onOpen={openStory}
              />
            }
            list={
              <section aria-labelledby={listHeadingId} className="flex min-w-0 flex-col gap-3">
                <SectionHeader
                  id={listHeadingId}
                  title={forYou ? "Best fit first" : "Strongest first"}
                  icon={Sparkles}
                  count={items.length}
                  description="Tap one for the full story, its sources and what could follow."
                />
                <ol className="flex flex-col gap-3" aria-label="Openings">
                  {items.slice(0, shown).map((item, i) => (
                    <li key={item.story.id}>
                      <OpportunityCard
                        item={item}
                        rank={i + 1}
                        profile={forYou ? profile.value : null}
                        active={active === item.story.id}
                        onHover={setActive}
                        onOpen={openStory}
                        onOpenForecast={openForecast}
                      />
                    </li>
                  ))}
                </ol>
                {items.length > PAGE && (
                  <button
                    type="button"
                    onClick={() => setShown(shown >= items.length ? PAGE : shown + PAGE)}
                    className="flex h-10 cursor-pointer items-center justify-center rounded-lg border border-line text-body text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                  >
                    {shown >= items.length ? "Show fewer" : `Show more (${items.length - shown} left)`}
                  </button>
                )}
              </section>
            }
          />
        )}
      </div>
    </div>
  );
}

/** Radar first (it's the glance), then the ranked list; side by side on wide screens. */
function Layout({ radar, list }: { radar: ReactNode; list: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      {/* Stays in view beside the list where the screen is tall enough to show all of it. */}
      <div className="lg:top-4 lg:[@media(min-height:52rem)]:sticky">{radar}</div>
      <div className="min-w-0">{list}</div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading openings" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-4/5" />
          <SkeletonText lines={2} />
        </li>
      ))}
    </ul>
  );
}
