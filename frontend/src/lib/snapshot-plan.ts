/**
 * Which api calls the bundled snapshot holds (public/snapshot/, made by
 * `npm run snapshot` or `npm run snapshot:live`), and under which keys
 * StaticSource finds them.
 *
 * The snapshot gives the test link a first frame while the Supabase
 * connector starts, and something to show when it isn't available. It is
 * one of two kinds (manifest.json says which):
 * - "live": real stories read from the website (sample: false), kept at
 *   their true dates. Any viewer may see it, labelled as a snapshot.
 * - "sample": invented stories from a local sample database, moved to "now"
 *   when loaded. Only a viewer who switched Sample data on sees it.
 *
 * StaticSource looks a call up by snapshotKey(name, args) with the args
 * exactly as a screen sends them, so each file is listed under every
 * argument shape the first frame can use (sector lens off as [] or left out,
 * and each Sample data setting the snapshot may answer).
 *
 * Imported by scripts/build-snapshot.ts under plain Node, so it uses only
 * relative imports with extensions.
 */
import { stableJson } from "../api/source.ts";

type Args = Record<string, unknown>;

export type SnapshotKind = "live" | "sample";

export interface SnapshotEntry {
  /** api function name */
  name: string;
  /** File under public/snapshot/ */
  file: string;
  /** What the builder sends (sample: true for a sample snapshot, false for a live one). */
  query: Args;
  /** Every argument shape the app may send for this frame. */
  variants: Args[];
}

/** public/snapshot/manifest.json */
export interface SnapshotManifest {
  kind: SnapshotKind;
  /** When the snapshot was built (ISO date-time). */
  as_of: string;
  /** snapshotKey → file */
  files: Record<string, string>;
}

export const SNAPSHOT_WINDOWS = ["24h", "7d", "30d"] as const;

/** Same as snapshotKey() in src/api/sources/static.ts (checked by a test). */
export function snapshotKeyOf(name: string, args: unknown): string {
  return `${name}:${stableJson(args ?? {})}`;
}

/** All combinations of optional keys: each option is either absent or one of its values. */
function combos(options: Record<string, unknown[]>): Args[] {
  let out: Args[] = [{}];
  for (const [key, values] of Object.entries(options)) {
    const next: Args[] = [];
    for (const base of out) {
      next.push(base);
      for (const value of values) next.push({ ...base, [key]: value });
    }
    out = next;
  }
  return out;
}

/**
 * The `sample` values each kind is listed under, besides none. The app sends
 * none for Auto, false for Off and true for On. A live snapshot answers all
 * three. A sample one never answers Off, and StaticSource shows it only to a
 * viewer with Sample data On (snapshotAllowed).
 */
const SAMPLE_VALUES: Record<SnapshotKind, boolean[]> = { live: [false, true], sample: [true] };

/** The first frame of every screen that can work from a snapshot alone. */
export function snapshotPlan(kind: SnapshotKind = "sample"): SnapshotEntry[] {
  const sample = SAMPLE_VALUES[kind];
  const query = { sample: kind === "sample" };
  const entries: SnapshotEntry[] = [{ name: "meta", file: "meta.json", query: {}, variants: [{}] }];
  for (const window of SNAPSHOT_WINDOWS) {
    for (const name of ["globe", "top"]) {
      entries.push({
        name,
        file: `${name}-${window}.json`,
        query: { window, ...query },
        variants: combos({ sectors: [[]], sample }).map((v) => ({ window, ...v })),
      });
    }
  }
  entries.push({ name: "brief", file: "brief.json", query, variants: combos({ sample }) });
  entries.push({
    name: "forecasts",
    file: "forecasts.json",
    query,
    variants: combos({
      sectors: [[]],
      regions: [[]],
      categories: [[]],
      sort: ["relevance"],
      include_thin: [false],
      sample,
    }),
  });
  return entries;
}

/** key → file, for every argument shape in the plan. */
export function snapshotManifest(entries: SnapshotEntry[] = snapshotPlan()): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of entries) {
    for (const variant of entry.variants) files[snapshotKeyOf(entry.name, variant)] = entry.file;
  }
  return files;
}

/** manifest.json for a snapshot of this kind built at `asOf`. */
export function manifestFile(kind: SnapshotKind, asOf: string): SnapshotManifest {
  return { kind, as_of: asOf, files: snapshotManifest(snapshotPlan(kind)) };
}

/** Forecast providers that never involve real money, so any viewer may see them. */
const NOT_REAL_MONEY: ReadonlySet<string> = new Set(["manifold", "metaculus", "sample"]);

/**
 * What would make a live snapshot unfit to ship, by file: invented items (it
 * must be real news only), and forecasts from a provider that may be
 * real-money (the website shows those by the viewer's country; a snapshot
 * can't tell, so it fails closed). Empty when it's fine.
 */
export function liveSnapshotProblems(answers: Record<string, unknown>): string[] {
  const problems = new Set<string>();
  const walk = (value: unknown, file: string): void => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v, file);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (item.is_sample === true) problems.add(`${file}: holds sample data`);
    if (typeof item.provider === "string" && !NOT_REAL_MONEY.has(item.provider)) {
      problems.add(`${file}: forecasts from ${item.provider}, which may be real-money`);
    }
    for (const v of Object.values(item)) walk(v, file);
  };
  for (const [file, answer] of Object.entries(answers)) walk(answer, file);
  return [...problems];
}
