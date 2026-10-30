/**
 * Plan a republish of the claude.ai test link without listing what is already there.
 *
 * Reads dist-artifact/artifact-files.json (this build) and
 * scripts/artifact-published.json (the paths the last publish left on the link),
 * and writes dist-artifact/publish-plan.json: the `files` maps for one or more
 * Artifact publishes, at most 255 entries each. The first carries this build plus
 * as many removals (null) of last build's leftovers as fit; the rest only removals.
 * Hashed asset names change on every build, so without the removals the link would
 * pass the 511-files-per-version cap after a few republishes.
 *
 *   node scripts/artifact-publish-plan.mjs           print the plan (one JSON map per line)
 *   node scripts/artifact-publish-plan.mjs --record  after publishing: remember this build's paths
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const filesPath = join(frontend, "dist-artifact", "artifact-files.json");
const publishedPath = join(frontend, "scripts", "artifact-published.json");
const PER_PUBLISH = 255;

const built = JSON.parse(readFileSync(filesPath, "utf8"));
const current = built.files ?? built;
const paths = Object.keys(current).sort();

if (process.argv.includes("--record")) {
  writeFileSync(publishedPath, `${JSON.stringify(paths, null, 2)}\n`);
  console.log(`Recorded ${paths.length} published paths in scripts/artifact-published.json`);
  process.exit(0);
}

const previous = existsSync(publishedPath) ? JSON.parse(readFileSync(publishedPath, "utf8")) : [];
const removals = previous.filter((p) => !(p in current));
const plans = [{ ...current }];
for (const p of removals) {
  let last = plans[plans.length - 1];
  if (Object.keys(last).length >= PER_PUBLISH) plans.push((last = {}));
  last[p] = null;
}

writeFileSync(join(frontend, "dist-artifact", "publish-plan.json"), `${JSON.stringify(plans)}\n`);
console.error(`${paths.length} files, ${removals.length} removals, ${plans.length} publish(es)`);
for (const plan of plans) console.log(JSON.stringify(plan));
