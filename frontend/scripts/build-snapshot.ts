/**
 * Build the sample snapshot the test link ships with (public/snapshot/).
 *
 *   DEV_DATABASE_URL=postgresql://wg:wg@localhost:5432/<db> npm run snapshot
 *
 * Calls the api functions for the first frame (meta; globe and top for each
 * window; brief; forecasts) with sample data, and writes one JSON file per
 * call plus manifest.json, keyed the way StaticSource looks them up. The
 * sample clock is moved to "now" first, so the snapshot's stories are recent.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { snapshotManifest, snapshotPlan } from "../src/lib/snapshot-plan.ts";

const url = process.env.DEV_DATABASE_URL;
if (!url) {
  console.error("Set DEV_DATABASE_URL to a database with the sample data loaded (uv run wg seed load).");
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "snapshot");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("set search_path to public, extensions");
  await client.query("select api.refresh_sample_clock()");

  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) if (name.endsWith(".json")) rmSync(join(out, name));

  const plan = snapshotPlan();
  let bytes = 0;
  for (const entry of plan) {
    const { rows } = await client.query<{ data: unknown }>(`select api.${entry.name}($1::jsonb) as data`, [
      JSON.stringify(entry.query),
    ]);
    const text = JSON.stringify(rows[0]?.data ?? null);
    writeFileSync(join(out, entry.file), text + "\n");
    bytes += text.length + 1;
    console.log(`  ${entry.file.padEnd(18)} ${(text.length / 1024).toFixed(1).padStart(7)} KB`);
  }
  const manifest = snapshotManifest(plan);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(
    `Wrote ${plan.length} files (${(bytes / 1024).toFixed(0)} KB) and ${Object.keys(manifest).length} manifest keys to ${out}`,
  );
} finally {
  await client.end();
}
