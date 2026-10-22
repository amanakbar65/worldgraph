/**
 * Build the snapshot the test link ships with (public/snapshot/).
 *
 *   npm run snapshot:live -- https://<website>     live: real news from the website
 *   DEV_DATABASE_URL=postgresql://… npm run snapshot   sample: from a local sample database
 *
 * Calls the api functions for the first frame (meta; globe and top for each
 * window; brief; forecasts; see src/lib/snapshot-plan.ts) and writes one
 * JSON file per call plus manifest.json ({kind, as_of, files}), keyed the
 * way StaticSource looks them up.
 *
 * Live: POSTs each call to <website>/api/rpc with sample: false, exactly as
 * the website does, and refuses to write a snapshot holding sample data or
 * possibly real-money forecasts. It never touches the sample clock. The
 * stories keep their true dates.
 *
 * Sample: moves the database's sample clock to "now" first, so the stories
 * are recent; the app moves them on again by the snapshot's age.
 *
 * Add `--out <dir>` to write somewhere else (to check a build first).
 * Nothing is written unless every call succeeded.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { RESPONSES, type RpcName } from "../src/api/contract.ts";
import {
  liveSnapshotProblems,
  manifestFile,
  snapshotPlan,
  type SnapshotKind,
} from "../src/lib/snapshot-plan.ts";

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const outFlag = argv.indexOf("--out");
const out =
  outFlag >= 0 && argv[outFlag + 1]
    ? resolve(argv[outFlag + 1])
    : join(dirname(fileURLToPath(import.meta.url)), "..", "public", "snapshot");
const website = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One answer per plan file. */
type Answers = Record<string, unknown>;

/** POST {fn, args} to the website's /api/rpc, as src/api/sources/http.ts does (a few tries while it wakes up). */
async function callWebsite(endpoint: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 5_000));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fn, args }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      last = `couldn't reach ${endpoint} (${(error as Error).message})`;
      continue;
    }
    const body = (await response.json().catch(() => null)) as { data?: unknown; error?: string } | null;
    if (response.ok && body && !body.error) return body.data ?? null;
    last = `${response.status} ${body?.error ?? response.statusText}`;
    // Only the database or the host not answering (502–504) is worth another try.
    if (response.status <= 500) break;
  }
  return fail(`${fn}: ${last}`);
}

async function readWebsite(url: string): Promise<Answers> {
  if (!/^https?:\/\/[^/]/.test(url)) fail("Give the website's address, e.g. https://worldgraph.example.");
  const endpoint = `${url.replace(/\/+$/, "")}/api/rpc`;
  console.log(`Reading live data from ${endpoint}`);
  const answers: Answers = {};
  for (const entry of snapshotPlan("live")) {
    const data = await callWebsite(endpoint, entry.name, entry.query);
    const parsed = RESPONSES[entry.name as RpcName].safeParse(data);
    if (!parsed.success)
      fail(`${entry.name}: the answer doesn't match this app's contract (is the website up to date?)`);
    answers[entry.file] = data;
  }
  // The country the website saw is this machine's, not the viewer's: leave it out.
  const meta = answers["meta.json"] as Record<string, unknown> & { data: { live_stories: number } };
  delete meta.viewer_country;
  if (meta.data.live_stories === 0) fail("The website has no live stories yet; nothing to snapshot.");
  const problems = liveSnapshotProblems(answers);
  if (problems.length) fail(`Not writing a live snapshot:\n  ${problems.join("\n  ")}`);
  return answers;
}

async function readSampleDatabase(): Promise<Answers> {
  const url = process.env.DEV_DATABASE_URL;
  if (!url) fail("Set DEV_DATABASE_URL to a database with the sample data loaded (uv run wg seed load).");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("set search_path to public, extensions");
    await client.query("select api.refresh_sample_clock()");
    const answers: Answers = {};
    for (const entry of snapshotPlan("sample")) {
      const { rows } = await client.query<{ data: unknown }>(`select api.${entry.name}($1::jsonb) as data`, [
        JSON.stringify(entry.query),
      ]);
      answers[entry.file] = rows[0]?.data ?? null;
    }
    return answers;
  } finally {
    await client.end();
  }
}

function write(kind: SnapshotKind, answers: Answers, asOf: string): void {
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) if (name.endsWith(".json")) rmSync(join(out, name));
  let bytes = 0;
  for (const [file, data] of Object.entries(answers)) {
    const text = JSON.stringify(data);
    writeFileSync(join(out, file), text + "\n");
    bytes += text.length + 1;
    console.log(`  ${file.padEnd(18)} ${(text.length / 1024).toFixed(1).padStart(7)} KB`);
  }
  const manifest = manifestFile(kind, asOf);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(
    `Wrote a ${kind} snapshot as of ${asOf}: ${Object.keys(answers).length} files ` +
      `(${(bytes / 1024).toFixed(0)} KB) and ${Object.keys(manifest.files).length} keys, to ${out}`,
  );
}

const asOf = new Date().toISOString();
if (live) {
  if (!website) fail("Usage: npm run snapshot:live -- https://<website> [--out <dir>]");
  write("live", await readWebsite(website), asOf);
} else {
  write("sample", await readSampleDatabase(), asOf);
}
