import { create } from "zustand";

import { viewerLooksIndian } from "@/platform/runtime";

/** Per-viewer preferences, kept in this browser only. */
export interface Settings {
  theme: "dark" | "light" | "system";
  /** Sample data: off by default; "auto" shows it only while there is no live data yet. */
  sample: "auto" | "on" | "off";
  /** Map borders: India's official view, or the international default. */
  borders: "auto" | "india" | "international";
  /** Reduce motion even if the device doesn't ask for it. */
  calm: boolean;
}

const KEY = "worldgraph.settings.v1";
// Live news by default (owner, 22 Oct): sample data only when the viewer turns it on.
const DEFAULTS: Settings = { theme: "dark", sample: "off", borders: "auto", calm: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage can be unavailable (private windows, previews); defaults are fine.
  }
  return DEFAULTS;
}

export const useSettings = create<Settings & { update: (patch: Partial<Settings>) => void }>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    try {
      const { update: _update, ...rest } = get();
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      // Not saved; the setting still applies for this visit.
    }
  },
}));

/** `sample` argument for api calls: undefined lets the database decide. */
export function sampleArg(setting: Settings["sample"]): boolean | undefined {
  return setting === "auto" ? undefined : setting === "on";
}

/**
 * The viewer's country as the website's server saw it (Netlify geo, sent with
 * meta). Null on the test link and until meta arrives; never set by the browser.
 */
export const useServerViewer = create<{ country: string | null }>(() => ({ country: null }));

export function useIndiaBorders(): boolean {
  const borders = useSettings((s) => s.borders);
  const serverCountry = useServerViewer((s) => s.country);
  return borders === "india" || (borders === "auto" && viewerLooksIndian(serverCountry));
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useCalm(): boolean {
  const calm = useSettings((s) => s.calm);
  return calm || prefersReducedMotion();
}
