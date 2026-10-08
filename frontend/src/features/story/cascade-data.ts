/**
 * Turns api.cascade (plus any AI projections the viewer asked for) into the
 * model the flow, the list and the story panel draw from: nodes by depth,
 * links with their If YES / If NO branch, and the lanes that group branch
 * effects. Pure functions, no React.
 */
import type {
  CascadeLink,
  CascadeResponse,
  ForecastSummary,
  Horizon,
  RegionRef,
  StorySummary,
} from "@/api/contract";
import type { ProjectedEffect } from "@/ai/schemas";

export type CascadeStory = CascadeResponse["nodes"][number];

/** What the viewer is looking at in the flow. */
export type NodeRole = "focus" | "cause" | "effect" | "projection";

export interface BranchInfo {
  forecast: ForecastSummary;
  /** "YES" | "NO" */
  outcome: string;
  /** Current crowd probability of this outcome, 0..1. */
  probability: number;
}

export interface CascadeNode {
  id: string;
  /** < 0 causes, 0 the focus story, > 0 effects. */
  depth: number;
  role: NodeRole;
  story: StorySummary;
  /** An AI projection made on request: shown, never saved. */
  ai: boolean;
  /** The lane group it sits in (If YES / If NO branches, AI projections). */
  groupId: string | null;
}

export interface CascadeEdge {
  /** Stable id for the flow, e.g. "link-23" or "ai-link-1". */
  id: string;
  link: CascadeLink;
  ai: boolean;
  /** For conditional links: the forecast and outcome this effect depends on. */
  branch: BranchInfo | null;
}

export interface LaneSection {
  key: string;
  kind: "yes" | "no" | "other" | "ai";
  /** "If YES · 62%", "AI projection". */
  label: string;
  outcome: string | null;
  probability: number | null;
  ids: string[];
}

/** A box of lanes in one column: a forecast's If YES / If NO effects, or the AI projections. */
export interface CascadeGroup {
  id: string;
  kind: "branch" | "ai";
  depth: number;
  forecast: ForecastSummary | null;
  sections: LaneSection[];
}

export interface CascadeModel {
  focus: string;
  focusStory: StorySummary | null;
  nodes: CascadeNode[];
  edges: CascadeEdge[];
  groups: CascadeGroup[];
  minDepth: number;
  maxDepth: number;
  causes: number;
  effects: number;
  /** Any sample story in view (the panel shows "Sample data"). */
  hasSample: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "If YES · 62%" */
export function branchLabel(outcome: string, probability: number): string {
  const p = Math.round(Math.min(1, Math.max(0, probability)) * 100);
  return `If ${outcome.toUpperCase()} · ${p}%`;
}

export function roleOf(depth: number): NodeRole {
  return depth < 0 ? "cause" : depth > 0 ? "effect" : "focus";
}

/** Branch info for every conditional link, keyed by "forecastId|OUTCOME". */
function branchIndex(branches: CascadeResponse["branches"]): Map<string, BranchInfo> {
  const index = new Map<string, BranchInfo>();
  for (const branch of branches) {
    for (const o of branch.outcomes) {
      index.set(`${branch.forecast.id}|${o.outcome.toUpperCase()}`, {
        forecast: branch.forecast,
        outcome: o.outcome.toUpperCase(),
        probability: o.probability,
      });
    }
  }
  return index;
}

/** The branch a link depends on (conditional links only). */
export function branchOf(link: CascadeLink, branches: CascadeResponse["branches"]): BranchInfo | null {
  if (link.link_type !== "conditional" || !link.forecast_id || !link.outcome) return null;
  const hit = branchIndex(branches).get(`${link.forecast_id}|${link.outcome.toUpperCase()}`);
  if (hit) return hit;
  return null;
}

// ---------------------------------------------------------------------------
// AI projections
// ---------------------------------------------------------------------------

export const AI_ID_PREFIX = "ai-projection:";
export const isAiId = (id: string) => id.startsWith(AI_ID_PREFIX);

/** When a projected effect would show, as a horizon chip. */
export function horizonFromLag(lagDays: number): Horizon {
  if (lagDays <= 7) return "now";
  if (lagDays <= 60) return "weeks";
  return "months";
}

/** AI projections as stories and links from the focus (confidence capped at 50 %). */
export function projectionElements(
  focus: string,
  effects: readonly ProjectedEffect[],
  regions: readonly RegionRef[],
): { stories: StorySummary[]; links: CascadeLink[] } {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const stories: StorySummary[] = [];
  const links: CascadeLink[] = [];
  effects.slice(0, 3).forEach((effect, i) => {
    const id = `${AI_ID_PREFIX}${i + 1}`;
    const confidence = Math.min(0.5, Math.max(0, effect.confidence));
    stories.push({
      id,
      kind: "projected",
      headline: effect.headline,
      so_what: effect.so_what,
      event_type: "projected-impact",
      impact: effect.impact,
      direction: effect.direction,
      magnitude: null,
      horizon: horizonFromLag(effect.lag_days),
      confidence,
      importance: 0,
      sectors: effect.sectors,
      first_seen: null,
      region: (effect.region_id && byId.get(effect.region_id)) || null,
      lon: null,
      lat: null,
      source_count: 0,
      analysed: true,
      is_sample: false,
    });
    links.push({
      id: -(i + 1),
      src: focus,
      dst: id,
      link_type: "projected",
      mechanism: effect.mechanism,
      direction: effect.direction,
      confidence,
      lag_days: effect.lag_days,
      forecast_id: null,
      outcome: null,
      evidence: [],
    });
  });
  return { stories, links };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Shape a cascade response for drawing.
 * - nodes are unique and sorted by depth, then importance;
 * - links whose ends aren't both in view are dropped;
 * - effects that happen only on one outcome of a forecast are grouped in
 *   that forecast's lanes (one group per forecast and column);
 * - AI projections, when given, become a lane of effects of the focus.
 */
export function shapeCascade(
  response: CascadeResponse,
  projection?: { stories: readonly StorySummary[]; links: readonly CascadeLink[] } | null,
): CascadeModel {
  const seen = new Set<string>();
  const nodes: CascadeNode[] = [];
  const sorted = [...response.nodes].sort((a, b) => a.depth - b.depth || b.importance - a.importance);
  for (const story of sorted) {
    if (seen.has(story.id)) continue;
    seen.add(story.id);
    const { depth, ...summary } = story;
    const isFocus = story.id === response.focus;
    nodes.push({
      id: story.id,
      depth: isFocus ? 0 : depth === 0 ? 1 : depth,
      role: isFocus ? "focus" : roleOf(depth === 0 ? 1 : depth),
      story: summary,
      ai: false,
      groupId: null,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = branchIndex(response.branches);

  const edges: CascadeEdge[] = [];
  const linkIds = new Set<number>();
  for (const link of response.links) {
    if (linkIds.has(link.id) || !byId.has(link.src) || !byId.has(link.dst) || link.src === link.dst) continue;
    linkIds.add(link.id);
    const branch =
      link.link_type === "conditional" && link.forecast_id && link.outcome
        ? (index.get(`${link.forecast_id}|${link.outcome.toUpperCase()}`) ?? null)
        : null;
    edges.push({ id: `link-${link.id}`, link, ai: false, branch });
  }

  // If YES / If NO lanes: one group per forecast and column.
  const groups: CascadeGroup[] = [];
  const groupById = new Map<string, CascadeGroup>();
  for (const branch of response.branches) {
    for (const outcome of branch.outcomes) {
      for (const storyId of outcome.story_ids) {
        const node = byId.get(storyId);
        if (!node || node.depth <= 0 || node.groupId) continue;
        const groupId = `branch:${branch.forecast.id}@${node.depth}`;
        let group = groupById.get(groupId);
        if (!group) {
          group = { id: groupId, kind: "branch", depth: node.depth, forecast: branch.forecast, sections: [] };
          groupById.set(groupId, group);
          groups.push(group);
        }
        const key = outcome.outcome.toUpperCase();
        let section = group.sections.find((s) => s.outcome === key);
        if (!section) {
          section = {
            key: `${groupId}|${key}`,
            kind: key === "YES" ? "yes" : key === "NO" ? "no" : "other",
            label: branchLabel(key, outcome.probability),
            outcome: key,
            probability: outcome.probability,
            ids: [],
          };
          group.sections.push(section);
        }
        section.ids.push(storyId);
        node.groupId = groupId;
      }
    }
  }
  // YES above NO, whatever order the database sent.
  const rank = { yes: 0, no: 1, other: 2, ai: 3 } as const;
  for (const group of groups) group.sections.sort((a, b) => rank[a.kind] - rank[b.kind]);

  // AI projections: a lane of possible next effects of the focus story.
  if (projection && projection.stories.length && byId.has(response.focus)) {
    const groupId = "ai:projections";
    const ids: string[] = [];
    for (const story of projection.stories) {
      if (byId.has(story.id)) continue;
      const node: CascadeNode = { id: story.id, depth: 1, role: "projection", story, ai: true, groupId };
      nodes.push(node);
      byId.set(story.id, node);
      ids.push(story.id);
    }
    for (const link of projection.links) {
      if (!byId.has(link.src) || !byId.has(link.dst)) continue;
      edges.push({ id: `ai-link-${Math.abs(link.id)}`, link, ai: true, branch: null });
    }
    if (ids.length) {
      groups.push({
        id: groupId,
        kind: "ai",
        depth: 1,
        forecast: null,
        sections: [
          { key: `${groupId}|all`, kind: "ai", label: "AI projection", outcome: null, probability: null, ids },
        ],
      });
    }
  }

  const depths = nodes.map((n) => n.depth);
  const real = nodes.filter((n) => !n.ai);
  return {
    focus: response.focus,
    focusStory: byId.get(response.focus)?.story ?? null,
    nodes,
    edges,
    groups,
    minDepth: depths.length ? Math.min(...depths) : 0,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    causes: real.filter((n) => n.depth < 0).length,
    effects: real.filter((n) => n.depth > 0).length,
    hasSample: real.some((n) => n.story.is_sample),
  };
}

// ---------------------------------------------------------------------------
// Direct causes and effects (story panel)
// ---------------------------------------------------------------------------

export interface LinkedStory {
  story: StorySummary;
  link: CascadeLink;
  branch: BranchInfo | null;
}

/**
 * The stories one step from the focus: what caused it, and what it leads
 * to, strongest link first (reported before inferred before projected).
 */
export function directLinks(response: CascadeResponse): { causes: LinkedStory[]; effects: LinkedStory[] } {
  const stories = new Map<string, StorySummary>(response.nodes.map((n) => [n.id, n]));
  const order = { reported: 0, inferred: 1, projected: 2, conditional: 3 } as const;
  const byStrength = (a: LinkedStory, b: LinkedStory) =>
    order[a.link.link_type] - order[b.link.link_type] || b.link.confidence - a.link.confidence;
  const causes: LinkedStory[] = [];
  const effects: LinkedStory[] = [];
  const seen = new Set<string>();
  for (const link of response.links) {
    if (link.src === link.dst) continue;
    if (link.dst === response.focus) {
      const story = stories.get(link.src);
      const key = `c|${link.src}`;
      if (story && !seen.has(key)) {
        seen.add(key);
        causes.push({ story, link, branch: branchOf(link, response.branches) });
      }
    } else if (link.src === response.focus) {
      const story = stories.get(link.dst);
      const key = `e|${link.dst}`;
      if (story && !seen.has(key)) {
        seen.add(key);
        effects.push({ story, link, branch: branchOf(link, response.branches) });
      }
    }
  }
  return { causes: causes.sort(byStrength), effects: effects.sort(byStrength) };
}

// ---------------------------------------------------------------------------
// The list alternative
// ---------------------------------------------------------------------------

export interface ListItem {
  node: CascadeNode;
  /** Links that explain why it's in the cascade: toward the focus for causes, from it for effects. */
  links: CascadeEdge[];
}

export interface ListSection {
  key: string;
  title: string;
  depth: number;
  kind: "causes" | "focus" | "effects" | "ai";
  items: ListItem[];
}

function sectionTitle(depth: number): string {
  if (depth === 0) return "This story";
  const steps = Math.abs(depth);
  if (depth < 0) return steps === 1 ? "What led to it" : `${steps} steps back`;
  return steps === 1 ? "What it leads to" : `${steps} steps on`;
}

/** The cascade as sections in reading order: causes, the story, effects, AI projections. */
export function listSections(model: CascadeModel): ListSection[] {
  const sections: ListSection[] = [];
  const incoming = new Map<string, CascadeEdge[]>();
  const outgoing = new Map<string, CascadeEdge[]>();
  for (const edge of model.edges) {
    incoming.set(edge.link.dst, [...(incoming.get(edge.link.dst) ?? []), edge]);
    outgoing.set(edge.link.src, [...(outgoing.get(edge.link.src) ?? []), edge]);
  }
  const depthOf = new Map(model.nodes.map((n) => [n.id, n.depth]));
  for (let depth = model.minDepth; depth <= model.maxDepth; depth++) {
    const nodes = model.nodes.filter((n) => n.depth === depth && !n.ai);
    if (!nodes.length) continue;
    const items = nodes.map((node) => {
      let links: CascadeEdge[] = [];
      if (depth < 0) {
        // Links pointing toward the story (to a node closer to it, not past it:
        // a cause's link that skips to an effect is listed under that effect).
        links = (outgoing.get(node.id) ?? []).filter((e) => {
          const to = depthOf.get(e.link.dst) ?? 0;
          return to > depth && to <= 0;
        });
      } else if (depth > 0) {
        links = (incoming.get(node.id) ?? []).filter((e) => (depthOf.get(e.link.src) ?? 0) < depth);
      }
      return { node, links };
    });
    // Within a column, branch effects follow their forecast, YES before NO.
    if (depth > 0) {
      const laneRank = (item: ListItem) => {
        const branch = item.links.find((l) => l.branch)?.branch;
        return branch ? (branch.outcome === "YES" ? 1 : 2) : 0;
      };
      items.sort((a, b) => laneRank(a) - laneRank(b));
    }
    sections.push({
      key: `depth-${depth}`,
      title: sectionTitle(depth),
      depth,
      kind: depth < 0 ? "causes" : depth === 0 ? "focus" : "effects",
      items,
    });
  }
  const ai = model.nodes.filter((n) => n.ai);
  if (ai.length) {
    sections.push({
      key: "ai",
      title: "AI projection",
      depth: 1,
      kind: "ai",
      items: ai.map((node) => ({ node, links: incoming.get(node.id) ?? [] })),
    });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// AI projection input
// ---------------------------------------------------------------------------

/** Country names offline (no network in claude.ai): "region:cn" → "China". */
export function countryName(regionId: string, locale = "en"): string | null {
  const code = /^region:([a-z]{2})$/.exec(regionId)?.[1];
  if (!code) return null;
  try {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase());
    return name && name.toUpperCase() !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * Regions the AI may place a projected effect in: the story's region, its
 * country, and the regions of stories already in the cascade. At most 12.
 */
export function projectionRegions(model: CascadeModel, extra: readonly RegionRef[] = []): RegionRef[] {
  const out = new Map<string, RegionRef>();
  const add = (r: RegionRef | null | undefined) => {
    if (r && !out.has(r.id)) out.set(r.id, r);
  };
  const focus = model.focusStory;
  add(focus?.region);
  const country = focus?.region?.country_id;
  if (country && !out.has(country)) {
    const known = [...model.nodes.map((n) => n.story.region), ...extra].find((r) => r?.id === country);
    const name = known?.name ?? countryName(country);
    if (name) add({ id: country, name, subtype: "country", country_id: country });
  }
  for (const r of extra) add(r);
  for (const node of model.nodes) if (!node.ai) add(node.story.region);
  return [...out.values()].slice(0, 12);
}

/** The data the projection prompt receives (prompts/projection.md). */
export function projectionInput(model: CascadeModel, regions: readonly RegionRef[]) {
  const story = model.focusStory;
  return {
    story: story
      ? {
          headline: story.headline,
          so_what: story.so_what,
          region: story.region ? { id: story.region.id, name: story.region.name } : null,
          sectors: story.sectors,
          impact: story.impact,
          direction: story.direction,
        }
      : null,
    known_effects: model.nodes.filter((n) => n.depth > 0 && !n.ai).map((n) => n.story.headline),
    regions: regions.map((r) => ({ id: r.id, name: r.name })),
  };
}
