import { useEffect } from "react";

import { useNav } from "@/state/nav";

/** Escapes another layer stopped only so that the app handles them itself. */
const leftToApp = new WeakSet<Event>();

/**
 * For a layer that would otherwise act on Escape itself (the phone sheet's
 * Radix dialog closes the whole sheet): stop it, and leave the key to the
 * app, which steps back one panel (or lets a drawer inside close first).
 */
export function leaveEscapeToApp(event: Event): void {
  leftToApp.add(event);
  event.preventDefault();
}

/**
 * Escape closes the top panel. It leaves alone an Escape typed in a field or
 * a modal dialog, and one a popover, menu or select already used to close
 * itself (Radix calls preventDefault on it).
 */
export function useEscapeClosesPanel(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.defaultPrevented && !leftToApp.has(e))) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=dialog][data-modal]")) return;
      useNav.getState().back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
