import { create } from "zustand";
import type { z } from "zod";

import { RESPONSES, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, stableJson, type DataSource } from "../source";
import type { SnapshotKind } from "@/lib/snapshot-plan";
import { useSettings, type Settings } from "@/state/settings";

/**
 * The snapshot published alongside the page (`public/snapshot/`, made by
 * `npm run snapshot:live` or `npm run snapshot`). It lets the test link show
 * a first frame before the connector answers, and something when the
 * connector isn't available. Only a few calls are snapshotted.
 *
 * A live snapshot (real news, true dates) may stand in for any viewer. A
 * sample one (invented stories) only for a viewer who switched Sample data
 * on: for everyone else it is as if there were no snapshot at all.
 */
export class StaticSource implements DataSource {
  readonly kind = "static" as const;

  async call<N extends RpcName>(name: N, args: RpcArgs[N]): Promise<RpcResponse<N>> {
    const snapshot = await loadSnapshot();
    if (!snapshotAllowed(snapshot.kind, useSettings.getState().sample)) {
      throw new DataError("offline", "Live data isn't connected.");
    }
    const key = snapshotKey(name, args);
    if (snapshot.invalid.has(key)) throw new DataError("bad_response", "The snapshot is out of date.");
    if (!snapshot.data.has(key)) throw new DataError("offline", "This view needs the live database.");
    return snapshot.data.get(key) as RpcResponse<N>;
  }

  /** Whether this viewer may see the snapshot now (it loaded, and its kind is allowed). */
  async available(): Promise<boolean> {
    const snapshot = await loadSnapshot();
    return snapshot.data.size > 0 && snapshotAllowed(snapshot.kind, useSettings.getState().sample);
  }

  /** Whether the snapshot holds a valid answer to this call. */
  async has<N extends RpcName>(name: N, args: RpcArgs[N]): Promise<boolean> {
    const snapshot = await loadSnapshot();
    return snapshot.data.has(snapshotKey(name, args));
  }
}

/**
 * May a viewer with this Sample data setting see a snapshot of this kind?
 * A live one always (it is real news, labelled as a snapshot with its date);
 * a sample one only with Sample data "on"; no snapshot never.
 */
export function snapshotAllowed(kind: SnapshotKind | null, sample: Settings["sample"]): boolean {
  return kind === "live" || (kind === "sample" && sample === "on");
}

export function snapshotKey(name: string, args: unknown): string {
  return `${name}:${stableJson(args ?? {})}`;
}

export interface Snapshot {
  /** What the manifest says it holds; null when there is no readable snapshot. */
  kind: SnapshotKind | null;
  /** When it was built (ISO), or null. */
  asOf: string | null;
  /** Validated responses keyed by snapshotKey. */
  data: ReadonlyMap<string, unknown>;
  /** Keys whose file is missing or no longer matches the contract. */
  invalid: ReadonlySet<string>;
}

const NOTHING: ReadonlyMap<string, unknown> = new Map();

/**
 * The loaded snapshot as React state, for first frames. `data` stays empty
 * until it loads, and while this viewer may not see it (snapshotAllowed).
 */
export const useSnapshot = create<{
  kind: SnapshotKind | null;
  asOf: string | null;
  data: ReadonlyMap<string, unknown>;
}>(() => ({ kind: null, asOf: null, data: NOTHING }));

let loading: Promise<Snapshot> | null = null;
let loaded: Snapshot | null = null;

function publish(): void {
  if (!loaded) return;
  const allowed = snapshotAllowed(loaded.kind, useSettings.getState().sample);
  useSnapshot.setState({ kind: loaded.kind, asOf: loaded.asOf, data: allowed ? loaded.data : NOTHING });
}

// Switching Sample data on or off shows or hides a sample snapshot at once.
useSettings.subscribe((now, before) => {
  if (now.sample !== before.sample) publish();
});

/** Fetch and validate the whole snapshot once (about 300 KB in 10 files). */
export function loadSnapshot(): Promise<Snapshot> {
  loading ??= readSnapshot().then((snapshot) => {
    loaded = snapshot;
    publish();
    return snapshot;
  });
  return loading;
}

async function readSnapshot(): Promise<Snapshot> {
  const data = new Map<string, unknown>();
  const invalid = new Set<string>();
  const empty: Snapshot = { kind: null, asOf: null, data, invalid };
  const manifest = (await fetchJson("snapshot/manifest.json")) as
    { kind?: unknown; as_of?: unknown; files?: unknown } | undefined;
  if (!manifest || typeof manifest !== "object" || !manifest.files || typeof manifest.files !== "object") {
    return empty;
  }
  // Anything but a live snapshot counts as sample data: it fails closed.
  const kind: SnapshotKind = manifest.kind === "live" ? "live" : "sample";
  const asOfTime = typeof manifest.as_of === "string" ? Date.parse(manifest.as_of) : NaN;
  const asOf = Number.isFinite(asOfTime) ? new Date(asOfTime).toISOString() : null;

  const entries = Object.entries(manifest.files as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  );
  const files = [...new Set(entries.map(([, file]) => file))];
  const bodies = new Map(
    await Promise.all(files.map(async (f) => [f, await fetchJson(`snapshot/${f}`)] as const)),
  );
  const schemas = RESPONSES as Record<string, z.ZodType | undefined>;
  const parsed = new Map<string, unknown>(); // one parse per (function, file)

  for (const [key, file] of entries) {
    const name = key.slice(0, key.indexOf(":"));
    const memo = `${name}|${file}`;
    if (!parsed.has(memo)) {
      const result = schemas[name]?.safeParse(bodies.get(file));
      parsed.set(memo, result?.success ? result.data : undefined);
    }
    const value = parsed.get(memo);
    if (value === undefined) invalid.add(key);
    else data.set(key, value);
  }

  // A sample snapshot is invented: like the database's sample clock, move
  // every time forward by its age, so "last 24 h" still means the last
  // 24 hours. A live one keeps its true dates.
  if (kind === "sample") {
    const meta = data.get(snapshotKey("meta", {})) as { generated_at?: string } | undefined;
    const built = Number.isFinite(asOfTime) ? asOfTime : Date.parse(meta?.generated_at ?? "");
    const age = Number.isFinite(built) ? Date.now() - built : 0;
    if (age > 0) for (const [key, value] of data) data.set(key, shiftTimes(value, age));
  }
  return { kind, asOf, data, invalid };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** A copy of `value` with every ISO date-time string moved `ms` later. */
export function shiftTimes(value: unknown, ms: number): unknown {
  if (typeof value === "string") {
    if (!ISO_TIME.test(value)) return value;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time + ms).toISOString() : value;
  }
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, ms));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftTimes(v, ms)]));
  }
  return value;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export const __testing = {
  reset: () => {
    loading = null;
    loaded = null;
    useSnapshot.setState({ kind: null, asOf: null, data: NOTHING });
  },
};
