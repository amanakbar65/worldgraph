import { create } from "zustand";

/** Transient UI state shared across features. */
export const useUi = create<{
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}>((set) => ({
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  moreOpen: false,
  setMoreOpen: (moreOpen) => set({ moreOpen }),
}));
