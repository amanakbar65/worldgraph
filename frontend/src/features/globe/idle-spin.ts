/**
 * The globe's slow turn: about one full turn every two and a half minutes,
 * eased in. It starts after the Home button's flight back to the whole
 * globe, or after 30 seconds without input while nothing is open, and stops
 * at once on any input (pointer down, drag, wheel, pinch, a key, focus moving
 * into the map). It resumes only on the next Home press or idle period.
 * Never when motion is reduced (the Calm setting or the device), and it holds
 * while the tab is hidden.
 *
 * `IdleSpin` is the plain logic (tested on its own); `attachIdleSpin` drives
 * a MapLibre map with requestAnimationFrame: the camera moves directly, so a
 * turn re-renders nothing and fetches nothing.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

import { prefersReducedMotion } from "@/state/settings";

/** One full turn takes this long at full speed (2.4° a second). */
export const TURN_MS = 150_000;
export const DEG_PER_MS = 360 / TURN_MS;
/** No input for this long, with nothing open, starts a turn. */
export const IDLE_MS = 30_000;
/** A turn takes this long to reach full speed (and again after a pause). */
export const EASE_MS = 3_000;
/** Idle time starts a turn only while the whole globe is in view (zoomed out this far). */
export const MAX_IDLE_ZOOM = 3;

export type SpinMode = "still" | "after-flight" | "turning";

export class IdleSpin {
  mode: SpinMode = "still";
  private lastInput: number;
  private easeFrom = 0;
  private blocked = false;
  private allowed = true;

  constructor(
    now: number,
    private readonly idleMs = IDLE_MS,
  ) {
    this.lastInput = now;
  }

  /** Viewer input: stop at once, and count idle time from now. Returns whether a turn stopped. */
  input(now: number): boolean {
    const was = this.mode;
    this.mode = "still";
    this.lastInput = now;
    return was === "turning";
  }

  /** The pointer moved: the viewer is here, so idle time starts again (a turn carries on). */
  activity(now: number): void {
    this.lastInput = now;
  }

  /** Home was pressed: turn once the flight back ends. */
  home(now: number): void {
    this.lastInput = now;
    this.mode = this.allowed ? "after-flight" : "still";
  }

  /** A camera flight ended; after Home, the turn starts. */
  flightEnded(now: number): void {
    if (this.mode === "after-flight") this.start(now);
  }

  /**
   * A panel, selection or list is open (true) or not (false). Opening one
   * stops a turn; closing it counts idle time from then.
   */
  setBlocked(blocked: boolean, now: number): boolean {
    if (blocked === this.blocked) return false;
    this.blocked = blocked;
    if (!blocked) {
      this.lastInput = now;
      return false;
    }
    const was = this.mode;
    this.mode = "still";
    return was === "turning";
  }

  /** Motion allowed (no Calm setting, no reduced motion). Turning it off stops a turn for good. */
  setAllowed(allowed: boolean): boolean {
    this.allowed = allowed;
    if (allowed) return false;
    const was = this.mode;
    this.mode = "still";
    return was === "turning";
  }

  /** Milliseconds until idle time may start a turn (0: now), or null while it can't. */
  idleIn(now: number): number | null {
    if (this.mode !== "still" || this.blocked || !this.allowed) return null;
    return Math.max(0, this.lastInput + this.idleMs - now);
  }

  start(now: number): void {
    if (!this.allowed) return;
    this.mode = "turning";
    this.easeFrom = now;
  }

  /** After a pause (hidden tab, hover, another camera move), ease in again. */
  restartEase(now: number): void {
    this.easeFrom = now;
  }

  /** Full speed × the ease-in, from 0 to 1. */
  speed(now: number): number {
    if (this.mode !== "turning") return 0;
    const t = Math.min(1, Math.max(0, (now - this.easeFrom) / EASE_MS));
    return t * t * (3 - 2 * t);
  }

  /** Degrees of longitude to turn east for a frame of `dt` ms ending at `now`. */
  step(now: number, dt: number): number {
    return DEG_PER_MS * this.speed(now) * dt;
  }
}

/** Longitude kept within −180…180. */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The part of a MapLibre map the turn uses. */
export type SpinMap = Pick<MapLibreMap, "getCenter" | "setCenter" | "getZoom" | "isMoving" | "on" | "off">;

export interface SpinHooks {
  /** About once a second while turning (place the names that turn into view). */
  onTurn?: () => void;
  /** A turn ended (report where the camera is now). */
  onStop?: () => void;
  /** Hold the turn this frame (the pointer is on something). */
  isPaused?: () => boolean;
  /** Clock (ms); performance.now by default. */
  now?: () => number;
  /** Where input is listened for; the document by default. */
  root?: Document;
}

export interface SpinHandle {
  /** Call just before the flight home: the turn starts when it lands. */
  home(): void;
  /** The app moved the camera (a fly-to, the zoom buttons): stop, as for input. */
  stop(): void;
  update(state: { blocked: boolean; allowed: boolean }): void;
  /** True while the turn itself is moving the camera (not worth reporting each frame). */
  readonly moving: boolean;
  readonly mode: SpinMode;
  dispose(): void;
}

const INPUT_EVENTS = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
const MAX_FRAME_MS = 100;
const LONG_GAP_MS = 1000;

/** Drive `map`'s slow turn. `el` is the map's container (focus moving into it counts as input). */
export function attachIdleSpin(map: SpinMap, el: HTMLElement, hooks: SpinHooks = {}): SpinHandle {
  const clock = hooks.now ?? (() => performance.now());
  const root = hooks.root ?? document;
  const spin = new IdleSpin(clock());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let last = 0;
  let lastLabels = 0;
  let moving = false;
  let disposed = false;

  const stopped = (didStop: boolean) => {
    if (didStop) hooks.onStop?.();
    schedule();
  };

  const frame = () => {
    raf = 0;
    if (disposed || spin.mode !== "turning") return;
    raf = requestAnimationFrame(frame);
    const now = clock();
    const gap = now - last;
    last = now;
    // A long gap means the page was away (a hidden tab stops frames): ease in again.
    if (root.hidden || map.isMoving() || hooks.isPaused?.() || gap > LONG_GAP_MS) {
      spin.restartEase(now);
      return;
    }
    // Slow devices draw few frames: each one moves at most a tenth of a second's worth.
    const deg = spin.step(now, Math.min(MAX_FRAME_MS, gap));
    if (deg > 0) {
      const c = map.getCenter();
      moving = true;
      try {
        map.setCenter([wrapLng(c.lng + deg), c.lat]);
      } finally {
        moving = false;
      }
    }
    if (now - lastLabels > 1000) {
      lastLabels = now;
      hooks.onTurn?.();
    }
  };

  const tryIdleStart = () => {
    timer = undefined;
    if (disposed) return;
    const now = clock();
    const wait = spin.idleIn(now);
    if (wait === null) return;
    if (wait > 0) {
      schedule();
      return;
    }
    // Zoomed in, or motion just got reduced: wait for the next input instead.
    if (map.getZoom() > MAX_IDLE_ZOOM || prefersReducedMotion()) return;
    spin.start(now);
    schedule();
  };

  function schedule() {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (spin.mode === "turning") {
      if (!raf) {
        last = clock();
        lastLabels = last;
        raf = requestAnimationFrame(frame);
      }
      return;
    }
    const wait = spin.idleIn(clock());
    if (wait !== null) timer = setTimeout(tryIdleStart, wait + 20);
  }

  const onInput = () => stopped(spin.input(clock()));
  const onActivity = () => spin.activity(clock());
  const onMoveEnd = () => {
    if (moving || spin.mode !== "after-flight") return;
    if (prefersReducedMotion()) spin.input(clock());
    else spin.flightEnded(clock());
    schedule();
  };

  for (const type of INPUT_EVENTS) root.addEventListener(type, onInput, { capture: true, passive: true });
  root.addEventListener("pointermove", onActivity, { capture: true, passive: true });
  el.addEventListener("focusin", onInput);
  map.on("moveend", onMoveEnd);
  schedule();

  return {
    home() {
      spin.home(clock());
      schedule();
    },
    stop() {
      onInput();
    },
    update({ blocked, allowed }) {
      const now = clock();
      const a = spin.setAllowed(allowed);
      const b = spin.setBlocked(blocked, now);
      stopped(a || b);
    },
    get moving() {
      return moving;
    },
    get mode() {
      return spin.mode;
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      cancelAnimationFrame(raf);
      for (const type of INPUT_EVENTS) root.removeEventListener(type, onInput, { capture: true });
      root.removeEventListener("pointermove", onActivity, { capture: true });
      el.removeEventListener("focusin", onInput);
      map.off("moveend", onMoveEnd);
    },
  };
}
