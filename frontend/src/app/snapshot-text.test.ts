import { describe, expect, it } from "vitest";

import { reasonText, snapshotText } from "./snapshot-text";
import { DataError } from "@/api/source";

describe("snapshotText", () => {
  const now = Date.parse("2026-10-22T15:30:00Z");

  it("gives a live snapshot its time, in full and as an age", () => {
    const text = snapshotText("live", "2026-10-22T12:05:00Z", now, "en-GB");
    expect(text.long).toMatch(/^Snapshot as of 22 Oct, \d{1,2}:\d{2}$/);
    expect(text.short).toBe("Snapshot · 3 h ago");
  });

  it("adds the year when it isn't this one", () => {
    expect(snapshotText("live", "2025-12-30T12:00:00Z", now, "en-GB").long).toMatch(/2025/);
  });

  it("never calls a snapshot live data", () => {
    for (const kind of ["live", "sample", null] as const) {
      const text = snapshotText(kind, "2026-10-22T12:05:00Z", now);
      expect(`${text.long} ${text.short}`).not.toMatch(/live/i);
    }
  });

  it("says so when the snapshot is sample data, or has no readable time", () => {
    expect(snapshotText("sample", "2026-10-22T12:05:00Z", now)).toEqual({
      long: "Sample snapshot",
      short: "Sample snapshot",
    });
    expect(snapshotText("live", null, now)).toEqual({ long: "Snapshot", short: "Snapshot" });
  });
});

describe("reasonText", () => {
  it("doesn't claim sample data is showing when approval was declined", () => {
    expect(
      reasonText(
        new DataError("not_allowed", "Live data wasn't approved, so WorldGraph is showing sample data."),
      ),
    ).toBe("Live data wasn't approved.");
  });

  it("passes on the connector's advice otherwise", () => {
    const missing = new DataError(
      "connector_missing",
      "Add the Supabase connector in claude.ai Settings → Connectors.",
    );
    expect(reasonText(missing)).toBe(missing.message);
  });
});
