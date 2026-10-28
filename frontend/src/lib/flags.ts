/**
 * Feature flags. The database holds them (app_flag, migration 0021) and
 * api.meta sends them as `flags`; a flag the answer doesn't name is off, so
 * the committed snapshot and older databases show none of the flagged
 * features.
 */
import type { MetaResponse } from "@/api/contract";
import { useRpc } from "@/api/client";

export const FLAG_KEYS = [
  "kg.properties", // A1: typed properties on entity pages, property filters in the graph
  "kg.relations", // A2: named relations, connections grouped by relation, relation filters
  "kg.provenance", // A3: sources on every node and link ("Why is this here?")
  "kg.history", // A4: change log and "as of" dates
  "kg.schema_map", // A5: the schema map
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

/** Is this feature on in this meta answer? Missing means off. */
export function flagOn(meta: Pick<MetaResponse, "flags"> | undefined, key: FlagKey): boolean {
  return meta?.flags?.[key] === true;
}

/** Is this feature on? Off until api.meta has answered, and when it doesn't name the flag. */
export function useFlag(key: FlagKey): boolean {
  const meta = useRpc("meta", {});
  return flagOn(meta.data, key);
}
