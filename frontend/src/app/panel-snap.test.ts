import { describe, expect, it } from "vitest";

import { openingSnap, SNAP_POINTS, snapForFocus } from "./panel-snap";

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

describe("snapForFocus (focus below a half-height sheet)", () => {
  const screen = 800; // half height shows the sheet's top 400 px

  it("raises the sheet to full height when focus lands below what shows", () => {
    expect(snapForFocus(HALF, 520, screen)).toBe(FULL);
    expect(snapForFocus(HALF, 401, screen)).toBe(FULL);
  });

  it("leaves it where focus is already in view", () => {
    expect(snapForFocus(HALF, 48, screen)).toBeNull();
    expect(snapForFocus(HALF, 400, screen)).toBeNull();
  });

  it("leaves a full-height sheet alone", () => {
    expect(snapForFocus(FULL, 740, screen)).toBeNull();
    expect(snapForFocus(null, 740, screen)).toBeNull();
  });
});
