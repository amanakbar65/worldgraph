import { create } from "zustand";

import type { EntityType } from "@/api/contract";

import { defaultFilters, type GraphFilters, type NodeLimit, type RegionPick } from "./graph-data";

/** Phones (below the 768 px desktop layout) start with fewer items. */
function onPhone(): boolean {
  try {
    return !window.matchMedia("(min-width: 768px)").matches;
  } catch {
    return false;
  }
}

/** Whole graph, or the neighbourhood of one node. */
export type GraphScope = { kind: "global" } | { kind: "local"; id: string; name: string; depth: 1 | 2 | 3 };

interface GraphState {
  scope: GraphScope;
  filters: GraphFilters;
  /** A node to centre on and keep lit (from search or "Show in graph"); `nonce` re-centres on repeat. */
  pinned: { id: string; nonce: number } | null;
  /** The accessible list instead of the canvas. */
  listView: boolean;
  setScope: (scope: GraphScope) => void;
  showAround: (node: { id: string; name: string }, depth?: 1 | 2 | 3) => void;
  setDepth: (depth: 1 | 2 | 3) => void;
  toggleType: (type: EntityType) => void;
  setTypes: (types: EntityType[]) => void;
  addRegion: (region: RegionPick) => void;
  removeRegion: (id: string) => void;
  setAllTime: (allTime: boolean) => void;
  setMinConfidence: (value: number) => void;
  setLimit: (limit: NodeLimit) => void;
  resetFilters: () => void;
  pin: (id: string | null) => void;
  setListView: (on: boolean) => void;
}

/**
 * The graph screen's own state (filters, scope, pinned node). It lives for
 * the visit, so leaving the graph and coming back keeps the view. The time
 * window and sector lens are shared with the rest of the app (useNav).
 */
export const useGraphState = create<GraphState>((set) => ({
  scope: { kind: "global" },
  filters: defaultFilters(onPhone()),
  pinned: null,
  listView: false,
  setScope: (scope) => set({ scope }),
  showAround: (node, depth = 2) =>
    set({ scope: { kind: "local", id: node.id, name: node.name, depth }, pinned: { id: node.id, nonce: Date.now() } }),
  setDepth: (depth) => set((s) => (s.scope.kind === "local" ? { scope: { ...s.scope, depth } } : s)),
  toggleType: (type) =>
    set((s) => ({
      filters: {
        ...s.filters,
        types: s.filters.types.includes(type) ? s.filters.types.filter((t) => t !== type) : [...s.filters.types, type],
      },
    })),
  setTypes: (types) => set((s) => ({ filters: { ...s.filters, types } })),
  addRegion: (region) =>
    set((s) =>
      s.filters.regions.some((r) => r.id === region.id)
        ? s
        : { filters: { ...s.filters, regions: [...s.filters.regions, region].slice(-5) } },
    ),
  removeRegion: (id) => set((s) => ({ filters: { ...s.filters, regions: s.filters.regions.filter((r) => r.id !== id) } })),
  setAllTime: (allTime) => set((s) => ({ filters: { ...s.filters, allTime } })),
  setMinConfidence: (minConfidence) => set((s) => ({ filters: { ...s.filters, minConfidence } })),
  setLimit: (limit) => set((s) => ({ filters: { ...s.filters, limit } })),
  resetFilters: () => set((s) => ({ filters: { ...defaultFilters(onPhone()), allTime: s.filters.allTime } })),
  pin: (id) => set({ pinned: id ? { id, nonce: Date.now() } : null }),
  setListView: (listView) => set({ listView }),
}));
