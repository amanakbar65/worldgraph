import { describe, expect, it } from "vitest";

import { SECTOR_IDS } from "@/api/contract";
import { emptyProfile } from "@/state/profile";

import { APPAREL, DRAFT, ITEMS, PROFILE, RUPEE, TRADE_DEAL, story } from "./fixtures";
import {
  canRankForYou,
  describeItem,
  opportunitiesArgs,
  primarySector,
  radarCaption,
  radarInputs,
  radarSectors,
  rimLabel,
  scoreNames,
  suitChips,
  summarise,
  wedgeCounts,
  whyNow,
} from "./opportunity-data";

const base = {
  sectors: [],
  profile: emptyProfile,
  forYou: true,
  placesOnly: false,
  window: "7d" as const,
  sample: undefined,
};

describe("opportunitiesArgs", () => {
  it("sends only the window when nothing narrows the list", () => {
    expect(opportunitiesArgs(base)).toEqual({ window: "7d" });
  });

  it("sends the profile only when ranking for it, and only when it holds something", () => {
    expect(opportunitiesArgs({ ...base, profile: PROFILE }).profile).toEqual(PROFILE);
    expect(opportunitiesArgs({ ...base, profile: PROFILE, forYou: false }).profile).toBeUndefined();
    expect(opportunitiesArgs({ ...base, profile: emptyProfile }).profile).toBeUndefined();
    expect(canRankForYou(emptyProfile)).toBe(false);
    expect(canRankForYou(PROFILE)).toBe(true);
  });

  it("narrows to the profile's places when asked", () => {
    const args = opportunitiesArgs({ ...base, profile: PROFILE, placesOnly: true });
    expect(args.regions).toEqual(["region:in-gj", "region:cn", "region:us"]);
    expect(opportunitiesArgs({ ...base, placesOnly: true }).regions).toBeUndefined();
  });

  it("sends the lens in the fixed sector order, and the sample setting when it's set", () => {
    const args = opportunitiesArgs({ ...base, sectors: ["tech", "energy"], sample: false });
    expect(args.sectors).toEqual(["energy", "tech"]);
    expect(args.sample).toBe(false);
  });
});

describe("radar sectors and wedges", () => {
  it("shows all nine sectors without a lens, else only the lens", () => {
    expect(radarSectors([])).toEqual([...SECTOR_IDS]);
    expect(radarSectors(["tech", "energy"])).toEqual(["energy", "tech"]);
  });

  it("puts a story in its main sector that is on the radar", () => {
    expect(primarySector(RUPEE.story, SECTOR_IDS)).toBe("finance");
    expect(primarySector(RUPEE.story, ["energy", "manufacturing"])).toBe("manufacturing");
    expect(primarySector(RUPEE.story, ["health"])).toBeNull();
    expect(primarySector(story({ id: "story:x", headline: "x", sectors: [] }), SECTOR_IDS)).toBeNull();
  });

  it("feeds the radar each story once, in list order", () => {
    const inputs = radarInputs([...ITEMS, RUPEE], SECTOR_IDS);
    expect(inputs.map((i) => i.id)).toEqual(ITEMS.map((i) => i.story.id));
    expect(inputs[0]).toEqual({ id: RUPEE.story.id, sector: "finance", relevance: 0.77, momentum: 0.84 });
    expect(wedgeCounts(inputs)).toEqual({ finance: 1, "logistics-trade": 1, manufacturing: 1, energy: 1 });
  });

  it("shortens long sector names only when the arc is too short", () => {
    expect(rimLabel("logistics-trade", 200)).toBe("Logistics and trade");
    expect(rimLabel("logistics-trade", 80)).toBe("Logistics");
    expect(rimLabel("agri-food", 60)).toBe("Agri-food");
    expect(rimLabel("energy", 10)).toBe("Energy");
  });
});

describe("words", () => {
  it("names the scores for the profile, or in general", () => {
    expect(scoreNames(true)).toEqual({ relevance: "Fit", momentum: "Momentum" });
    expect(scoreNames(false).relevance).toBe("Importance");
    expect(radarCaption("relevance", true)).toBe(
      "Closer to the centre: a better fit for your business. Bigger dot: gaining pace faster.",
    );
    expect(radarCaption("momentum", false)).toBe("Closer to the centre: gaining pace faster. Bigger dot: more important.");
  });

  it("describes a dot for screen readers, with the crowd forecast and sample label", () => {
    expect(describeItem(RUPEE, "finance", true)).toBe(
      "Rupee firms as a softer dollar draws funds into India, Finance, fit 77%, momentum 84%, crowd forecast 29% from Manifold, sample data",
    );
    expect(describeItem(APPAREL, "manufacturing", false)).toContain(", projected, importance 39%");
    expect(describeItem(DRAFT, "energy", true)).toContain("draft awaiting analysis");
  });

  it("turns sector names in 'suits' into sector chips, once each", () => {
    expect(suitChips(["Logistics and Trade", "Manufacturing", "Apparel and textiles", "manufacturing", " "])).toEqual([
      { label: "Logistics and trade", sector: "logistics-trade" },
      { label: "Manufacturing", sector: "manufacturing" },
      { label: "Apparel and textiles", sector: null },
    ]);
    expect(suitChips(["Agri & Food", "Real Estate"]).map((c) => c.sector)).toEqual(["agri-food", "real-estate"]);
  });

  it("never shows a 'why now' for a draft, or one that only repeats the headline", () => {
    expect(whyNow(RUPEE)).toBe(RUPEE.why_now);
    expect(whyNow(DRAFT)).toBeNull();
    expect(whyNow({ ...TRADE_DEAL, why_now: TRADE_DEAL.story.headline })).toBeNull();
  });

  it("summarises the list", () => {
    expect(summarise(ITEMS)).toEqual({ total: 4, projected: 1, withForecast: 1, sample: true });
    expect(summarise([DRAFT])).toEqual({ total: 1, projected: 0, withForecast: 0, sample: false });
  });
});
