import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMinuteClock } from "./hooks";

afterEach(() => {
  vi.useRealTimers();
});

describe("useMinuteClock", () => {
  it("is the current minute, also after the globe was left and opened again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:30Z"));
    const first = renderHook(() => useMinuteClock());
    expect(first.result.current).toBe(Date.parse("2026-10-08T12:00:00Z"));
    first.unmount(); // e.g. the Graph screen is open; nothing keeps the clock running

    vi.setSystemTime(new Date("2026-10-08T12:45:30Z"));
    const again = renderHook(() => useMinuteClock());
    expect(again.result.current).toBe(Date.parse("2026-10-08T12:45:00Z"));
    again.unmount();
  });

  it("moves on once a minute while the globe is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T13:00:10Z"));
    const clock = renderHook(() => useMinuteClock());
    expect(clock.result.current).toBe(Date.parse("2026-10-08T13:00:00Z"));
    vi.advanceTimersByTime(60_000);
    clock.rerender();
    expect(clock.result.current).toBe(Date.parse("2026-10-08T13:01:00Z"));
    clock.unmount();
  });
});
