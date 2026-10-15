import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { readPalette, type Palette } from "./graph-colors";

export interface GraphTheme {
  palette: Palette;
  /** The app's font stack, for canvas labels. */
  font: string;
}

function readTheme(): GraphTheme {
  let font = "ui-sans-serif, system-ui, sans-serif";
  try {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) font = family;
  } catch {
    // Keep the system stack.
  }
  return { palette: readPalette(), font };
}

/**
 * The design tokens resolved for the canvas. Re-read whenever the theme
 * attribute on <html> changes (dark ⇄ light, or the host's theme), and once
 * more when web fonts finish loading.
 */
export function useGraphTheme(): GraphTheme {
  const [theme, setTheme] = useState<GraphTheme>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    let alive = true;
    const update = () => alive && setTheme(readTheme());
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-wg-theme"] });
    void document.fonts?.ready.then(update).catch(() => undefined);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);
  return theme;
}

/** The size of an element, kept up to date (0×0 until measured). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
