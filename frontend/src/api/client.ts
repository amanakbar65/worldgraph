import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { useConnection } from "./connection";
import type { RpcArgs, RpcName, RpcResponse } from "./contract";
import { DataError, stableJson, type CallOptions, type DataSource } from "./source";
import { ConnectorSource } from "./sources/connector";
import { HttpSource } from "./sources/http";
import { loadSnapshot, snapshotKey, StaticSource, useSnapshot } from "./sources/static";
import { TARGET } from "@/platform/runtime";
import { sampleArg, useIndiaBorders, useServerViewer, useSettings } from "@/state/settings";

/** What the app is currently showing: live data, the bundled snapshot, or nothing (connection.ts). */
export { useConnection, type ConnectionState } from "./connection";

const FALL_BACK_TO_SNAPSHOT: ReadonlySet<DataError["kind"]> = new Set([
  "connector_missing",
  "connector_reauth",
  "not_allowed",
  "offline",
]);

/**
 * Failures of the data connection itself, which the status pill reports.
 * One answer going wrong (an item that's gone, a function that raised an
 * error, an odd shape) is that panel's own error state, and a cancelled
 * call (not a DataError) is no failure at all.
 */
const CONNECTION_FAILURES: ReadonlySet<DataError["kind"]> = new Set([
  "unavailable",
  "offline",
  "connector_missing",
  "connector_reauth",
  "not_allowed",
]);

export function isConnectionFailure(error: unknown): error is DataError {
  return (
    error instanceof DataError && CONNECTION_FAILURES.has(error.kind) && !/^not found/i.test(error.message)
  );
}

/** A snapshot that can say whether this viewer may see it (StaticSource). */
export interface SnapshotSource extends DataSource {
  available(): Promise<boolean>;
}

/**
 * Try the live source; when it can't run in this view, use the snapshot if
 * this viewer may see it (a sample one only with Sample data on). If not,
 * the call fails with the live source's own reason, so each screen says
 * what's wrong and offers its retry instead of showing invented stories.
 */
export class LiveWithSnapshot implements DataSource {
  readonly kind = "connector" as const;
  constructor(
    private readonly live: DataSource,
    private readonly snapshot: SnapshotSource,
  ) {}

  async call<N extends RpcName>(name: N, args: RpcArgs[N], options?: CallOptions): Promise<RpcResponse<N>> {
    try {
      const data = await this.live.call(name, args, options);
      useConnection.getState().set({ status: "live", source: this.live.kind });
      return data;
    } catch (error) {
      if (error instanceof DataError && FALL_BACK_TO_SNAPSHOT.has(error.kind)) {
        if (!(await this.snapshot.available())) {
          useConnection.getState().set({ status: "disconnected", reason: error });
          throw error;
        }
        useConnection.getState().set({ status: "snapshot", reason: error });
        return this.snapshot.call(name, args, options);
      }
      if (isConnectionFailure(error)) useConnection.getState().set({ status: "error", reason: error });
      throw error;
    }
  }
}

export class Tracked implements DataSource {
  readonly kind: DataSource["kind"];
  constructor(private readonly inner: DataSource) {
    this.kind = inner.kind;
  }
  async call<N extends RpcName>(name: N, args: RpcArgs[N], options?: CallOptions): Promise<RpcResponse<N>> {
    try {
      const data = await this.inner.call(name, args, options);
      useConnection.getState().set({ status: "live", source: this.inner.kind });
      return data;
    } catch (error) {
      if (isConnectionFailure(error)) useConnection.getState().set({ status: "error", reason: error });
      throw error;
    }
  }
}

export const dataSource: DataSource =
  TARGET === "artifact"
    ? new LiveWithSnapshot(new ConnectorSource(), new StaticSource())
    : new Tracked(new HttpSource());

/**
 * Test link: show the bundled snapshot as a placeholder while the connector
 * starts (that can take several seconds), then swap in live data. A sample
 * snapshot is only there for a viewer with Sample data on (useSnapshot keeps
 * it from everyone else), so nobody else ever sees invented stories flash up.
 */
const SNAPSHOT_FIRST_FRAME = TARGET === "artifact";
if (SNAPSHOT_FIRST_FRAME) void loadSnapshot();

export function rpcKey<N extends RpcName>(name: N, args: RpcArgs[N]) {
  return ["rpc", name, stableJson(args)] as const;
}

/**
 * Functions that take `sample`: every read but meta (whose counts are only
 * for the status line, and whose snapshot has one shape).
 */
const SAMPLE_ARG: ReadonlySet<RpcName> = new Set<RpcName>([
  "globe",
  "top",
  "region",
  "story",
  "cascade",
  "entity",
  "graph",
  "local_graph",
  "graph_as_of",
  "local_graph_as_of",
  "forecasts",
  "forecast",
  "search",
  "affects",
  "opportunities",
  "compare",
  "brief",
  "ask_context",
  "schema",
]);
/** Functions that name or place regions differently in India's view. */
const WORLDVIEW_ARG: ReadonlySet<RpcName> = new Set<RpcName>(["search", "region"]);

export interface ViewerChoices {
  /** The Sample data setting as an argument (undefined: "auto", the database decides). */
  sample: boolean | undefined;
  /** Whether the viewer sees India's official borders. */
  india: boolean;
}

/**
 * The arguments a call is sent with: the screen's own, plus the viewer's
 * Sample data setting and worldview wherever the screen left them out.
 */
export function withViewerArgs<N extends RpcName>(
  name: N,
  args: RpcArgs[N],
  viewer: ViewerChoices,
): RpcArgs[N] {
  const own = args as Record<string, unknown>;
  let out = own;
  if (viewer.sample !== undefined && SAMPLE_ARG.has(name) && own.sample === undefined) {
    out = { ...out, sample: viewer.sample };
  }
  if (viewer.india && WORLDVIEW_ARG.has(name) && own.worldview === undefined) {
    out = { ...out, worldview: "india" };
  }
  return out as RpcArgs[N];
}

/** Fetch one api function with caching, polling and cancellation. */
export function useRpc<N extends RpcName>(
  name: N,
  screenArgs: RpcArgs[N],
  options: Omit<UseQueryOptions<RpcResponse<N>, Error>, "queryKey" | "queryFn"> = {},
) {
  const sample = sampleArg(useSettings((s) => s.sample));
  const india = useIndiaBorders();
  const args = withViewerArgs(name, screenArgs, { sample, india });
  const placeholder = useSnapshot((s) =>
    SNAPSHOT_FIRST_FRAME ? (s.data.get(snapshotKey(name, args)) as RpcResponse<N> | undefined) : undefined,
  );
  return useQuery<RpcResponse<N>, Error>({
    queryKey: rpcKey(name, args),
    queryFn: ({ signal }) =>
      dataSource.call(name, args, { signal }).then((data) => {
        // The website's meta carries the viewer's country (for India's borders).
        if (name === "meta") {
          const country = (data as RpcResponse<"meta">).viewer_country ?? null;
          if (useServerViewer.getState().country !== country) useServerViewer.setState({ country });
        }
        return data;
      }),
    placeholderData: (() => placeholder) as UseQueryOptions<RpcResponse<N>, Error>["placeholderData"],
    ...options,
  });
}
