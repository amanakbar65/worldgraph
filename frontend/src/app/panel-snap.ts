import type { Panel } from "@/state/nav";

/** The phone sheet's own height, a share of the screen (PanelHost's `h-[94dvh]`). */
export const SHEET_HEIGHT = 0.94;

/** How far vaul slides the sheet down at a snap point: (1 - point) × the screen. */
const HIDDEN_AT_TOP = 1 - SHEET_HEIGHT;

/**
 * The phone sheet's two heights: half the screen, or the whole sheet (nearly
 * all the screen). vaul slides the sheet down by (1 - point) × the screen,
 * as if it were as tall as the screen, so the points make up the 6% it isn't:
 * a top point below 1 would leave the sheet's last lines below the screen.
 */
export const SNAP_POINTS = [0.5 + HIDDEN_AT_TOP, 1] as const;

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

/** How much of the sheet shows at a snap point, in px from its top. */
export function shownHeight(snap: number, screenHeight: number): number {
  return (snap - HIDDEN_AT_TOP) * screenHeight;
}

/**
 * Focus moved to something in the sheet (Tab, a screen reader, a field):
 * the height to raise the sheet to, or null to leave it. At half height the
 * sheet's lower part is below the screen, and scrolling can't bring it up,
 * so focus landing there raises the sheet to full height. `box` is the
 * focused element's top and bottom in px from the sheet's top (so a sheet
 * still sliding in doesn't count as off screen). Something taller than what
 * shows (the sheet itself, its scroll area) counts as in view when its top is.
 */
export function snapForFocus(
  snap: number | string | null,
  box: { top: number; bottom: number },
  screenHeight: number,
): number | null {
  const full = SNAP_POINTS[1];
  if (typeof snap !== "number" || snap >= full) return null;
  const shown = shownHeight(snap, screenHeight);
  const fits = box.bottom - box.top <= shown;
  return box.top >= shown || (fits && box.bottom > shown) ? full : null;
}
