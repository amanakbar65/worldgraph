import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { paletteKey, readGlobePalette, type GlobePalette } from "@/lib/globe-color";

import type { ReplaySpan } from "./model";

/**
 * The globe's colours, read from the CSS tokens and read again whenever the
 * theme attribute on <html> changes (the app's theme setting or the host's).
 */
export function useGlobePalette(): { palette: GlobePalette; key: string } {
  const [state, setState] = useState(() => {
    const palette = readGlobePalette();
    return { palette, key: paletteKey(palette) };
  });
  useEffect(() => {
    const root = document.documentElement;
    const reread = () => {
      const palette = readGlobePalette();
      const key = paletteKey(palette);
      setState((prev) => (prev.key === key ? prev : { palette, key }));
    };
    reread();
    const observer = new MutationObserver(reread);
    observer.observe(root, { attributes: true, attributeFilter: ["data-wg-theme", "data-theme", "style", "class"] });
    return () => observer.disconnect();
  }, []);
  return state;
}

/**
 * The page font for map labels, once it has loaded (deck.gl draws text into
 * a texture, so it must not draw with a fallback font). Null until ready.
 */
export function usePageFont(): string | null {
  const [font, setFont] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const first = family.split(",")[0]?.trim() ?? "sans-serif";
    void Promise.allSettled(fonts ? [fonts.load(`500 48px ${first}`), fonts.ready] : []).then(() => {
      if (!cancelled) setFont(family);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return font;
}

// One shared minute clock (for "new in the last hour").
let minute = Math.floor(Date.now() / 60_000) * 60_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      minute = Math.floor(Date.now() / 60_000) * 60_000;
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The current time, rounded down to the minute; re-renders once a minute. */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => minute,
    () => minute,
  );
}

/** How long a replay of the whole window takes. */
export const REPLAY_MS = 12_000;

export interface ReplayState {
  span: ReplaySpan;
  /** The replay's clock (ms since the epoch). */
  at: number;
  /** What the replay was started for (window and lens); it lapses when they change. */
  key: string;
}

/**
 * Replay: a clock that sweeps through a time span in REPLAY_MS and then
 * stops. When calm, it moves in a few still steps instead of smoothly.
 */
export function useReplay(calm: boolean) {
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const running = replay !== null;
  useEffect(() => {
    if (!running) return;
    const stepMs = calm ? 1000 : 80;
    const timer = setInterval(() => {
      setReplay((r) => {
        if (!r) return r;
        const at = r.at + ((r.span.to - r.span.from) * stepMs) / REPLAY_MS;
        return at >= r.span.to ? null : { ...r, at };
      });
    }, stepMs);
    return () => clearInterval(timer);
  }, [running, calm]);
  const start = useCallback((span: ReplaySpan, key: string) => setReplay({ span, at: span.from, key }), []);
  const stop = useCallback(() => setReplay(null), []);
  return { replay, start, stop };
}

/** The size of an element, kept up to date. */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size];
}
