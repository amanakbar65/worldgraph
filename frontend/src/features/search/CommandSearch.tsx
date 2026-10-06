import { useEffect } from "react";

import { useUi } from "@/state/ui";

/** Ctrl/Cmd+K search. Placeholder until the search feature is built. */
export function CommandSearch() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  if (!open) return null;
  return null;
}
