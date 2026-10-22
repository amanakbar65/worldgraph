import { create } from "zustand";

/** Transient UI state shared across features. */
export const useUi = create<{
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  /** The logo asked the globe to fly home (and start its slow turn); the globe clears it. */
  homePending: boolean;
  requestHome: () => void;
  clearHome: () => void;
}>((set) => ({
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  moreOpen: false,
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  homePending: false,
  requestHome: () => set({ homePending: true }),
  clearHome: () => set({ homePending: false }),
}));
