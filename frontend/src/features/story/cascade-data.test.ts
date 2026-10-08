import { describe, expect, it } from "vitest";

import type { ProjectedEffect } from "@/ai/schemas";

import {
  branchLabel,
  countryName,
  directLinks,
  horizonFromLag,
  isAiId,
  listSections,
  projectionElements,
  projectionInput,
  projectionRegions,
  shapeCascade,
} from "./cascade-data";
import { CASCADE, EGYPT, FOCUS_ID, FORECAST, SHANGHAI } from "./fixtures";

const EFFECTS: ProjectedEffect[] = [
  {
    headline: "Air freight demand may rise for urgent parts",
    so_what: "Manufacturers with tight schedules would pay more to fly components.",
    impact: "risk",
    direction: "up",
    sectors: ["logistics-trade"],
    region_id: "region:cn-sh",
    mechanism: "shifts urgent cargo",
    lag_days: 10,
    confidence: 0.45,
  },
  {
    headline: "Turkish suppliers may win more European orders",
    so_what: "Buyers seeking shorter routes could move orders to nearer suppliers.",
    impact: "opportunity",
    direction: "up",
    sectors: ["manufacturing"],
    region_id: "region:zz",
    mechanism: "favours nearer suppliers",
    lag_days: 90,
    confidence: 0.9,
  },
];

describe("shapeCascade", () => {
  const model = shapeCascade(CASCADE);

  it("keeps every story once, with its depth and role", () => {
    expect(model.nodes).toHaveLength(8);
    expect(model.focus).toBe(FOCUS_ID);
    expect(model.focusStory?.headline).toMatch(/container rates jump/);
    const focus = model.nodes.find((n) => n.id === FOCUS_ID)!;
    expect(focus).toMatchObject({ depth: 0, role: "focus", ai: false });
    expect(model.nodes.find((n) => n.id === "story:red-sea-attacks-reroute")?.role).toBe("cause");
    expect(model.nodes.find((n) => n.id === "story:europe-retail-restock-delays")?.role).toBe("effect");
    expect(model.minDepth).toBe(-1);
    expect(model.maxDepth).toBe(2);
    expect(model.causes).toBe(2);
    expect(model.effects).toBe(5);
    expect(model.hasSample).toBe(true);
  });

  it("orders stories by depth, then importance", () => {
    const depths = model.nodes.map((n) => n.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    const ones = model.nodes.filter((n) => n.depth === 1).map((n) => n.story.importance);
    expect(ones).toEqual([...ones].sort((a, b) => b - a));
  });

  it("drops links to stories that aren't in view, and dedupes", () => {
    expect(model.edges.map((e) => e.link.id)).not.toContain(999);
    const twice = shapeCascade({ ...CASCADE, links: [...CASCADE.links, CASCADE.links[0]] });
    expect(twice.edges).toHaveLength(model.edges.length);
  });

  it("attaches the forecast branch to conditional links", () => {
    const yes = model.edges.find((e) => e.link.id === 201)!;
    expect(yes.branch).toMatchObject({ outcome: "YES", probability: 0.31 });
    expect(yes.branch?.forecast.id).toBe(FORECAST.id);
    expect(model.edges.find((e) => e.link.id === 176)?.branch).toBeNull();
  });

  it("groups If YES / If NO effects in one lane box per forecast and column, YES first", () => {
    expect(model.groups).toHaveLength(1);
    const [group] = model.groups;
    expect(group).toMatchObject({ kind: "branch", depth: 1 });
    expect(group.sections.map((s) => s.label)).toEqual(["If YES · 31%", "If NO · 69%"]);
    expect(group.sections[0].ids).toEqual(["story:freight-rates-ease-on-return"]);
    expect(model.nodes.find((n) => n.id === "story:surcharges-persist")?.groupId).toBe(group.id);
    expect(model.nodes.find((n) => n.id === "story:rotterdam-congestion")?.groupId).toBeNull();
  });

  it("adds AI projections as a lane of effects of the focus", () => {
    const regions = projectionRegions(model);
    const projected = shapeCascade(CASCADE, projectionElements(FOCUS_ID, EFFECTS, regions));
    const ai = projected.nodes.filter((n) => n.ai);
    expect(ai).toHaveLength(2);
    expect(ai.every((n) => n.depth === 1 && n.role === "projection" && isAiId(n.id))).toBe(true);
    expect(projected.groups.find((g) => g.kind === "ai")?.sections[0].ids).toEqual(ai.map((n) => n.id));
    // Counts are about the stored cascade only.
    expect(projected.effects).toBe(model.effects);
    const links = projected.edges.filter((e) => e.ai);
    expect(links).toHaveLength(2);
    expect(links.every((e) => e.link.src === FOCUS_ID && e.link.link_type === "projected")).toBe(true);
  });
});

describe("projectionElements", () => {
  const { stories, links } = projectionElements(FOCUS_ID, [...EFFECTS, EFFECTS[0], EFFECTS[1]], [SHANGHAI]);

  it("keeps at most three, capped at 50% confidence", () => {
    expect(stories).toHaveLength(3);
    expect(stories[1].confidence).toBe(0.5);
    expect(links[1].confidence).toBe(0.5);
  });

  it("only places effects in regions it was offered", () => {
    expect(stories[0].region?.name).toBe("Shanghai");
    expect(stories[1].region).toBeNull();
  });

  it("marks them as projections with a horizon from the lag", () => {
    expect(stories[0]).toMatchObject({ kind: "projected", horizon: "weeks", first_seen: null, is_sample: false });
    expect(stories[1].horizon).toBe("months");
    expect(horizonFromLag(3)).toBe("now");
  });
});

describe("directLinks", () => {
  const { causes, effects } = directLinks(CASCADE);

  it("lists stories one step either side, strongest link first", () => {
    expect(causes.map((c) => c.story.id)).toEqual(["story:red-sea-attacks-reroute", "story:brent-multi-month-high"]);
    expect(effects[0].link.link_type).toBe("reported");
    expect(effects.map((e) => e.link.link_type)).toEqual(["reported", "inferred", "conditional", "conditional"]);
  });

  it("carries the branch of conditional effects", () => {
    const yes = effects.find((e) => e.link.id === 201)!;
    expect(yes.branch && branchLabel(yes.branch.outcome, yes.branch.probability)).toBe("If YES · 31%");
  });

  it("skips links to stories that aren't in the answer", () => {
    expect(effects.some((e) => e.story.id === "story:not-in-view")).toBe(false);
  });
});

describe("listSections", () => {
  it("reads causes, the story, then effects by step, with the links that explain each", () => {
    const sections = listSections(shapeCascade(CASCADE));
    expect(sections.map((s) => s.title)).toEqual(["What led to it", "This story", "What it leads to", "2 steps on"]);
    const effects = sections[2];
    // Plain effects first, then the If YES lane, then If NO.
    expect(effects.items.map((i) => i.node.id).slice(-2)).toEqual([
      "story:freight-rates-ease-on-return",
      "story:surcharges-persist",
    ]);
    const brent = sections[0].items.find((i) => i.node.id === "story:brent-multi-month-high")!;
    // Only the link toward the story, not the one that skips past it.
    expect(brent.links.map((l) => l.link.id)).toEqual([129]);
    const surcharges = effects.items.find((i) => i.node.id === "story:surcharges-persist")!;
    expect(surcharges.links.map((l) => l.link.id).sort()).toEqual([130, 202]);
  });

  it("adds an AI projection section when there are projections", () => {
    const model = shapeCascade(CASCADE, projectionElements(FOCUS_ID, EFFECTS, []));
    const sections = listSections(model);
    expect(sections.at(-1)).toMatchObject({ kind: "ai", title: "AI projection" });
    expect(sections.at(-1)?.items).toHaveLength(2);
    expect(sections.find((s) => s.title === "What it leads to")?.items.some((i) => i.node.ai)).toBe(false);
  });
});

describe("projection input", () => {
  const model = shapeCascade(CASCADE);

  it("offers the story's region, its country and related regions", () => {
    const regions = projectionRegions(model, [EGYPT]);
    expect(regions[0]).toEqual(SHANGHAI);
    expect(regions[1]).toMatchObject({ id: "region:cn", subtype: "country" });
    expect(regions[1].name).toMatch(/China/);
    expect(regions.map((r) => r.id)).toContain("region:eg");
    expect(regions.map((r) => r.id)).toContain("region:nl");
    expect(new Set(regions.map((r) => r.id)).size).toBe(regions.length);
  });

  it("sends the story, the known effects and the regions", () => {
    const input = projectionInput(model, projectionRegions(model));
    expect(input.story).toMatchObject({ impact: "risk", direction: "up", sectors: ["logistics-trade"] });
    expect(input.story?.region).toEqual({ id: "region:cn-sh", name: "Shanghai" });
    expect(input.known_effects).toHaveLength(5);
    expect(input.regions[0]).toEqual({ id: "region:cn-sh", name: "Shanghai" });
  });

  it("names countries without the network", () => {
    expect(countryName("region:in")).toBe("India");
    expect(countryName("region:in-gj")).toBeNull();
  });
});
