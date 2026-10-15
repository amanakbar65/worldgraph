import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { stepPositions, timelapseRange, visibleAt } from "./graph-data";

/** How long a full replay takes with motion on. */
export const REPLAY_MS = 9000;
/** Under reduced motion the replay moves in this many steps… */
export const CALM_STEPS = 8;
/** …this far apart. */
export const CALM_STEP_MS = 1200;

export interface Timelapse {
  /** The replay is on screen (playing or paused). */
  active: boolean;
  playing: boolean;
  /** The moment shown, in ms since the epoch. */
  cursor: number;
  range: { start: number; end: number } | null;
  /** Ids shown at the cursor; null when the replay is off (everything shows). */
  visible: Set<string> | null;
  /** How long ago (in replay ms) each node appeared, for the grow-in; null under reduced motion. */
  growth: ((id: string) => number) | null;
  start: () => void;
  toggle: () => void;
  stop: () => void;
  seek: (time: number) => void;
}

/**
 * Replays how the graph grew: nodes appear in the order of their reveal
 * time. With motion on, the cursor glides and new nodes grow in; under
 * reduced motion it moves in a few discrete steps and nothing animates.
 */
export function useTimelapse(times: ReadonlyMap<string, number> | null, calm: boolean): Timelapse {
  const range = useMemo(() => (times ? timelapseRange(times) : null), [times]);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);

  const moveTo = useCallback((t: number) => {
    cursorRef.current = t;
    setCursor(t);
  }, []);

  // New data ends any replay.
  const [seenTimes, setSeenTimes] = useState(times);
  if (seenTimes !== times) {
    setSeenTimes(times);
    setActive(false);
    setPlaying(false);
  }

  useEffect(() => {
    if (!active || !playing || !range) return;
    const span = Math.max(1, range.end - range.start);
    if (calm) {
      const steps = stepPositions(range, CALM_STEPS);
      const timer = setInterval(() => {
        const next = steps.find((s) => s > cursorRef.current + 1);
        if (next === undefined) {
          setPlaying(false);
          return;
        }
        moveTo(next);
        if (next >= range.end) setPlaying(false);
      }, CALM_STEP_MS);
      return () => clearInterval(timer);
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const next = Math.min(range.end, cursorRef.current + (dt / REPLAY_MS) * span);
      moveTo(next);
      if (next >= range.end) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, playing, range, calm, moveTo]);

  const start = useCallback(() => {
    if (!range) return;
    moveTo(calm ? stepPositions(range, CALM_STEPS)[0] : range.start);
    setActive(true);
    setPlaying(true);
  }, [range, calm, moveTo]);

  const toggle = useCallback(() => {
    if (!range) return;
    if (!playing && cursorRef.current >= range.end) moveTo(calm ? stepPositions(range, CALM_STEPS)[0] : range.start);
    setPlaying((p) => !p);
  }, [playing, range, calm, moveTo]);

  const stop = useCallback(() => {
    setActive(false);
    setPlaying(false);
  }, []);

  const seek = useCallback(
    (t: number) => {
      if (!range) return;
      setPlaying(false);
      moveTo(Math.min(range.end, Math.max(range.start, t)));
    },
    [range, moveTo],
  );

  const visible = useMemo(() => (active && times ? visibleAt(times, cursor) : null), [active, times, cursor]);
  const growth = useMemo(() => {
    if (!active || calm || !times || !range || !playing) return null;
    const scale = REPLAY_MS / Math.max(1, range.end - range.start);
    return (id: string) => {
      const t = times.get(id);
      return t === undefined ? Infinity : (cursor - t) * scale;
    };
  }, [active, calm, times, range, cursor, playing]);

  return { active, playing, cursor, range, visible, growth, start, toggle, stop, seek };
}
