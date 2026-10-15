/**
 * Names for the ids in the profile and watchlist. The profile stores ids
 * only, so names come from what this visit has already seen (search picks,
 * the feed's matches, entity pages) and, for the rest, from api.entity
 * (the same cached call the entity panel makes).
 */
import { useEffect } from "react";
import { create } from "zustand";

import { useRpc } from "@/api/client";
import type { EntityType } from "@/api/contract";
import { sectorLabel } from "@/lib/icons";

import { sectorOfNode, typeOfId } from "./business-data";

export interface KnownName {
  name: string;
  type: EntityType;
}

export const useKnownNames = create<{
  names: Record<string, KnownName>;
  remember: (refs: readonly { id: string; name: string; type: EntityType }[]) => void;
}>((set) => ({
  names: {},
  remember: (refs) =>
    set((s) => {
      let changed = false;
      const names = { ...s.names };
      for (const r of refs) {
        if (names[r.id]?.name === r.name) continue;
        names[r.id] = { name: r.name, type: r.type };
        changed = true;
      }
      return changed ? { names } : s;
    }),
}));

export interface EntityName {
  name: string;
  type: EntityType;
  /** Still looking it up. */
  loading: boolean;
  /** The id no longer exists (removed or merged). */
  missing: boolean;
}

/** "commodity:crude-oil" → "Crude oil": a readable stand-in while the real name loads. */
export function nameFromId(id: string): string {
  const slug =
    id
      .slice(id.indexOf(":") + 1)
      .split(".")
      .pop() ?? id;
  const words = slug.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The name and type for an id, looked up when this visit hasn't seen it yet. */
export function useEntityName(id: string): EntityName {
  const known = useKnownNames((s) => s.names[id]);
  const remember = useKnownNames((s) => s.remember);
  const sector = sectorOfNode(id);
  const lookup = !known && !sector && !id.startsWith("forecast:");
  const query = useRpc("entity", { id }, { enabled: lookup, staleTime: 10 * 60_000, refetchInterval: false });
  const entity = query.data?.entity;

  useEffect(() => {
    if (lookup && entity && entity.id === id) remember([{ id, name: entity.name, type: entity.type }]);
  }, [lookup, entity, id, remember]);

  if (sector) return { name: sectorLabel(sector), type: "sector", loading: false, missing: false };
  if (known) return { ...known, loading: false, missing: false };
  const type = typeOfId(id) ?? "region";
  if (entity && entity.id === id)
    return { name: entity.name, type: entity.type, loading: false, missing: false };
  const missing = !!query.error && /^not found/i.test(query.error.message);
  return { name: nameFromId(id), type, loading: lookup && !query.error, missing };
}
