import { create } from "zustand";

/**
 * The first-run setup: decided once per visit, when the stored profile has
 * loaded. It stays open while the viewer fills it in (the first chip must
 * not jump to the dashboard) until they finish or skip it.
 */
export const useFirstRun = create<{ phase: "unknown" | "open" | "done" }>(() => ({ phase: "unknown" }));

/** Tests only. */
export const resetFirstRun = () => useFirstRun.setState({ phase: "unknown" });
