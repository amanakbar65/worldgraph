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
import { ENTITY_TYPE_TONES, IMPACT_TONES, LINK_TYPES, describeForecast, kpiChangeImpact } from "./meaning";
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
    expect(describeForecast(0.31, -0.01, true)).toBe("31% crowd forecast, down 1 point in 24 hours, thin market");
    expect(describeForecast(0.5, 0)).toBe("50% crowd forecast, unchanged in 24 hours");
    expect(describeForecast(0.5, null)).toBe("50% crowd forecast");
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
