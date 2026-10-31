import { describe, expect, it } from "vitest";

import { openingSnap, SHEET_HEIGHT, shownHeight, SNAP_POINTS, snapForFocus } from "./panel-snap";

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

describe("sheet heights on screen", () => {
  const screen = 800;

  it("shows half the screen at half height", () => {
    expect(shownHeight(HALF, screen)).toBeCloseTo(400);
  });

  it("shows the whole sheet at full height, so its last lines can be scrolled into view", () => {
    expect(shownHeight(FULL, screen)).toBeCloseTo(SHEET_HEIGHT * screen);
  });
});

describe("snapForFocus (focus below a half-height sheet)", () => {
  const screen = 800; // half height shows the sheet's top 400 px

  it("raises the sheet to full height when focus lands below what shows", () => {
    expect(snapForFocus(HALF, { top: 480, bottom: 520 }, screen)).toBe(FULL);
    expect(snapForFocus(HALF, { top: 380, bottom: 420 }, screen)).toBe(FULL);
  });

  it("leaves it where focus is already in view", () => {
    expect(snapForFocus(HALF, { top: 8, bottom: 48 }, screen)).toBeNull();
    expect(snapForFocus(HALF, { top: 360, bottom: 399 }, screen)).toBeNull();
  });

  it("leaves it when what took focus is taller than what shows and starts in view (the sheet, its scroll area)", () => {
    expect(snapForFocus(HALF, { top: 0, bottom: 752 }, screen)).toBeNull();
    expect(snapForFocus(HALF, { top: 60, bottom: 752 }, screen)).toBeNull();
  });

  it("leaves a full-height sheet alone", () => {
    expect(snapForFocus(FULL, { top: 700, bottom: 740 }, screen)).toBeNull();
    expect(snapForFocus(null, { top: 700, bottom: 740 }, screen)).toBeNull();
  });
});
