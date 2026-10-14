/**
 * Data for My Business: the "Affects you" feed, the watchlist's activity and
 * the alerts since the last visit. Shared by the screen and the nav badge, so
 * both read the same cached calls.
 */
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { dataSource, rpcKey, useRpc } from "@/api/client";
import type { EntityResponse, ForecastResponse, ForecastSummary, StorySummary } from "@/api/contract";
import { useNav } from "@/state/nav";
import {
  collectAlerts,
  isEmpty,
  useAlertRules,
  useLastVisit,
  useProfile,
  useWatchlist,
  type Alert,
} from "@/state/profile";
import { sampleArg, useSettings } from "@/state/settings";

import { watchKind } from "./business-data";
import { useKnownNames } from "./entity-names";

/** Watched items whose activity is fetched (the rest still show, without counts). */
export const WATCH_QUERY_LIMIT = 12;

const SLOW = { staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 } as const;

/** api.affects for the profile, in the current window. Off while the profile is empty. */
export function useAffects() {
  const profile = useProfile();
  const timeWindow = useNav((s) => s.window);
  const sample = useSettings((s) => s.sample);
  const remember = useKnownNames((s) => s.remember);
  const ready = profile.loaded && !isEmpty(profile.value);
  const query = useRpc(
    "affects",
    { profile: profile.value, window: timeWindow, sample: sampleArg(sample) },
    // Keep the last feed on screen while a new window or profile loads.
    { enabled: ready, placeholderData: (previous) => previous },
  );
  const data = query.data;
  useEffect(() => {
    if (data) remember(data.items.flatMap((item) => item.matched));
  }, [data, remember]);
  return { ...query, ready };
}

export interface WatchQueries {
  entities: Map<string, UseQueryResult<EntityResponse, Error>>;
  forecasts: Map<string, UseQueryResult<ForecastResponse, Error>>;
}

/** api.entity for watched places and entities, api.forecast for watched forecasts (cached with their panels). */
export function useWatchQueries(ids: readonly string[]): WatchQueries {
  const remember = useKnownNames((s) => s.remember);
  const entityIds = ids.filter((id) => watchKind(id) !== "forecast").slice(-WATCH_QUERY_LIMIT);
  const forecastIds = ids.filter((id) => watchKind(id) === "forecast").slice(-WATCH_QUERY_LIMIT);
  const entities = useQueries({
    queries: entityIds.map((id) => ({
      queryKey: rpcKey("entity", { id }),
      queryFn: ({ signal }: { signal: AbortSignal }) => dataSource.call("entity", { id }, { signal }),
      ...SLOW,
    })),
  });
  const forecasts = useQueries({
    queries: forecastIds.map((id) => ({
      queryKey: rpcKey("forecast", { id }),
      queryFn: ({ signal }: { signal: AbortSignal }) => dataSource.call("forecast", { id }, { signal }),
      ...SLOW,
    })),
  });
  // Names seen on the way, for the profile and watchlist chips (a no-op once known).
  useEffect(() => {
    const seen = entities.map((q) => q.data?.entity).filter((e): e is EntityResponse["entity"] => !!e);
    if (seen.length) remember(seen);
  });
  return {
    entities: new Map(entityIds.map((id, i) => [id, entities[i]])),
    forecasts: new Map(forecastIds.map((id, i) => [id, forecasts[i]])),
  };
}

/** A watched forecast as a summary (api.forecast adds history and more). */
export function forecastSummaryOf(response: ForecastResponse | undefined): ForecastSummary | null {
  if (!response) return null;
  const { history: _history, outcomes: _outcomes, resolution_rule: _rule, entities: _entities, stories: _stories, ...summary } =
    response.forecast;
  return summary;
}

export interface BusinessAlerts {
  alerts: Alert[];
  /** The last visit the alerts count from (null on the first visit). */
  since: string | null;
  /** True once the last visit is known. */
  ready: boolean;
  markSeen: () => void;
  recordVisit: () => void;
}

/** What's new since the last visit: matching stories, watched news, forecast moves. */
export function useBusinessAlerts(
  affects: ReturnType<typeof useAffects>,
  watchlist: readonly string[],
  watch: WatchQueries,
): BusinessAlerts {
  const rules = useAlertRules();
  const visit = useLastVisit();
  const profileStories = affects.ready ? affects.data?.items : undefined;

  const watchStories: { watchId: string; story: StorySummary }[] = [];
  for (const [id, q] of watch.entities) {
    if (!watchlist.includes(id)) continue;
    for (const story of q.data?.timeline ?? []) watchStories.push({ watchId: id, story });
  }
  const forecasts: ForecastSummary[] = [];
  for (const [id, q] of watch.forecasts) {
    const f = forecastSummaryOf(q.data);
    if (f && watchlist.includes(id)) forecasts.push(f);
  }
  const alerts = collectAlerts({
    since: visit.since,
    rules: rules.value,
    profileStories: (profileStories ?? []).map((item) => item.story),
    watchStories,
    forecasts,
  });

  return {
    alerts,
    since: visit.since,
    ready: visit.loaded,
    markSeen: visit.markSeen,
    recordVisit: visit.recordVisit,
  };
}

/** Everything the nav badge needs: the number of alerts since the last visit. */
export function useBusinessAlertCount(): number {
  const watchlist = useWatchlist();
  const affects = useAffects();
  const watch = useWatchQueries(watchlist.value);
  return useBusinessAlerts(affects, watchlist.value, watch).alerts.length;
}
