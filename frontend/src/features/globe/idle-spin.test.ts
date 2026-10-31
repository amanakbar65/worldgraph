import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachIdleSpin,
  DEG_PER_MS,
  EASE_MS,
  IDLE_MS,
  IdleSpin,
  MAX_IDLE_ZOOM,
  TURN_MS,
  wrapLng,
  type SpinMap,
} from "./idle-spin";

describe("IdleSpin (the logic)", () => {
  it("turns once around in two to three minutes", () => {
    expect(TURN_MS).toBeGreaterThanOrEqual(120_000);
    expect(TURN_MS).toBeLessThanOrEqual(180_000);
    expect(DEG_PER_MS * TURN_MS).toBeCloseTo(360);
  });

  it("starts after the idle time, with nothing open", () => {
    const spin = new IdleSpin(0);
    expect(spin.idleIn(0)).toBe(IDLE_MS);
    expect(spin.idleIn(IDLE_MS - 1)).toBe(1);
    expect(spin.idleIn(IDLE_MS + 5)).toBe(0);
    spin.start(IDLE_MS);
    expect(spin.mode).toBe("turning");
    expect(spin.idleIn(IDLE_MS)).toBeNull();
  });

  it("eases in from a standstill to full speed", () => {
    const spin = new IdleSpin(0);
    spin.start(1000);
    expect(spin.speed(1000)).toBe(0);
    const early = spin.speed(1000 + EASE_MS * 0.25);
    const mid = spin.speed(1000 + EASE_MS * 0.5);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(mid);
    expect(mid).toBeCloseTo(0.5);
    expect(spin.speed(1000 + EASE_MS)).toBe(1);
    expect(spin.step(1000 + EASE_MS * 2, 16)).toBeCloseTo(DEG_PER_MS * 16);
    // After a pause it eases in again.
    spin.restartEase(10_000);
    expect(spin.speed(10_000)).toBe(0);
  });

  it("stops at once on input and counts idle time from it", () => {
    const spin = new IdleSpin(0);
    spin.start(IDLE_MS);
    expect(spin.input(40_000)).toBe(true);
    expect(spin.mode).toBe("still");
    expect(spin.step(40_016, 16)).toBe(0);
    expect(spin.idleIn(40_000)).toBe(IDLE_MS);
    expect(spin.input(41_000)).toBe(false); // nothing was turning
  });

  it("counts pointer movement as presence without stopping a turn", () => {
    const spin = new IdleSpin(0);
    spin.activity(20_000);
    expect(spin.idleIn(30_000)).toBe(20_000);
    spin.start(60_000);
    spin.activity(61_000);
    expect(spin.mode).toBe("turning");
  });

  it("turns after Home once the flight lands, not before", () => {
    const spin = new IdleSpin(0);
    spin.home(5000);
    expect(spin.mode).toBe("after-flight");
    expect(spin.idleIn(5000)).toBeNull();
    spin.flightEnded(6600);
    expect(spin.mode).toBe("turning");
    expect(spin.speed(6600)).toBe(0);
    // Input during the flight cancels the turn to come.
    spin.home(10_000);
    spin.input(10_500);
    spin.flightEnded(11_600);
    expect(spin.mode).toBe("still");
  });

  it("doesn't start while a panel or selection is open, and stops when one opens", () => {
    const spin = new IdleSpin(0);
    spin.setBlocked(true, 0);
    expect(spin.idleIn(IDLE_MS * 3)).toBeNull();
    // Closing it counts idle time from then.
    spin.setBlocked(false, 100_000);
    expect(spin.idleIn(100_000)).toBe(IDLE_MS);
    spin.start(130_000);
    expect(spin.setBlocked(true, 131_000)).toBe(true);
    expect(spin.mode).toBe("still");
  });

  it("never turns when motion is reduced", () => {
    const spin = new IdleSpin(0);
    spin.setAllowed(false);
    expect(spin.idleIn(IDLE_MS * 2)).toBeNull();
    spin.home(1000);
    spin.flightEnded(2000);
    expect(spin.mode).toBe("still");
    spin.start(3000);
    expect(spin.mode).toBe("still");
    // Turning reduced motion on mid-turn stops it.
    spin.setAllowed(true);
    spin.start(4000);
    expect(spin.setAllowed(false)).toBe(true);
    expect(spin.mode).toBe("still");
  });

  it("wraps longitudes", () => {
    expect(wrapLng(181)).toBeCloseTo(-179);
    expect(wrapLng(-181)).toBeCloseTo(179);
    expect(wrapLng(25)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// The driver, on a fake map with fake timers and animation frames
// ---------------------------------------------------------------------------

function fakeMap(zoom = 1.8) {
  const handlers = new Map<string, Set<() => void>>();
  const state = { lng: 25, lat: 20, zoom, moving: false, setCenter: 0 };
  const map = {
    getCenter: () => ({ lng: state.lng, lat: state.lat }),
    setCenter: (c: [number, number]) => {
      state.setCenter += 1;
      state.lng = c[0];
      state.lat = c[1];
      handlers.get("moveend")?.forEach((h) => h());
    },
    getZoom: () => state.zoom,
    isMoving: () => state.moving,
    on: (type: string, h: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    },
    off: (type: string, h: () => void) => handlers.get(type)?.delete(h),
  };
  const fire = (type: string) => handlers.get(type)?.forEach((h) => h());
  return { map: map as unknown as SpinMap, state, fire, handlers };
}

describe("attachIdleSpin (the driver)", () => {
  let el: HTMLDivElement;
  let reduced = false;
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    reduced = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    el = document.createElement("div");
    el.tabIndex = 0;
    document.body.append(el);
  });
  afterEach(() => {
    el.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const attach = (zoom = 1.8, hooks = {}) => {
    const fake = fakeMap(zoom);
    const handle = attachIdleSpin(fake.map, el, { now: () => performance.now(), ...hooks });
    handle.update({ blocked: false, allowed: true });
    return { ...fake, handle };
  };

  it("stays still on load and starts turning after 30 s idle, without re-rendering anything", () => {
    const onStop = vi.fn();
    const { state, handle } = attach(1.8, { onStop });
    vi.advanceTimersByTime(IDLE_MS - 1000);
    expect(handle.mode).toBe("still");
    expect(state.lng).toBe(25);
    vi.advanceTimersByTime(1000 + EASE_MS + 2000);
    expect(handle.mode).toBe("turning");
    expect(state.lng).toBeGreaterThan(25);
    expect(onStop).not.toHaveBeenCalled();
    handle.dispose();
  });

  it.each([
    ["pointer down", () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))],
    ["wheel", () => document.body.dispatchEvent(new Event("wheel", { bubbles: true }))],
    ["touch (pinch)", () => document.body.dispatchEvent(new Event("touchstart", { bubbles: true }))],
    [
      "a key",
      () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    ],
    ["focus into the map", () => el.focus()],
  ])("stops at once on %s, and resumes only after the next idle period", (_label, input) => {
    const onStop = vi.fn();
    const { state, handle } = attach(1.8, { onStop });
    vi.advanceTimersByTime(IDLE_MS + EASE_MS);
    expect(handle.mode).toBe("turning");
    input();
    expect(handle.mode).toBe("still");
    expect(onStop).toHaveBeenCalledTimes(1);
    const at = state.lng;
    vi.advanceTimersByTime(IDLE_MS - 1000);
    expect(state.lng).toBe(at);
    vi.advanceTimersByTime(2000);
    expect(handle.mode).toBe("turning");
    handle.dispose();
  });

  it("turns after Home once the flight lands", () => {
    const { state, fire, handle } = attach();
    state.moving = true; // the flight
    handle.home();
    vi.advanceTimersByTime(1000);
    expect(handle.mode).toBe("after-flight");
    state.moving = false;
    fire("moveend");
    expect(handle.mode).toBe("turning");
    vi.advanceTimersByTime(EASE_MS + 1000);
    expect(state.lng).toBeGreaterThan(25);
    handle.dispose();
  });

  it.each([
    ["is still flying when the map loads", true],
    ["has landed before the map loads", false],
  ])("turns after a Home press made before the map loaded, when the flight %s", (_label, flying) => {
    // Another screen's logo mounts the globe: Home is asked for before the map is ready.
    const fake = fakeMap();
    const handle = attachIdleSpin(fake.map, el, { now: () => performance.now() });
    handle.update({ blocked: false, allowed: false });
    fake.state.moving = true;
    handle.home();
    expect(handle.mode).toBe("still");
    if (!flying) {
      fake.state.moving = false;
      fake.fire("moveend");
    }
    handle.update({ blocked: false, allowed: true }); // loaded
    if (flying) {
      expect(handle.mode).toBe("after-flight");
      fake.state.moving = false;
      fake.fire("moveend");
    }
    expect(handle.mode).toBe("turning");
    vi.advanceTimersByTime(EASE_MS + 1000);
    expect(fake.state.lng).toBeGreaterThan(25);
    handle.dispose();
  });

  it("forgets a Home press made before the map loaded once the viewer moves it", () => {
    const fake = fakeMap();
    const handle = attachIdleSpin(fake.map, el, { now: () => performance.now() });
    handle.update({ blocked: false, allowed: false });
    handle.home();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    handle.update({ blocked: false, allowed: true });
    expect(handle.mode).toBe("still");
    handle.dispose();
  });

  it("holds while the tab is hidden or the pointer is on something, then eases in again", () => {
    let paused = false;
    const { state, handle } = attach(1.8, { isPaused: () => paused });
    vi.advanceTimersByTime(IDLE_MS + EASE_MS * 2);
    expect(handle.mode).toBe("turning");
    paused = true;
    const at = state.lng;
    vi.advanceTimersByTime(2000);
    expect(state.lng).toBe(at);
    expect(handle.mode).toBe("turning");
    paused = false;
    vi.advanceTimersByTime(1000);
    expect(state.lng).toBeGreaterThan(at);

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const before = state.lng;
    vi.advanceTimersByTime(2000);
    expect(state.lng).toBe(before);
    hidden.mockRestore();
    handle.dispose();
  });

  it("doesn't start while a panel or selection is open, and stops when one opens", () => {
    const { handle } = attach();
    handle.update({ blocked: true, allowed: true });
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(handle.mode).toBe("still");
    handle.update({ blocked: false, allowed: true });
    vi.advanceTimersByTime(IDLE_MS + 100);
    expect(handle.mode).toBe("turning");
    handle.update({ blocked: true, allowed: true });
    expect(handle.mode).toBe("still");
    handle.dispose();
  });

  it("never turns with the Calm setting or reduced motion", () => {
    const calm = attach();
    calm.handle.update({ blocked: false, allowed: false });
    vi.advanceTimersByTime(IDLE_MS * 3);
    calm.handle.home();
    calm.fire("moveend");
    expect(calm.handle.mode).toBe("still");
    expect(calm.state.setCenter).toBe(0);
    calm.handle.dispose();

    reduced = true;
    const device = attach();
    vi.advanceTimersByTime(IDLE_MS * 3);
    device.handle.home();
    device.fire("moveend");
    expect(device.handle.mode).toBe("still");
    expect(device.state.setCenter).toBe(0);
    device.handle.dispose();
  });

  it("starts an idle turn only while the whole globe is in view", () => {
    const { handle } = attach(MAX_IDLE_ZOOM + 2);
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(handle.mode).toBe("still");
    handle.dispose();
  });

  it("counts pointer movement as presence", () => {
    const { handle } = attach();
    vi.advanceTimersByTime(IDLE_MS - 5000);
    document.body.dispatchEvent(new Event("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    expect(handle.mode).toBe("still");
    vi.advanceTimersByTime(IDLE_MS);
    expect(handle.mode).toBe("turning");
    handle.dispose();
  });

  it("lets go of every listener when disposed", () => {
    const { handle, handlers } = attach();
    handle.dispose();
    expect(handlers.get("moveend")?.size ?? 0).toBe(0);
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(handle.mode).toBe("still");
  });
});
