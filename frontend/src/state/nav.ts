import { create } from "zustand";

import type { SectorId, TimeWindow } from "@/api/contract";

/** Top-level screens. */
export const VIEWS = ["globe", "graph", "forecasts", "opportunities", "business", "brief"] as const;
export type View = (typeof VIEWS)[number];

/** Things that open on top of a screen: side panel on desktop, bottom sheet on mobile. */
export type Panel =
  | { kind: "region"; id: string }
  | { kind: "story"; id: string }
  | { kind: "cascade"; id: string } // opens full width
  | { kind: "entity"; id: string }
  | { kind: "forecast"; id: string }
  | { kind: "compare"; ids: string[] }
  | { kind: "ask"; q?: string; scope?: string }
  | { kind: "settings" };

interface NavState {
  view: View;
  /** Panel history; the last one is shown. Back pops it. */
  panels: Panel[];
  window: TimeWindow;
  sectors: SectorId[]; // empty = all sectors (lens off)
  /** A camera request for the globe: fly to this region or point. */
  focus: { regionId?: string; lon?: number; lat?: number; zoom?: number; nonce: number } | null;
  setView: (view: View) => void;
  open: (panel: Panel) => void;
  replace: (panel: Panel) => void;
  back: () => void;
  closePanels: () => void;
  setWindow: (window: TimeWindow) => void;
  toggleSector: (sector: SectorId) => void;
  clearSectors: () => void;
  flyTo: (focus: Omit<NonNullable<NavState["focus"]>, "nonce">) => void;
}

const samePanel = (a: Panel, b: Panel) => JSON.stringify(a) === JSON.stringify(b);

export const useNav = create<NavState>((set) => ({
  view: "globe",
  panels: [],
  window: "7d",
  sectors: [],
  focus: null,
  setView: (view) => set({ view }),
  open: (panel) =>
    set((s) => {
      const top = s.panels[s.panels.length - 1];
      if (top && samePanel(top, panel)) return s;
      return { panels: [...s.panels.slice(-15), panel] };
    }),
  replace: (panel) => set((s) => ({ panels: [...s.panels.slice(0, -1), panel] })),
  back: () => set((s) => ({ panels: s.panels.slice(0, -1) })),
  closePanels: () => set({ panels: [] }),
  setWindow: (window) => set({ window }),
  toggleSector: (sector) =>
    set((s) => ({
      sectors: s.sectors.includes(sector) ? s.sectors.filter((x) => x !== sector) : [...s.sectors, sector],
    })),
  clearSectors: () => set({ sectors: [] }),
  flyTo: (focus) => set({ focus: { ...focus, nonce: Date.now() } }),
}));

export const currentPanel = (s: NavState): Panel | null => s.panels[s.panels.length - 1] ?? null;
