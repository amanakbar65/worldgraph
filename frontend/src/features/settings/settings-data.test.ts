import { describe, expect, it } from "vitest";

import type { MetaResponse } from "@/api/contract";

import {
  ABOUT_TEXT,
  aiCostLine,
  aiRow,
  bordersExplanation,
  dataSummary,
  formatCount,
  ingestLine,
  sampleExplanation,
  sampleNow,
  storeCopy,
} from "./settings-data";

const DATA: MetaResponse["data"] = {
  live_stories: 1041,
  sample_stories: 171,
  forecasts: 31,
  entities: 5676,
  last_ingest_at: "2026-10-15T08:48:00Z",
  showing_sample: false,
};
const NOW = Date.parse("2026-10-15T09:00:00Z");

describe("explanations", () => {
  it("explains each sample-data choice in one line", () => {
    expect(sampleExplanation("auto")).toBe("Shown only while there is no live news yet, then hidden.");
    expect(sampleExplanation("on")).toContain("labelled “Sample data”");
    expect(sampleExplanation("off")).toContain("Never shown");
  });

  it("says what Auto is showing right now", () => {
    expect(sampleNow(DATA)).toBe("Right now: live news only.");
    expect(sampleNow({ ...DATA, showing_sample: true })).toContain("sample data");
    expect(sampleNow(undefined)).toBeNull();
  });

  it("explains each border choice, and what Auto picked", () => {
    expect(bordersExplanation("india", false)).toContain("as India officially defines them");
    expect(bordersExplanation("international", true)).toContain("international default");
    expect(bordersExplanation("auto", true)).toMatch(/^India's official view, because your time zone is in India/);
    expect(bordersExplanation("auto", false)).toMatch(/^International borders here/);
  });
});

describe("AI", () => {
  it("says what each engine costs", () => {
    expect(aiCostLine("artifact")).toBe("Uses your Claude account while the app is open");
    expect(aiCostLine("api")).toBe("WorldGraph AI, daily limit");
    expect(aiCostLine("none")).toBe("Not available in this view");
  });

  it("names the engine without repeating itself", () => {
    expect(aiRow({ kind: "artifact", label: "Your Claude account" })).toMatchObject({
      title: "Your Claude account",
      cost: "Uses your Claude account while the app is open",
    });
    const web = aiRow({ kind: "api", label: "WorldGraph AI" });
    expect(web.title).toBe("WorldGraph AI, daily limit");
    expect(web.cost).not.toContain("WorldGraph AI");
    expect(aiRow({ kind: "none", label: "AI unavailable" })).toMatchObject({
      title: "AI unavailable",
      cost: "Not available in this view",
    });
  });
});

describe("where personal data is kept", () => {
  it("names the store in plain words", () => {
    expect(storeCopy("cloud").title).toBe("Saved to your Claude account");
    expect(storeCopy("browser").title).toBe("Saved in this browser");
    expect(storeCopy("memory").title).toBe("Kept for this visit only");
  });
});

describe("data summary", () => {
  it("counts live and sample stories and crowd forecasts", () => {
    expect(dataSummary(DATA, "en-US")).toBe("1,041 live stories · 171 sample stories · 31 crowd forecasts");
    expect(dataSummary({ ...DATA, live_stories: 1, sample_stories: 0, forecasts: 1 }, "en-US")).toBe(
      "1 live story · 1 crowd forecast",
    );
  });

  it("groups digits the viewer's way", () => {
    expect(formatCount(104_100, "en-IN")).toBe("1,04,100");
  });

  it("says when news was last checked, or that it hasn't arrived", () => {
    expect(ingestLine(DATA, NOW)).toBe("News last checked 12 min ago.");
    expect(ingestLine({ ...DATA, last_ingest_at: null }, NOW)).toBe("Live news hasn't arrived yet.");
  });
});

describe("about", () => {
  it("is one calm paragraph that keeps facts, inferences and forecasts apart", () => {
    expect(ABOUT_TEXT.split("\n")).toHaveLength(1);
    expect(ABOUT_TEXT).toContain("Facts come from named sources");
    expect(ABOUT_TEXT).toContain("type and confidence");
    expect(ABOUT_TEXT).toContain("Crowd forecasts are estimates");
    expect(ABOUT_TEXT).not.toMatch(/\b(bet|betting|trade|trading|wager)\b/i);
  });
});
