import { create } from "zustand";
import type { z } from "zod";

import { RESPONSES, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, stableJson, type DataSource } from "../source";

/**
 * A snapshot of sample data published alongside the page
 * (`public/snapshot/`, made by `npm run snapshot`). It lets the Artifact show
 * a complete first frame before the connector answers, and a working sample
 * view when the connector isn't available. Only a few calls are snapshotted.
 */
export class StaticSource implements DataSource {
  readonly kind = "static" as const;

  async call<N extends RpcName>(name: N, args: RpcArgs[N]): Promise<RpcResponse<N>> {
    const snapshot = await loadSnapshot();
    const key = snapshotKey(name, args);
    if (snapshot.invalid.has(key)) throw new DataError("bad_response", "The sample snapshot is out of date.");
    if (!snapshot.data.has(key)) throw new DataError("offline", "This view needs the live database.");
    return snapshot.data.get(key) as RpcResponse<N>;
  }
}

export function snapshotKey(name: string, args: unknown): string {
  return `${name}:${stableJson(args ?? {})}`;
}

export interface Snapshot {
  /** Validated responses keyed by snapshotKey. */
  data: ReadonlyMap<string, unknown>;
  /** Keys whose file is missing or no longer matches the contract. */
  invalid: ReadonlySet<string>;
}

/** The loaded snapshot as React state (empty until loadSnapshot finishes). */
export const useSnapshot = create<{ data: ReadonlyMap<string, unknown> }>(() => ({ data: new Map() }));

let loading: Promise<Snapshot> | null = null;

/** Fetch and validate the whole snapshot once (about 300 KB in 10 files). */
export function loadSnapshot(): Promise<Snapshot> {
  loading ??= readSnapshot().then((snapshot) => {
    useSnapshot.setState({ data: snapshot.data });
    return snapshot;
  });
  return loading;
}

async function readSnapshot(): Promise<Snapshot> {
  const data = new Map<string, unknown>();
  const invalid = new Set<string>();
  const manifest = await fetchJson("snapshot/manifest.json");
  if (!manifest || typeof manifest !== "object") return { data, invalid };

  const entries = Object.entries(manifest as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  );
  const files = [...new Set(entries.map(([, file]) => file))];
  const bodies = new Map(await Promise.all(files.map(async (f) => [f, await fetchJson(`snapshot/${f}`)] as const)));
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
  return { data, invalid };
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export const __testing = { reset: () => ((loading = null), useSnapshot.setState({ data: new Map() })) };
