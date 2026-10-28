import { describe, expect, it } from "vitest";

import { ENTITY_TYPES, Impact, LinkType, SECTOR_IDS } from "@/api/contract";

import {
  DEFAULT_EVENT_ICON,
  ENTITY_TYPE_ICONS,
  EVENT_TYPE_ICONS,
  IMPACT_ICONS,
  SECTORS,
  eventTypeIcon,
  eventTypeLabel,
  iconByName,
} from "./icons";
import { safeHttpUrl } from "./links";
import {
  ENTITY_TYPE_TONES,
  IMPACT_TONES,
  LINK_TYPES,
  TRUST_OPACITY,
  TRUST_WIDTH,
  WEAK_CONFIDENCE,
  balanceLean,
  describeForecast,
  isWeak,
  kpiChangeImpact,
  trustVisual,
} from "./meaning";
import { cn } from "./utils";

describe("icons", () => {
  it("covers every sector, with the icon names stored in sectors.yaml", () => {
    expect(Object.keys(SECTORS).sort()).toEqual([...SECTOR_IDS].sort());
    expect(SECTORS.energy.name).toBe("zap");
    expect(SECTORS["real-estate"].name).toBe("building-2");
    expect(iconByName("heart-pulse")).toBe(SECTORS.health.icon);
  });

  it("covers every entity type and impact", () => {
    expect(Object.keys(ENTITY_TYPE_ICONS).sort()).toEqual([...ENTITY_TYPES].sort());
    expect(Object.keys(IMPACT_ICONS).sort()).toEqual([...Impact.options].sort());
    expect(IMPACT_ICONS.risk.name).toBe("circle-alert");
    expect(IMPACT_ICONS.opportunity.name).toBe("sparkles");
    expect(ENTITY_TYPE_ICONS.forecast.name).toBe("users");
  });

  it("finds event types in any spelling and falls back for unknown ones", () => {
    expect(eventTypeIcon("price-move")).toBe(EVENT_TYPE_ICONS["price-move"].icon);
    expect(eventTypeIcon("Price move")).toBe(EVENT_TYPE_ICONS["price-move"].icon);
    expect(eventTypeIcon("extreme_weather")).toBe(EVENT_TYPE_ICONS["extreme-weather"].icon);
    expect(eventTypeIcon("something-new")).toBe(DEFAULT_EVENT_ICON.icon);
    expect(eventTypeIcon(null)).toBe(DEFAULT_EVENT_ICON.icon);
    expect(eventTypeLabel("policy-decision")).toBe("Policy decision");
  });
});

describe("meaning", () => {
  it("has a tone for every impact and entity type", () => {
    expect(Object.keys(IMPACT_TONES).sort()).toEqual([...Impact.options].sort());
    expect(Object.keys(ENTITY_TYPE_TONES).sort()).toEqual([...ENTITY_TYPES].sort());
    expect(IMPACT_TONES.risk.cssVar).toBe("--risk");
    expect(ENTITY_TYPE_TONES.user_entity.cssVar).toBe("--type-user");
  });

  it("draws reported links solid, inferred dashed, projected and conditional dotted", () => {
    expect(Object.keys(LINK_TYPES).sort()).toEqual([...LinkType.options].sort());
    expect(LINK_TYPES.reported.line).toBe("solid");
    expect(LINK_TYPES.inferred.line).toBe("dashed");
    expect(LINK_TYPES.projected.line).toBe("dotted");
    expect(LINK_TYPES.conditional.line).toBe("dotted");
  });

  it("draws the two projections with different patterns, so they read apart without colour", () => {
    const patterns = Object.values(LINK_TYPES).map((t) => t.dasharray ?? "solid");
    expect(new Set(patterns).size).toBe(patterns.length);
    // Projected: dots only. Conditional: a dot, then a dash.
    expect(LINK_TYPES.projected.dasharray?.split(" ")).toHaveLength(2);
    const [dot, , dash] = (LINK_TYPES.conditional.dasharray ?? "").split(" ").map(Number);
    expect(dash).toBeGreaterThan(dot * 4);
  });

  it("colours KPI changes by what higher means", () => {
    expect(kpiChangeImpact(0.3, "worse")).toBe("risk");
    expect(kpiChangeImpact(-0.3, "worse")).toBe("opportunity");
    expect(kpiChangeImpact(1.1, "better")).toBe("opportunity");
    expect(kpiChangeImpact(-1.1, "better")).toBe("risk");
    expect(kpiChangeImpact(6, "neutral")).toBe("neutral");
    expect(kpiChangeImpact(null, "worse")).toBe("neutral");
    expect(kpiChangeImpact(0, "better")).toBe("neutral");
  });

  it("describes forecasts for screen readers", () => {
    expect(describeForecast(0.62, 0.08)).toBe("62% crowd forecast, up 8 points in 24 hours");
    expect(describeForecast(0.31, -0.01, true)).toBe(
      "31% crowd forecast, down 1 point in 24 hours, thin market",
    );
    expect(describeForecast(0.5, 0)).toBe("50% crowd forecast, unchanged in 24 hours");
    expect(describeForecast(0.5, null)).toBe("50% crowd forecast");
  });
});

describe("trust at a glance (one mapping for every view)", () => {
  it("makes links thicker the stronger they are, using confidence until a strength arrives", () => {
    const weak = trustVisual({ confidence: 0.2 });
    const strong = trustVisual({ confidence: 0.9 });
    expect(strong.width).toBeGreaterThan(weak.width);
    expect(trustVisual({ confidence: 0 }).width).toBe(TRUST_WIDTH.min);
    expect(trustVisual({ confidence: 1 }).width).toBe(TRUST_WIDTH.max);
    // Strength wins for width; confidence still sets the opacity.
    const sureButSlight = trustVisual({ confidence: 0.9, strength: 0.1 });
    expect(sureButSlight.width).toBeLessThan(weak.width);
    expect(sureButSlight.weight).toBe(0.1);
    expect(sureButSlight.opacity).toBe(strong.opacity);
    expect(trustVisual({ confidence: 0.6, strength: null }).width).toBe(
      trustVisual({ confidence: 0.6 }).width,
    );
  });

  it("makes links more transparent the less sure we are", () => {
    expect(trustVisual({ confidence: 0.9 }).opacity).toBeGreaterThan(
      trustVisual({ confidence: 0.4 }).opacity,
    );
    expect(trustVisual({ confidence: 0 }).opacity).toBe(TRUST_OPACITY.min);
    expect(trustVisual({ confidence: 1 }).opacity).toBe(TRUST_OPACITY.max);
    expect(trustVisual({ confidence: 7 }).opacity).toBe(TRUST_OPACITY.max);
  });

  it("keeps the line pattern of each link type", () => {
    expect(trustVisual({ confidence: 0.7, linkType: "reported" })).toMatchObject({
      line: "solid",
      dash: undefined,
    });
    expect(trustVisual({ confidence: 0.7, linkType: "inferred" })).toMatchObject({
      line: "dashed",
      dash: LINK_TYPES.inferred.dasharray,
    });
    expect(trustVisual({ confidence: 0.7, linkType: "conditional" }).dash).toBe(
      LINK_TYPES.conditional.dasharray,
    );
    expect(trustVisual({ confidence: 0.7 }).line).toBe("solid");
  });

  it("marks weak or unknown confidence with a '?'", () => {
    expect(WEAK_CONFIDENCE).toBe(0.5);
    expect(trustVisual({ confidence: 0.49 }).weak).toBe(true);
    expect(trustVisual({ confidence: 0.5 }).weak).toBe(false);
    expect(isWeak(null)).toBe(true);
    expect(isWeak(undefined)).toBe(true);
    expect(isWeak(Number.NaN)).toBe(true);
    // Unknown confidence draws as middling, never as certain.
    const unknown = trustVisual({ confidence: null });
    expect(unknown.weak).toBe(true);
    expect(unknown.opacity).toBeLessThan(TRUST_OPACITY.max);
    expect(unknown.width).toBe(trustVisual({ confidence: 0.5 }).width);
  });

  it("says which way a place leans, with ▲ ▼ and words", () => {
    expect(balanceLean(0.6)).toEqual({ impact: "opportunity", glyph: "▲", label: "Leans opportunity" });
    expect(balanceLean(-0.4)).toEqual({ impact: "risk", glyph: "▼", label: "Leans risk" });
    expect(balanceLean(0.1)).toEqual({ impact: "neutral", glyph: null, label: "Balanced" });
    expect(balanceLean(null).impact).toBe("neutral");
  });
});

describe("helpers", () => {
  it("keeps our text sizes when a text colour follows", () => {
    expect(cn("text-label text-fg-muted")).toBe("text-label text-fg-muted");
    expect(cn("text-figure", "text-fg")).toBe("text-figure text-fg");
    expect(cn("text-label", "text-body")).toBe("text-body");
    expect(cn("text-fg-muted", "text-fg")).toBe("text-fg");
  });

  it("only links plain web URLs", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
