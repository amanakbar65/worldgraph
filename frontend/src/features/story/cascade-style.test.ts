import { describe, expect, it } from "vitest";

import { TRUST_WIDTH, trustVisual } from "@/lib/meaning";

import { CASCADE_WIDTH_SCALE, confidenceWords, edgeLook, lagText, linkSummary, linkTypeExplanation } from "./cascade-style";
import { FORECAST } from "./fixtures";

describe("edgeLook", () => {
  it("draws reported links solid, inferred dashed, projected and conditional dotted", () => {
    expect(edgeLook("reported", 0.8)).toMatchObject({ line: "solid", dasharray: undefined });
    expect(edgeLook("inferred", 0.8)).toMatchObject({ line: "dashed" });
    expect(edgeLook("inferred", 0.8).dasharray).toMatch(/^\d+(\.\d)? \d+(\.\d)?$/);
    expect(edgeLook("projected", 0.8)).toMatchObject({ line: "dotted" });
    expect(edgeLook("projected", 0.8).dasharray).toMatch(/^0\.01 /);
    expect(edgeLook("conditional", 0.8)).toMatchObject({ line: "dotted" });
  });

  it("puts a dash between the dots of conditional links, so they differ from projected ones without colour", () => {
    const projected = edgeLook("projected", 0.6).dasharray;
    const conditional = edgeLook("conditional", 0.6).dasharray;
    expect(conditional).not.toBe(projected);
    expect(conditional).toMatch(/^0\.01 \d+(\.\d)? \d+(\.\d)? \d+(\.\d)?$/);
  });

  it("gives conditional links the forecast violet and the rest a quiet grey", () => {
    expect(edgeLook("conditional", 0.5)).toMatchObject({ tone: "forecast", strokeClass: "stroke-forecast" });
    expect(edgeLook("reported", 0.5)).toMatchObject({ tone: "muted", strokeClass: "stroke-fg-muted" });
  });

  it("uses the shared trust look: surer is stronger, a stronger effect is thicker", () => {
    const low = edgeLook("reported", 0.2);
    const high = edgeLook("reported", 0.9);
    expect(high.width).toBeGreaterThan(low.width);
    expect(high.opacity).toBeGreaterThan(low.opacity);
    // The same mapping as every other view (trustVisual), drawn a little heavier in the flow.
    const shared = trustVisual({ confidence: 0.7, linkType: "inferred" });
    expect(edgeLook("inferred", 0.7).opacity).toBe(shared.opacity);
    expect(edgeLook("inferred", 0.7).width).toBeCloseTo(shared.width * CASCADE_WIDTH_SCALE, 2);
    expect(edgeLook("reported", 0).width).toBeCloseTo(TRUST_WIDTH.min * CASCADE_WIDTH_SCALE, 2);
    expect(edgeLook("reported", 1).width).toBeCloseTo(TRUST_WIDTH.max * CASCADE_WIDTH_SCALE, 2);
    expect(edgeLook("reported", 5).opacity).toBeLessThanOrEqual(1);
  });

  it("takes width from strength and opacity from confidence when both are known", () => {
    const strongButUnsure = edgeLook("reported", 0.3, 1);
    const weakButSure = edgeLook("reported", 0.9, 0.1);
    expect(strongButUnsure.width).toBeGreaterThan(weakButSure.width);
    expect(strongButUnsure.opacity).toBeLessThan(weakButSure.opacity);
  });

  it("scales the dash pattern with the line", () => {
    const thin = edgeLook("inferred", 0).dasharray!.split(" ").map(Number);
    const thick = edgeLook("inferred", 1).dasharray!.split(" ").map(Number);
    expect(thick[0]).toBeGreaterThan(thin[0]);
  });
});

describe("words", () => {
  it("says confidence in words with the number", () => {
    expect(confidenceWords(0.85)).toBe("High confidence (85%)");
    expect(confidenceWords(0.6)).toBe("Fair confidence (60%)");
    expect(confidenceWords(0.45)).toBe("Moderate confidence (45%)");
    expect(confidenceWords(0.1)).toBe("Low confidence (10%)");
  });

  it("explains each link type plainly", () => {
    expect(linkTypeExplanation("reported")).toMatch(/source reports/);
    expect(linkTypeExplanation("inferred")).toMatch(/No source says so/);
    expect(linkTypeExplanation("projected")).toMatch(/hasn't happened/);
    expect(linkTypeExplanation("conditional", { forecast: FORECAST, outcome: "NO", probability: 0.69 })).toBe(
      "Happens only if the crowd forecast resolves NO. The crowd puts that at 69%.",
    );
    expect(linkTypeExplanation("projected", null, true)).toMatch(/not news/);
  });

  it("says when the effect shows", () => {
    expect(lagText(null)).toBeNull();
    expect(lagText(1)).toBe("Within a day");
    expect(lagText(7)).toBe("About 7 days later");
    expect(lagText(30)).toBe("About 4 weeks later");
    expect(lagText(120)).toBe("About 4 months later");
  });

  it("names a link for screen readers", () => {
    expect(linkSummary({ mechanism: "raises delivered costs", link_type: "reported", confidence: 0.7 })).toBe(
      "Raises delivered costs: reported link, fair confidence (70%).",
    );
    expect(
      linkSummary(
        { mechanism: "keeps routes long", link_type: "conditional", confidence: 0.55 },
        { forecast: FORECAST, outcome: "NO", probability: 0.69 },
      ),
    ).toMatch(/If NO · 69% crowd forecast\.$/);
  });
});
