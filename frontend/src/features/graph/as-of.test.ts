import { describe, expect, it } from "vitest";

import { DataError } from "@/api/source";
import { snapshotKey } from "@/api/sources/static";

import {
  asOfUnavailable,
  clampDay,
  dayOf,
  formatDay,
  historyStartFromError,
  snapshotHasAsOf,
  today,
  UNAVAILABLE_REASON,
  type AsOfConditions,
} from "./as-of";

const live: AsOfConditions = { sample: "off", showingSample: false, connection: "live", snapshotHasAsOf: false };

describe("asOfUnavailable: why past dates can't be shown", () => {
  it("is free with live data", () => {
    expect(asOfUnavailable(live)).toBeNull();
    expect(asOfUnavailable({ ...live, sample: "auto" })).toBeNull();
    // Still connecting, or a failed call: left to the call itself.
    expect(asOfUnavailable({ ...live, connection: "connecting" })).toBeNull();
    expect(asOfUnavailable({ ...live, connection: "error" })).toBeNull();
  });

  it("is off with sample data, which has no history", () => {
    expect(asOfUnavailable({ ...live, sample: "on" })).toBe("sample");
    expect(asOfUnavailable({ ...live, sample: "auto", showingSample: true })).toBe("sample");
    // Off means live data, whatever meta says about the default.
    expect(asOfUnavailable({ ...live, sample: "off", showingSample: true })).toBeNull();
  });

  it("is off from the saved snapshot, unless the snapshot has the call", () => {
    expect(asOfUnavailable({ ...live, connection: "snapshot" })).toBe("snapshot");
    expect(asOfUnavailable({ ...live, connection: "disconnected" })).toBe("snapshot");
    expect(asOfUnavailable({ ...live, connection: "snapshot", snapshotHasAsOf: true })).toBeNull();
    // Sample data is the first reason given.
    expect(asOfUnavailable({ ...live, sample: "on", connection: "snapshot" })).toBe("sample");
  });

  it("says each reason in a few words", () => {
    expect(UNAVAILABLE_REASON.sample.short).toBe("Sample data has no history");
    expect(UNAVAILABLE_REASON.snapshot.short).toBe("Needs live data");
    for (const r of Object.values(UNAVAILABLE_REASON)) expect(r.short.split(" ").length).toBeLessThanOrEqual(5);
  });

  it("knows whether a snapshot holds as-of answers", () => {
    expect(snapshotHasAsOf([snapshotKey("globe", { window: "7d" }), snapshotKey("graph", {})])).toBe(false);
    expect(snapshotHasAsOf([snapshotKey("graph_as_of", { at: "2026-10-29" })])).toBe(true);
    expect(snapshotHasAsOf([snapshotKey("local_graph_as_of", { at: "2026-10-29", id: "region:in" })])).toBe(true);
  });
});

describe("days", () => {
  it("writes a day as chosen, in any time zone", () => {
    expect(formatDay("2026-10-29")).toBe("29 Oct 2026");
    expect(formatDay("2026-01-05")).toBe("5 Jan 2026");
  });

  it("reads when history starts from an answer or the database's error", () => {
    expect(dayOf("2026-10-29T08:15:00+00:00")).toBe("2026-10-29");
    expect(dayOf(null)).toBeNull();
    expect(historyStartFromError(new DataError("server_error", "History starts on 29 Oct 2026"))).toBe("2026-10-29");
    expect(historyStartFromError(new Error("History starts on 3 Sep 2026"))).toBe("2026-09-03");
    expect(historyStartFromError(new DataError("unavailable", "The database didn't answer."))).toBeNull();
    expect(historyStartFromError(null)).toBeNull();
  });

  it("keeps a chosen day between the start of history and today", () => {
    expect(clampDay("2026-10-01", "2026-10-29", "2026-10-30")).toBe("2026-10-29");
    expect(clampDay("2026-11-02", "2026-10-29", "2026-10-30")).toBe("2026-10-30");
    expect(clampDay("2026-10-29", null, "2026-10-30")).toBe("2026-10-29");
    expect(today(new Date(2026, 9, 30, 23, 30))).toBe("2026-10-30");
  });
});
