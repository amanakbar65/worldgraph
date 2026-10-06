import type { RpcArgs, RpcName, RpcResponse } from "./contract";

/** Why a call failed, in terms the UI can act on. */
export type DataErrorKind =
  | "connector_missing" // the Supabase connector isn't added in claude.ai
  | "connector_reauth" // the connector needs reconnecting
  | "not_allowed" // the viewer declined the connector for this page
  | "unavailable" // the database or network is down, or asleep
  | "bad_response" // the answer didn't match the contract
  | "server_error" // the SQL function raised an error
  | "offline"; // no data source in this view at all

export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly retryable: boolean;
  constructor(kind: DataErrorKind, message: string, retryable = false) {
    super(message);
    this.name = "DataError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Skip any cache and ask the database now (after a write). */
  fresh?: boolean;
}

/** One way of reaching the `api.*` functions. */
export interface DataSource {
  readonly kind: "connector" | "http" | "static";
  call<N extends RpcName>(name: N, args: RpcArgs[N], options?: CallOptions): Promise<RpcResponse<N>>;
}

/** Stable JSON (sorted keys) so equal arguments give equal cache keys. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}
