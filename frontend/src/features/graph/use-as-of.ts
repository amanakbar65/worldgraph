import { useEffect } from "react";

import { useRpc } from "@/api/client";
import { useConnection } from "@/api/connection";
import type { RpcArgs } from "@/api/contract";
import { useSnapshot } from "@/api/sources/static";
import { useFlag } from "@/lib/flags";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

import { asOfUnavailable, dayOf, historyStartFromError, snapshotHasAsOf, useHistoryStart, type AsOfUnavailable } from "./as-of";

export interface AsOfState {
  /** kg.history is on: the date control shows. */
  enabled: boolean;
  /** The day in the navigation state (YYYY-MM-DD), whether or not it can be shown. */
  requested: string | null;
  /** Why past dates can't be shown here, or null. */
  unavailable: AsOfUnavailable;
  /** The day the graph is read at: requested, when it can be shown. */
  day: string | null;
  /** A day is asked for but api.meta (with the flag) hasn't answered yet: hold the graph calls. */
  waiting: boolean;
}

/** The graph's "as of" day and whether it can be shown in this view. */
export function useAsOf(): AsOfState {
  const enabled = useFlag("kg.history");
  const meta = useRpc("meta", {});
  const requested = useNav((s) => s.asOf);
  const sample = useSettings((s) => s.sample);
  const connection = useConnection((s) => s.state.status);
  const fromSnapshot = useSnapshot((s) => snapshotHasAsOf(s.data.keys()));
  const unavailable = asOfUnavailable({
    sample,
    // (Test stand-ins for meta may carry only the flags.)
    showingSample: meta.data?.data?.showing_sample ?? false,
    connection,
    snapshotHasAsOf: fromSnapshot,
  });
  const known = meta.data !== undefined || meta.isError;
  return {
    enabled,
    requested,
    unavailable,
    day: enabled && !unavailable ? requested : null,
    waiting: requested !== null && !known,
  };
}

interface GraphQueryOptions {
  local: boolean;
  noTypes: boolean;
  focusId: string | null;
}

/**
 * The graph screen's two reads: the whole graph and the graph around one
 * node, live (api.graph, api.local_graph) or as of a day (the _as_of
 * calls). Each keeps one query observer whichever it reads, so the graph on
 * screen stays put while a new day loads ("Updating…").
 */
export function useGraphQueries(
  globalArgs: RpcArgs["graph"],
  localArgs: RpcArgs["local_graph"],
  { local, noTypes, focusId }: GraphQueryOptions,
  asOf: AsOfState,
) {
  const at = asOf.day;
  // A past day doesn't change, so it isn't polled.
  const timing = at ? { staleTime: Infinity, refetchInterval: false as const } : { refetchInterval: 300_000 };
  const globalQuery = useRpc(
    (at ? "graph_as_of" : "graph") as "graph",
    (at ? { ...globalArgs, at } : globalArgs) as RpcArgs["graph"],
    { enabled: !local && !noTypes && !asOf.waiting, placeholderData: (previous) => previous, ...timing },
  );
  const localQuery = useRpc(
    (at ? "local_graph_as_of" : "local_graph") as "local_graph",
    (at ? { ...localArgs, at } : localArgs) as RpcArgs["local_graph"],
    {
      enabled: local && !asOf.waiting,
      placeholderData: (previous) => (previous && previous.focus === focusId ? previous : undefined),
      ...timing,
    },
  );

  // Every as-of answer (and the "History starts on …" error) says when history starts.
  const query = local ? localQuery : globalQuery;
  const learn = useHistoryStart((s) => s.learn);
  const starts = at && !query.isPlaceholderData ? (query.data as { history_starts?: string } | undefined)?.history_starts : undefined;
  const error = at ? query.error : null;
  useEffect(() => {
    learn(dayOf(starts) ?? historyStartFromError(error));
  }, [starts, error, learn]);

  return { globalQuery, localQuery };
}
