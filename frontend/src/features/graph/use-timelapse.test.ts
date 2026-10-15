import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALM_STEP_MS, CALM_STEPS, useTimelapse } from "./use-timelapse";

const TIMES = new Map<string, number>([
  ["a", 0],
  ["b", 400],
  ["c", 800],
]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTimelapse under reduced motion", () => {
  it("steps through the replay in a few even jumps, without animating", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { result } = renderHook(() => useTimelapse(TIMES, true));
    expect(result.current.active).toBe(false);
    expect(result.current.visible).toBeNull();

    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.playing).toBe(true);
    expect(result.current.cursor).toBe(800 / CALM_STEPS);
    expect(result.current.growth).toBeNull(); // nothing grows in
    expect([...result.current.visible!]).toEqual(["a"]);

    act(() => vi.advanceTimersByTime(CALM_STEP_MS * CALM_STEPS));
    expect(result.current.cursor).toBe(800);
    expect(result.current.playing).toBe(false);
    expect(result.current.visible!.size).toBe(3);
    expect(raf).not.toHaveBeenCalled();
  });

  it("can be paused, scrubbed and closed", () => {
    const { result } = renderHook(() => useTimelapse(TIMES, true));
    act(() => result.current.start());
    act(() => result.current.toggle());
    expect(result.current.playing).toBe(false);
    act(() => result.current.seek(500));
    expect([...result.current.visible!].sort()).toEqual(["a", "b"]);
    act(() => result.current.seek(5000));
    expect(result.current.cursor).toBe(800);
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.visible).toBeNull();
  });

  it("ends the replay when the data changes", () => {
    const { result, rerender } = renderHook(({ times }) => useTimelapse(times, true), { initialProps: { times: TIMES } });
    act(() => result.current.start());
    rerender({ times: new Map(TIMES) });
    expect(result.current.active).toBe(false);
  });
});

describe("useTimelapse with motion", () => {
  it("glides with animation frames and grows new nodes in", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result } = renderHook(() => useTimelapse(TIMES, false));
    act(() => result.current.start());
    expect(result.current.cursor).toBe(0);
    expect(frames.length).toBeGreaterThan(0);
    expect(typeof result.current.growth).toBe("function");
    expect(result.current.growth!("a")).toBe(0);
    expect(result.current.growth!("missing")).toBe(Infinity);
  });
});
