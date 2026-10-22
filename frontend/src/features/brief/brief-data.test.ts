import { describe, expect, it } from "vitest";

import {
  BRIEF_ORDER,
  briefAsText,
  briefDate,
  cardItems,
  cardsByKind,
  isBriefEmpty,
  isCardEmpty,
  sampleShare,
  spotlightImpact,
  usableProfile,
} from "./brief-data";
import { BRIEF, DRAFT, EMPTY_BRIEF, FOCUS, OPEC_FORECAST, PROFILE, RISK, SAMPLE_FORECAST } from "./fixtures";

describe("brief cards", () => {
  it("has six cards in a fixed order", () => {
    expect(BRIEF_ORDER).toEqual([
      "top_risks",
      "top_opportunities",
      "biggest_movers",
      "odds_moved",
      "cascade_to_watch",
      "region_spotlight",
    ]);
  });

  it("finds cards by kind whatever order they arrive in", () => {
    const cards = cardsByKind({ ...BRIEF, cards: [...BRIEF.cards].reverse() });
    expect(cards.top_risks?.stories[0].id).toBe(RISK.id);
    expect(cards.cascade_to_watch?.focus?.id).toBe(FOCUS.id);
  });

  it("counts a card's items: stories, forecasts or the cascade's focus", () => {
    const cards = cardsByKind(BRIEF);
    expect(cardItems(cards.odds_moved)).toHaveLength(2);
    expect(cardItems(cards.cascade_to_watch)).toEqual([FOCUS]);
    expect(isCardEmpty(undefined)).toBe(true);
    expect(isCardEmpty({ kind: "cascade_to_watch", focus: null, effects: 0 })).toBe(true);
  });

  it("knows when the whole brief is empty", () => {
    expect(isBriefEmpty(EMPTY_BRIEF)).toBe(true);
    expect(isBriefEmpty(BRIEF)).toBe(false);
  });

  it("says whether all, some or none of it is sample data", () => {
    expect(sampleShare(BRIEF)).toBe("some");
    const allSample = { ...BRIEF, cards: BRIEF.cards.filter((c) => c.kind !== "biggest_movers" && c.kind !== "odds_moved") };
    expect(sampleShare(allSample)).toBe("all");
    expect(sampleShare(EMPTY_BRIEF)).toBe("none");
  });

  it("reads a spotlight score as mostly risk, mostly opportunity or mixed", () => {
    expect(spotlightImpact(0.4)).toEqual({ impact: "opportunity", label: "Mostly opportunity" });
    expect(spotlightImpact(-0.5)).toEqual({ impact: "risk", label: "Mostly risk" });
    expect(spotlightImpact(0.1)).toEqual({ impact: "neutral", label: "Mixed" });
  });

  it("writes the date in the viewer's locale", () => {
    expect(briefDate(BRIEF.generated_at, "en-GB")).toBe("Thursday 15 October");
    expect(briefDate("not a date")).toBe("");
  });
});

describe("usableProfile", () => {
  it("accepts a saved profile that says something, without its name", () => {
    expect(usableProfile(PROFILE)).toEqual({ ...PROFILE, name: null });
  });

  it("ignores an empty or malformed profile", () => {
    const empty = { ...PROFILE, sectors: [], locations: [], inputs: [], markets: [] };
    expect(usableProfile(empty)).toBeNull();
    expect(usableProfile({ sectors: ["not-a-sector"] })).toBeNull();
    expect(usableProfile(null)).toBeNull();
  });
});

describe("briefAsText", () => {
  const text = briefAsText(BRIEF, { locale: "en-GB", profileUsed: true });

  it("starts with the date and where it comes from", () => {
    const [title, note] = text.split("\n");
    expect(title).toBe("WorldGraph daily brief · Thursday 15 October");
    expect(note).toBe("Generated from stored data · tuned to your business · includes sample data");
  });

  it("lists each card in order, with headlines and why they matter", () => {
    const headings = text.split("\n").filter((l) => l === l.toUpperCase() && /[A-Z]/.test(l));
    expect(headings).toEqual([
      "TOP RISKS",
      "TOP OPPORTUNITIES",
      "MOST REPORTED",
      "CROWD FORECASTS THAT MOVED",
      "CASCADE TO WATCH",
      "REGION SPOTLIGHT",
    ]);
    expect(text).toContain(`- ${RISK.headline} (India) [sample data]\n  Why it matters: ${RISK.so_what}`);
  });

  it("tags each invented item when sample data sits beside live news", () => {
    expect(DRAFT.is_sample).toBe(false);
    expect(OPEC_FORECAST.is_sample).toBe(false);
    const lines = text.split("\n");
    for (const s of [RISK, FOCUS]) {
      expect(lines.find((l) => l.startsWith(`- ${s.headline}`))).toContain("[sample data]");
    }
    expect(lines.find((l) => l.startsWith(`- ${SAMPLE_FORECAST.short_title}`))).toContain("[sample data]");
    // Live items carry no tag.
    expect(lines.find((l) => l.startsWith(`- ${DRAFT.headline}`))).not.toContain("sample");
    expect(lines.find((l) => l.startsWith(`- ${OPEC_FORECAST.short_title}`))).not.toContain("sample");
  });

  it("says sample once at the top when everything is sample", () => {
    const all = {
      ...BRIEF,
      cards: BRIEF.cards.filter((c) => c.kind !== "biggest_movers" && c.kind !== "odds_moved"),
    };
    const allText = briefAsText(all, { locale: "en-GB" });
    expect(allText.split("\n")[1]).toBe("Generated from stored data · sample data, not real events");
    expect(allText).not.toContain("[sample data]");
  });

  it("marks drafts and never invents a so-what for them", () => {
    expect(text).toContain(`- ${DRAFT.headline} (India) [draft, awaiting analysis]`);
    expect(text).not.toContain(DRAFT.so_what!);
  });

  it("gives forecasts as crowd forecasts with provider, volume and update time", () => {
    expect(text).toContain("Crowd forecasts are estimates, not facts.");
    const line = text.split("\n").find((l) => l.startsWith(`- ${OPEC_FORECAST.short_title}`))!;
    expect(line).toContain("62% crowd forecast");
    expect(line).toContain("▲ 5 points in 24 h");
    expect(line).toContain("Manifold");
    expect(line).toContain("52.3K MANA volume");
    expect(line).toContain("updated ");
    expect(text).not.toMatch(/\b(bet|betting|wager|trade on|odds to win)\b/i);
  });

  it("describes the cascade and the region spotlight", () => {
    expect(text).toContain("  Sets off 6 linked effects");
    expect(text).toContain("India: mostly opportunity");
  });

  it("says so for empty cards", () => {
    const empty = briefAsText(EMPTY_BRIEF, { locale: "en-GB" });
    expect(empty).toContain("No risks stand out right now.");
    expect(empty.split("\n")[1]).toBe("Generated from stored data");
  });
});
