import { create } from "zustand";

import type { ForecastCategory } from "@/api/contract";

import { DEFAULT_FILTERS, MAX_REGIONS, type ForecastFilters, type ForecastSort, type RegionFilter } from "./forecast-data";

interface FilterStore extends ForecastFilters {
  toggleCategory: (category: ForecastCategory) => void;
  clearCategories: () => void;
  addRegion: (region: RegionFilter) => void;
  removeRegion: (id: string) => void;
  setIncludeThin: (includeThin: boolean) => void;
  setSort: (sort: ForecastSort) => void;
  /** Clear the categories and places (keeps the sort and the thin-market choice). */
  clearFilters: () => void;
}

/**
 * The forecasts view's filters. They live outside the screen so they
 * survive a trip to another screen and back during this visit. The sector
 * lens is shared with the globe, so it stays in the navigation store.
 */
export const useForecastFilters = create<FilterStore>((set) => ({
  ...DEFAULT_FILTERS,
  toggleCategory: (category) =>
    set((s) => ({
      categories: s.categories.includes(category)
        ? s.categories.filter((c) => c !== category)
        : [...s.categories, category],
    })),
  clearCategories: () => set({ categories: [] }),
  addRegion: (region) =>
    set((s) =>
      s.regions.some((r) => r.id === region.id) ? s : { regions: [...s.regions, region].slice(-MAX_REGIONS) },
    ),
  removeRegion: (id) => set((s) => ({ regions: s.regions.filter((r) => r.id !== id) })),
  setIncludeThin: (includeThin) => set({ includeThin }),
  setSort: (sort) => set({ sort }),
  clearFilters: () => set({ categories: [], regions: [] }),
}));

/** Just the filter values (for building arguments). */
export function filtersOf(s: ForecastFilters): ForecastFilters {
  return { categories: s.categories, regions: s.regions, includeThin: s.includeThin, sort: s.sort };
}
