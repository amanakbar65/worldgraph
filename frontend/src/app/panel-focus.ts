import { useCallback, useEffect, useRef, type RefObject } from "react";

import { focusOrigin, returnFocus } from "@/lib/focus";
import { currentPanel, useNav, type Panel } from "@/state/nav";

/**
 * Keyboard focus for the panel layer (side panel or bottom sheet):
 * - when a panel opens, or another one replaces it, focus moves into it
 *   (to its close button, which takes the returned ref) unless the new
 *   panel put it somewhere itself (Ask focuses its question box);
 * - when the last panel closes, focus goes back to the control that opened
 *   it, or to the main content when that control has gone. Never to <body>.
 * A panel that is already open on page load (a deep link) leaves focus
 * alone, so the skip link stays the first stop.
 */
export function usePanelFocus(
  panel: Panel | null,
  root: RefObject<HTMLElement | null>,
): (el: HTMLElement | null) => void {
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef<Panel | null | undefined>(undefined); // undefined until the first render
  const first = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  /** What had focus when the panel changed. */
  const before = useRef<Element | null>(null);

  const focusFirst = useCallback(() => {
    pending.current = false;
    const now = document.activeElement;
    const panelTookIt = now !== before.current && !!root.current?.contains(now);
    if (!panelTookIt) first.current?.focus({ preventScroll: true });
  }, [root]);

  // The bottom sheet renders a moment after the panel opens (its portal
  // mounts first), so the close button may arrive after the effect below.
  const firstRef = useCallback(
    (el: HTMLElement | null) => {
      first.current = el;
      if (el && pending.current) focusFirst();
    },
    [focusFirst],
  );

  // Who opened it: read while the store changes, i.e. inside the click or key
  // handler that opened the panel, before anything re-renders or moves focus.
  useEffect(
    () =>
      useNav.subscribe((next, prev) => {
        const was = currentPanel(prev);
        const now = currentPanel(next);
        if (!now || now === was) return;
        before.current = document.activeElement;
        const origin = focusOrigin();
        // A link inside the panel keeps the original opener.
        if (origin && !root.current?.contains(origin)) opener.current = origin;
        else if (!was) opener.current = null;
      }),
    [root],
  );

  useEffect(() => {
    const previous = shown.current;
    shown.current = panel;
    if (previous === undefined || previous === panel) return;
    if (panel) {
      if (first.current) focusFirst();
      else pending.current = true;
    } else {
      pending.current = false;
      // The sheet is still sliding away on phones: focus inside it counts as lost.
      returnFocus(opener.current, root.current);
      opener.current = null;
    }
  }, [panel, root, focusFirst]);

  return firstRef;
}
