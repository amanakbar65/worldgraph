/**
 * Turn dist-artifact/ (from `vite build --mode artifact`) into what the
 * Artifact tool publishes as the claude.ai test link:
 *
 * - dist-artifact/index.html          the page (a normal HTML page, relative asset paths)
 * - dist-artifact/artifact-files.json every other file with its published path, for `files`
 * - dist-artifact/ARTIFACT.md         the capabilities the page needs, and how to publish
 *
 * It also checks the platform's limits (the page and each text file ≤ 16 MB,
 * each binary file ≤ 15 MB, ≤ 255 files per publish), keeps the whole test
 * link under 16 MB, and fails on anything the sandbox can't load (absolute
 * asset paths, external scripts, stylesheets or fonts).
 *
 * Run by `npm run build:artifact`.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(frontend, "dist-artifact");
const MB = 1024 * 1024;
const LIMITS = { total: 16 * MB, text: 16 * MB, binary: 15 * MB, files: 255 };
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".md", ".map"]);
const GENERATED = new Set(["index.html", "artifact-files.json", "ARTIFACT.md"]);

/** What the page asks the claude.ai runtime for (the publish step's `capabilities`). */
export const CAPABILITIES = {
  mcp: { servers: [{ server: "Supabase", tools: ["execute_sql"] }] },
  sample: {},
  db: { rules: [{ path: "data/users/{self}", write: "interact" }] },
  user: {},
};

const problems = [];
const fail = (message) => problems.push(message);

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist-artifact/index.html is missing. Run `vite build --mode artifact` first.");
  process.exit(1);
}

// --- The page --------------------------------------------------------------
let html = readFileSync(join(dist, "index.html"), "utf8");
// Asset paths must be relative: the page is served from the artifact's own folder.
html = html.replace(/(\s(?:src|href)=["'])\/(assets|geo|snapshot)\//g, "$1./$2/");
for (const match of html.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)) {
  const ref = match[1];
  if (/^(https?:)?\/\//i.test(ref)) fail(`index.html loads an external file: ${ref}`);
  else if (ref.startsWith("/")) fail(`index.html uses an absolute path: ${ref}`);
}
writeFileSync(join(dist, "index.html"), html);

// --- Every other file ------------------------------------------------------
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const published = walk(dist)
  .map((full) => ({ full, path: relative(dist, full).split(sep).join("/") }))
  .filter(({ path }) => !GENERATED.has(path))
  .sort((a, b) => a.path.localeCompare(b.path));

const sizes = {};
let total = statSync(join(dist, "index.html")).size;
for (const { full, path } of published) {
  const size = statSync(full).size;
  sizes[path] = size;
  total += size;
  const text = TEXT.has(extname(path).toLowerCase());
  if (size > (text ? LIMITS.text : LIMITS.binary)) {
    fail(`${path} is ${(size / MB).toFixed(1)} MB (limit ${text ? 16 : 15} MB)`);
  }
  if (extname(path) === ".css") {
    const css = readFileSync(full, "utf8");
    for (const m of css.matchAll(/url\(\s*["']?(https?:)?\/\/[^)]+\)/gi)) fail(`${path} loads ${m[0]}`);
    for (const m of css.matchAll(/@import\s+(url\()?["']?https?:/gi)) fail(`${path} imports ${m[0]}`);
  }
}
if (published.length + 1 > LIMITS.files)
  fail(`${published.length + 1} files (one publish takes at most 255)`);
if (total > LIMITS.total) fail(`The test link is ${(total / MB).toFixed(2)} MB (keep it under 16 MB)`);

// --- Manifest for the publish step -----------------------------------------
const files = Object.fromEntries(published.map(({ path }) => [path, path]));
const manifest = {
  generated_at: new Date().toISOString(),
  root: "frontend/dist-artifact",
  page: "index.html",
  files,
  sizes: { "index.html": statSync(join(dist, "index.html")).size, ...sizes },
  total_bytes: total,
  capabilities: CAPABILITIES,
};
writeFileSync(join(dist, "artifact-files.json"), JSON.stringify(manifest, null, 2) + "\n");

// --- ARTIFACT.md -----------------------------------------------------------
const fmt = (n) => (n >= MB ? `${(n / MB).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const groups = {};
for (const [path, size] of Object.entries(manifest.sizes)) {
  const group = path.includes("/") ? path.split("/")[0] + "/" : path;
  groups[group] = groups[group] ?? { count: 0, bytes: 0 };
  groups[group].count += 1;
  groups[group].bytes += size;
}
const largest = Object.entries(manifest.sizes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);

const doc = `# WorldGraph test link (claude.ai Artifact)

Built ${manifest.generated_at} by \`npm run build:artifact\`. Total ${fmt(total)} in ${published.length + 1} files.

## Capabilities the page needs

\`\`\`json
${JSON.stringify(CAPABILITIES, null, 2)}
\`\`\`

- **mcp**: the viewer's **Supabase** connector, tool \`execute_sql\` only. The page runs
  \`select api.<fn>($json$...$json$::jsonb)\` against project \`xmznnjpflimsjvwftxpa\`
  (read functions, plus \`api.save_analysis\` for on-use analysis). The connector wraps rows in
  \`<untrusted-data-…>\` tags; \`src/api/sql.ts\` unwraps them. Without the connector the page
  shows the bundled sample snapshot (\`snapshot/\`).
- **sample**: Claude on the viewer's own account, text only (no images). Used for story
  analysis while the owner or an editor has the page open, for Ask and for projections.
  The first call asks the viewer to allow it.
- **db**: each viewer's own private subtree \`data/users/{self}\` (business profile,
  watchlist, notes), writable at Contributor level and above. No shared documents.
- **user**: the viewer's id (for the private subtree) and whether they are the owner or an
  editor (only they run on-use analysis).

## Publish

Load the \`artifact-capabilities\` skill first. Then publish with the Artifact tool:

- \`file_path\`: \`frontend/dist-artifact/index.html\`
- \`root\`: \`frontend/dist-artifact\`
- \`files\`: the \`files\` map in \`artifact-files.json\` (published path → source path under \`root\`)
- \`capabilities\`: the JSON above
- \`icon\`: \`globe\`

To update the same link later, publish again with its \`url\`.

## Sizes

| Folder | Files | Size |
| --- | ---: | ---: |
${Object.entries(groups)
  .map(([g, v]) => `| \`${g}\` | ${v.count} | ${fmt(v.bytes)} |`)
  .join("\n")}
| **Total** | **${published.length + 1}** | **${fmt(total)}** |

Largest files:

${largest.map(([p, s]) => `- \`${p}\`: ${fmt(s)}`).join("\n")}
`;
writeFileSync(join(dist, "ARTIFACT.md"), doc);

// --- Report ----------------------------------------------------------------
for (const [g, v] of Object.entries(groups)) {
  console.log(`  ${g.padEnd(22)} ${String(v.count).padStart(4)} files  ${fmt(v.bytes).padStart(10)}`);
}
console.log(
  `  ${"total".padEnd(22)} ${String(published.length + 1).padStart(4)} files  ${fmt(total).padStart(10)}`,
);
if (problems.length) {
  console.error("\nThe test link can't be published as is:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Wrote dist-artifact/artifact-files.json and dist-artifact/ARTIFACT.md");
