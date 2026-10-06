import { useSyncExternalStore } from "react";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop layout (side panels) from 768 px; phones get bottom sheets. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
