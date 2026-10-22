import { describe, expect, it } from "vitest";

import { openingSnap, SNAP_POINTS } from "./panel-snap";

const [HALF, FULL] = SNAP_POINTS;

describe("openingSnap (phone sheet heights)", () => {
  it("opens Ask and the cascade at full height, so an answer or a chain isn't below the fold", () => {
    expect(openingSnap("ask", null)).toBe(FULL);
    expect(openingSnap("cascade", null)).toBe(FULL);
    expect(openingSnap("cascade", "story")).toBe(FULL);
  });

  it("opens other panels at half height, over the map", () => {
    expect(openingSnap("story", null)).toBe(HALF);
    expect(openingSnap("region", null)).toBe(HALF);
  });

  it("keeps the viewer's height when one panel follows another", () => {
    expect(openingSnap("story", "region")).toBeNull();
    expect(openingSnap("entity", "ask")).toBeNull();
  });

  it("starts at half height again after the sheet closes", () => {
    expect(openingSnap(null, "ask")).toBe(HALF);
  });
});
