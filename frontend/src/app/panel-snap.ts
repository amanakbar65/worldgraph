import type { Panel } from "@/state/nav";

/** The phone sheet's two heights: half the screen, or nearly all of it. */
export const SNAP_POINTS = [0.5, 0.94] as const;

/**
 * Panels that open on phones at full height: a conversation (its answer
 * arrives below the question) and the cascade (a tall chain of cards).
 */
export const FULL_HEIGHT_PANELS: ReadonlySet<Panel["kind"]> = new Set(["ask", "cascade"]);

/**
 * The sheet height a newly shown panel opens at: full height for Ask and
 * the cascade, half height when the sheet first opens, and otherwise null
 * (keep the height the viewer dragged to).
 */
export function openingSnap(kind: Panel["kind"] | null, previous: Panel["kind"] | null): number | null {
  if (kind === null) return SNAP_POINTS[0];
  if (FULL_HEIGHT_PANELS.has(kind)) return SNAP_POINTS[1];
  return previous === null ? SNAP_POINTS[0] : null;
}

/**
 * Focus moved to something in the sheet (Tab, a screen reader, a field):
 * the height to raise the sheet to, or null to leave it. Below half height
 * the sheet runs off the screen, and scrolling can't bring that part up, so
 * focus landing there raises the sheet to full height. `bottom` is how far
 * the focused element's bottom is from the sheet's top, so a sheet still
 * sliding in doesn't count as off screen.
 */
export function snapForFocus(snap: number | string | null, bottom: number, screenHeight: number): number | null {
  const full = SNAP_POINTS[1];
  if (typeof snap !== "number" || snap >= full) return null;
  return bottom > snap * screenHeight ? full : null;
}
