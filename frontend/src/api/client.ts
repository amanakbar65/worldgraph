import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { create } from "zustand";

import type { RpcArgs, RpcName, RpcResponse } from "./contract";
import { DataError, stableJson, type CallOptions, type DataSource } from "./source";
import { ConnectorSource } from "./sources/connector";
import { HttpSource } from "./sources/http";
import { StaticSource } from "./sources/static";
import { TARGET } from "@/platform/runtime";

/** What the app is currently showing: live data, the bundled snapshot, or nothing. */
export type ConnectionState =
  | { status: "connecting" }
  | { status: "live"; source: DataSource["kind"] }
  | { status: "snapshot"; reason: DataError }
  | { status: "error"; reason: DataError };

export const useConnection = create<{ state: ConnectionState; set: (s: ConnectionState) => void }>((set) => ({
  state: { status: "connecting" },
  set: (state) => set({ state }),
}));

const FALL_BACK_TO_SNAPSHOT: ReadonlySet<DataError["kind"]> = new Set([
  "connector_missing",
  "connector_reauth",
  "not_allowed",
  "offline",
]);

/** Try the live source; when it can't run in this view, use the snapshot. */
class LiveWithSnapshot implements DataSource {
  readonly kind = "connector" as const;
  constructor(
    private readonly live: DataSource,
    private readonly snapshot: DataSource,
  ) {}

  async call<N extends RpcName>(name: N, args: RpcArgs[N], options?: CallOptions): Promise<RpcResponse<N>> {
    try {
      const data = await this.live.call(name, args, options);
      useConnection.getState().set({ status: "live", source: this.live.kind });
      return data;
    } catch (error) {
      if (error instanceof DataError && FALL_BACK_TO_SNAPSHOT.has(error.kind)) {
        useConnection.getState().set({ status: "snapshot", reason: error });
        return this.snapshot.call(name, args, options);
      }
      if (error instanceof DataError) useConnection.getState().set({ status: "error", reason: error });
      throw error;
    }
  }
}

class Tracked implements DataSource {
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
      if (error instanceof DataError) useConnection.getState().set({ status: "error", reason: error });
      throw error;
    }
  }
}

export const dataSource: DataSource =
  TARGET === "artifact"
    ? new LiveWithSnapshot(new ConnectorSource(), new StaticSource())
    : new Tracked(new HttpSource());

export function rpcKey<N extends RpcName>(name: N, args: RpcArgs[N]) {
  return ["rpc", name, stableJson(args)] as const;
}

/** Fetch one api function with caching, polling and cancellation. */
export function useRpc<N extends RpcName>(
  name: N,
  args: RpcArgs[N],
  options: Omit<UseQueryOptions<RpcResponse<N>, Error>, "queryKey" | "queryFn"> = {},
) {
  return useQuery<RpcResponse<N>, Error>({
    queryKey: rpcKey(name, args),
    queryFn: ({ signal }) => dataSource.call(name, args, { signal }),
    ...options,
  });
}
