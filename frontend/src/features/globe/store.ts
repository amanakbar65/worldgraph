import { create } from "zustand";

import type { PickInfo } from "./GlobeMap";
import { DEFAULT_TOGGLES, type LayerToggles } from "./layers";

/**
 * The globe's own view state. It lives in memory (not the URL) and survives
 * switching to another screen and back during a visit.
 */
interface GlobeUiState {
  toggles: LayerToggles;
  /** The accessible list of events instead of the Top 5 card. */
  listOpen: boolean;
  /** Phones: the Top 5 card is folded to one line. */
  topCollapsed: boolean;
  /** The viewer has moved the globe; it stops turning on its own. */
  interacted: boolean;
  /** The last fly-to request (useNav.focus) the globe acted on. */
  appliedFocus: number | null;
  setToggle: (key: keyof LayerToggles, on: boolean) => void;
  setListOpen: (open: boolean) => void;
  setTopCollapsed: (collapsed: boolean) => void;
  setInteracted: () => void;
  setAppliedFocus: (nonce: number) => void;
}

export const useGlobeUi = create<GlobeUiState>((set) => ({
  toggles: DEFAULT_TOGGLES,
  listOpen: false,
  topCollapsed: false,
  interacted: false,
  appliedFocus: null,
  setToggle: (key, on) => set((s) => ({ toggles: { ...s.toggles, [key]: on } })),
  setListOpen: (listOpen) => set({ listOpen }),
  setTopCollapsed: (topCollapsed) => set({ topCollapsed }),
  setInteracted: () => set({ interacted: true }),
  setAppliedFocus: (appliedFocus) => set({ appliedFocus }),
}));

/**
 * What the pointer is over (desktop). Kept apart from the view's state so a
 * moving pointer re-renders only the hover card, not the whole screen.
 */
export const useGlobeHover = create<{ hover: PickInfo | null; setHover: (hover: PickInfo | null) => void }>(
  (set) => ({
    hover: null,
    setHover: (hover) => set({ hover }),
  }),
);

/** The id of the hovered event or forecast (what the globe rings and links light up). */
export const hoveredItem = (s: { hover: PickInfo | null }): string | null =>
  s.hover && (s.hover.kind === "event" || s.hover.kind === "forecast") ? s.hover.id : null;
