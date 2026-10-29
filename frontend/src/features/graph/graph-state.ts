import { create } from "zustand";

import type { EntityType, RelationDirection } from "@/api/contract";

import { defaultFilters, type GraphFilters, type NodeLimit, type PropCondition, type RegionPick } from "./graph-data";

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

/** How the graph screen shows the graph: the drawing, the accessible list, or its schema (kg.schema_map). */
export type GraphMode = "graph" | "list" | "schema";

interface GraphState {
  scope: GraphScope;
  filters: GraphFilters;
  /** A node to centre on and keep lit (from search or "Show in graph"); `nonce` re-centres on repeat. */
  pinned: { id: string; nonce: number } | null;
  /** Drawing, list or schema. */
  mode: GraphMode;
  /** The accessible list instead of the canvas (mode === "list"). */
  listView: boolean;
  /**
   * The link tapped in the drawing or chosen in the list (a VizLink id,
   * "source|target|type"). Its card shows the relation, polarity and
   * confidence; Phase A3 opens "Why is this here?" from it.
   */
  selectedLink: string | null;
  setScope: (scope: GraphScope) => void;
  showAround: (node: { id: string; name: string }, depth?: 1 | 2 | 3) => void;
  setDepth: (depth: 1 | 2 | 3) => void;
  toggleType: (type: EntityType) => void;
  setTypes: (types: EntityType[]) => void;
  addRegion: (region: RegionPick) => void;
  removeRegion: (id: string) => void;
  setAllTime: (allTime: boolean) => void;
  setLimit: (limit: NodeLimit) => void;
  toggleRelation: (key: string) => void;
  setRelations: (keys: string[]) => void;
  setDirection: (direction: RelationDirection) => void;
  /** Set (or with null, clear) one property condition for this type; conditions for another type are dropped. */
  setPropCondition: (type: EntityType, key: string, condition: PropCondition | null) => void;
  clearProps: () => void;
  resetFilters: () => void;
  pin: (id: string | null) => void;
  setMode: (mode: GraphMode) => void;
  setListView: (on: boolean) => void;
  selectLink: (id: string | null) => void;
}

/**
 * The graph screen's own state (filters, scope, pinned node, chosen link).
 * It lives for the visit, so leaving the graph and coming back keeps the
 * view. The time window, sector lens and minimum confidence are shared with
 * the rest of the app (useNav).
 */
export const useGraphState = create<GraphState>((set) => ({
  scope: { kind: "global" },
  filters: defaultFilters(onPhone()),
  pinned: null,
  mode: "graph",
  listView: false,
  selectedLink: null,
  setScope: (scope) =>
    set((s) => ({
      scope,
      selectedLink: null,
      // The direction only means something around one node.
      filters: scope.kind === "global" ? { ...s.filters, direction: "both" } : s.filters,
    })),
  showAround: (node, depth = 2) =>
    set({
      scope: { kind: "local", id: node.id, name: node.name, depth },
      pinned: { id: node.id, nonce: Date.now() },
      selectedLink: null,
    }),
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
  setLimit: (limit) => set((s) => ({ filters: { ...s.filters, limit } })),
  toggleRelation: (key) =>
    set((s) => ({
      filters: {
        ...s.filters,
        relations: s.filters.relations.includes(key)
          ? s.filters.relations.filter((r) => r !== key)
          : [...s.filters.relations, key],
      },
    })),
  setRelations: (relations) => set((s) => ({ filters: { ...s.filters, relations: [...new Set(relations)] } })),
  setDirection: (direction) => set((s) => ({ filters: { ...s.filters, direction } })),
  setPropCondition: (type, key, condition) =>
    set((s) => {
      const byKey = s.filters.props?.type === type ? { ...s.filters.props.byKey } : {};
      if (condition) byKey[key] = condition;
      else delete byKey[key];
      return { filters: { ...s.filters, props: Object.keys(byKey).length ? { type, byKey } : null } };
    }),
  clearProps: () => set((s) => ({ filters: { ...s.filters, props: null } })),
  resetFilters: () => set((s) => ({ filters: { ...defaultFilters(onPhone()), allTime: s.filters.allTime } })),
  pin: (id) => set({ pinned: id ? { id, nonce: Date.now() } : null }),
  setMode: (mode) => set({ mode, listView: mode === "list" }),
  setListView: (on) => set({ mode: on ? "list" : "graph", listView: on }),
  selectLink: (selectedLink) => set({ selectedLink }),
}));
