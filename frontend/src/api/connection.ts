import { create } from "zustand";

import type { DataError, DataSource } from "./source";

/**
 * What the app is currently showing: live data, the bundled snapshot, or
 * nothing. Set by the data sources in client.ts (which re-exports this);
 * kept in its own module so screens can read it without the data client.
 */
export type ConnectionState =
  | { status: "connecting" }
  | { status: "live"; source: DataSource["kind"] }
  | { status: "snapshot"; reason: DataError }
  // No live connection, and no snapshot this viewer may see: nothing is shown in its place.
  | { status: "disconnected"; reason: DataError }
  | { status: "error"; reason: DataError };

export const useConnection = create<{ state: ConnectionState; set: (s: ConnectionState) => void }>((set) => ({
  state: { status: "connecting" },
  set: (state) => set({ state }),
}));
