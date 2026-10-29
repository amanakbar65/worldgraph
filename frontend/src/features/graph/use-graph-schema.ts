import { useMemo } from "react";

import { useRpc } from "@/api/client";
import { useFlag } from "@/lib/flags";

import { relationIndex, type GraphFeatures, type RelationIndex } from "./graph-data";

/** The graph's flagged features (Phase A): off means the graph behaves as it did before. */
export function useGraphFeatures(): GraphFeatures & { schemaMap: boolean } {
  const relations = useFlag("kg.relations");
  const properties = useFlag("kg.properties");
  const schemaMap = useFlag("kg.schema_map");
  return useMemo(() => ({ relations, properties, schemaMap }), [relations, properties, schemaMap]);
}

/** api.schema: node types with their properties and counts, and the named relations. Changes rarely. */
export function useSchema(enabled = true) {
  return useRpc("schema", {}, { enabled, staleTime: 10 * 60_000, refetchInterval: false, retry: 1 });
}

/**
 * Relation words for link labels: the schema's when kg.relations is on (the
 * built-in copy until it answers), none when off (labels as before).
 */
export function useRelationIndex(on: boolean): RelationIndex | null {
  const schema = useSchema(on);
  const relations = schema.data?.relations;
  return useMemo(() => (on ? relationIndex(relations) : null), [on, relations]);
}
