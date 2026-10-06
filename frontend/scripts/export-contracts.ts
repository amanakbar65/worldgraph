/**
 * Export the API contract (src/api/contract.ts) as JSON Schema files in
 * /contracts, where the Python tests use them to check every SQL function.
 * Run: npm run contracts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { AnalysisItem, RESPONSES } from "../src/api/contract.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts");
mkdirSync(out, { recursive: true });
const schemas: Record<string, z.ZodType> = { ...RESPONSES, analysis_item: AnalysisItem };
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "any" });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(json, null, 2) + "\n");
}
console.log(`Wrote ${Object.keys(schemas).length} schemas to ${out}`);
