import { describe, expect, it } from "vitest";

import { formatDate, isFresh, relativeTime, TIME_WINDOWS, WINDOW_LABELS, WINDOW_MS } from "./time";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe("relativeTime", () => {
  it("says 'just now' for the last minute", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(59_000), NOW)).toBe("just now");
  });

  it("counts minutes, hours and days in the past", () => {
    expect(relativeTime(ago(12 * MIN), NOW)).toBe("12 min ago");
    expect(relativeTime(ago(59 * MIN + 59_000), NOW)).toBe("59 min ago");
    expect(relativeTime(ago(H), NOW)).toBe("1 h ago");
    expect(relativeTime(ago(3 * H + 20 * MIN), NOW)).toBe("3 h ago");
    expect(relativeTime(ago(2 * D + 5 * H), NOW)).toBe("2 d ago");
    expect(relativeTime(ago(29 * D), NOW)).toBe("29 d ago");
  });

  it("counts into the future", () => {
    expect(relativeTime(NOW + 30_000, NOW)).toBe("in under a minute");
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe("in 5 min");
    expect(relativeTime(NOW + 4 * H, NOW)).toBe("in 4 h");
    expect(relativeTime(NOW + 5 * D + H, NOW)).toBe("in 5 d");
  });

  it("shows the date beyond 30 days", () => {
    expect(relativeTime("2026-08-01T09:00:00Z", NOW, "en-GB")).toBe("1 Aug");
    expect(relativeTime("2025-03-12T09:00:00Z", NOW, "en-GB")).toBe("12 Mar 2025");
    expect(relativeTime("2027-01-15T00:00:00Z", NOW, "en-GB")).toBe("15 Jan 2027");
  });

  it("accepts Date objects and numbers", () => {
    expect(relativeTime(new Date(NOW - 2 * H), new Date(NOW))).toBe("2 h ago");
    expect(relativeTime(NOW - 2 * H, NOW)).toBe("2 h ago");
  });

  it("returns an empty string for a bad date", () => {
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("formatDate", () => {
  it("drops the year when it's the current one", () => {
    expect(formatDate("2026-03-12T00:00:00Z", NOW, "en-GB")).toBe("12 Mar");
    expect(formatDate("2024-03-12T00:00:00Z", NOW, "en-GB")).toBe("12 Mar 2024");
  });
});

describe("isFresh", () => {
  it("is true only for the last hour", () => {
    expect(isFresh(ago(10 * MIN), NOW)).toBe(true);
    expect(isFresh(ago(61 * MIN), NOW)).toBe(false);
    expect(isFresh(NOW + MIN, NOW)).toBe(false);
  });
});

describe("time windows", () => {
  it("labels 24 h, 7 d and 30 d", () => {
    expect(TIME_WINDOWS.map((w) => WINDOW_LABELS[w].short)).toEqual(["24 h", "7 d", "30 d"]);
    expect(WINDOW_LABELS["7d"].long).toBe("Last 7 days");
    expect(WINDOW_MS["24h"]).toBe(D);
  });
});
