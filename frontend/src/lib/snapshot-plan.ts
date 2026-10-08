/**
 * Which api calls the bundled snapshot holds (public/snapshot/, made by
 * `npm run snapshot`), and under which keys StaticSource finds them.
 *
 * The snapshot gives the test link a complete first frame of sample data
 * when the Supabase connector isn't available. StaticSource looks a call up
 * by snapshotKey(name, args) with the args exactly as a screen sends them,
 * so each file is listed under every argument shape the first frame can use
 * (sector lens off as [] or left out; sample "auto" (left out) or "on").
 *
 * Imported by scripts/build-snapshot.ts under plain Node, so it uses only
 * relative imports with extensions.
 */
import { stableJson } from "../api/source.ts";

type Args = Record<string, unknown>;

export interface SnapshotEntry {
  /** api function name */
  name: string;
  /** File under public/snapshot/ */
  file: string;
  /** What the snapshot builder sends to the database (always sample: true). */
  query: Args;
  /** Every argument shape the app may send for this frame. */
  variants: Args[];
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

/** The first frame of every screen that can work from sample data alone. */
export function snapshotPlan(): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [{ name: "meta", file: "meta.json", query: {}, variants: [{}] }];
  for (const window of SNAPSHOT_WINDOWS) {
    for (const name of ["globe", "top"]) {
      entries.push({
        name,
        file: `${name}-${window}.json`,
        query: { window, sample: true },
        variants: combos({ sectors: [[]], sample: [true] }).map((v) => ({ window, ...v })),
      });
    }
  }
  entries.push({
    name: "brief",
    file: "brief.json",
    query: { sample: true },
    variants: combos({ sample: [true] }),
  });
  entries.push({
    name: "forecasts",
    file: "forecasts.json",
    query: { sample: true },
    variants: combos({
      sectors: [[]],
      regions: [[]],
      categories: [[]],
      sort: ["relevance"],
      include_thin: [false],
      sample: [true],
    }),
  });
  return entries;
}

/** manifest.json: key → file. */
export function snapshotManifest(entries: SnapshotEntry[] = snapshotPlan()): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const entry of entries) {
    for (const variant of entry.variants) manifest[snapshotKeyOf(entry.name, variant)] = entry.file;
  }
  return manifest;
}
