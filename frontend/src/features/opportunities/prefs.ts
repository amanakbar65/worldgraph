import { create } from "zustand";

import type { RadarMeasure } from "./radar";

/** How the viewer has set up the Opportunities screen (kept while the app is open). */
export interface OpportunityPrefs {
  /** Rank by fit to the business profile (when there is one). */
  forYou: boolean;
  /** Only the profile's places. */
  placesOnly: boolean;
  /** Which score sets the distance on the radar. */
  measure: RadarMeasure;
  /** The radar as a chart, or as a plain list. */
  radarView: "chart" | "list";
}

export const DEFAULT_PREFS: OpportunityPrefs = {
  forYou: true,
  placesOnly: false,
  measure: "relevance",
  radarView: "chart",
};

export const useOpportunityPrefs = create<OpportunityPrefs & { set: (patch: Partial<OpportunityPrefs>) => void }>(
  (set) => ({ ...DEFAULT_PREFS, set: (patch) => set(patch) }),
);
