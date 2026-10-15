import { useEffect } from "react";

import { useNav } from "@/state/nav";

/**
 * Escape closes the top panel. It leaves alone an Escape typed in a field or
 * a modal dialog, and one a popover, menu or select already used to close
 * itself (Radix calls preventDefault on it).
 */
export function useEscapeClosesPanel(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=dialog][data-modal]")) return;
      useNav.getState().back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
