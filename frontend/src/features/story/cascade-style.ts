/**
 * How a causal link looks and reads. Facts, inferences and projections stay
 * visibly apart: reported links are solid, inferred dashed, projected and
 * conditional dotted. Confidence sets the line's weight and opacity, and is
 * always said in words too.
 */
import type { CascadeLink, LinkType } from "@/api/contract";
import { formatProbability } from "@/lib/format";
import { DIRECTION_WORDS, IMPACT_TONES, LINK_TYPES } from "@/lib/meaning";
import { relativeTime } from "@/lib/time";

import { branchLabel, type BranchInfo, type CascadeNode } from "./cascade-data";

export interface EdgeLook {
  /** Line pattern for this link type. */
  line: "solid" | "dashed" | "dotted";
  /** SVG stroke-dasharray, scaled to the stroke width (undefined = solid). */
  dasharray: string | undefined;
  /** Stroke width in px: 1.25 (unsure) … 3.25 (certain). */
  width: number;
  /** Stroke opacity: 0.4 (unsure) … 0.95 (certain). */
  opacity: number;
  /** Colour token: conditional links take the forecast violet (they always carry the crowd badge). */
  tone: "muted" | "forecast";
  /** Tailwind stroke class for the tone. */
  strokeClass: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** The line for a link: pattern by type, weight and opacity by confidence. */
export function edgeLook(linkType: LinkType, confidence: number): EdgeLook {
  const c = clamp01(confidence);
  const width = Math.round((1.25 + c * 2) * 100) / 100;
  const opacity = Math.round((0.4 + c * 0.55) * 100) / 100;
  const line = LINK_TYPES[linkType]?.line ?? "solid";
  // Dots are round caps on near-zero dashes, so their size follows the width.
  const dasharray =
    line === "dashed"
      ? `${round(width * 3.5)} ${round(width * 2.5)}`
      : line === "dotted"
        ? `0.01 ${round(width * 2.6)}`
        : undefined;
  const tone = linkType === "conditional" ? "forecast" : "muted";
  return {
    line,
    dasharray,
    width,
    opacity,
    tone,
    strokeClass: tone === "forecast" ? "stroke-forecast" : "stroke-fg-muted",
  };
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Confidence in plain words: "High confidence (85%)". */
export function confidenceWords(confidence: number): string {
  const c = clamp01(confidence);
  const word = c >= 0.8 ? "High" : c >= 0.6 ? "Fair" : c >= 0.4 ? "Moderate" : "Low";
  return `${word} confidence (${formatProbability(c)})`;
}

/** How we know about a link, in one or two plain sentences. */
export function linkTypeExplanation(linkType: LinkType, branch?: BranchInfo | null, ai = false): string {
  if (ai) {
    return "An AI projection made just now from this story. It is a possibility, not news, and it isn't saved.";
  }
  switch (linkType) {
    case "reported":
      return "A news source reports that one led to the other.";
    case "inferred":
      return "Our analysis connects these two stories. No source says so directly.";
    case "projected":
      return "A possible next effect that hasn't happened yet.";
    case "conditional":
      return branch
        ? `Happens only if the crowd forecast resolves ${branch.outcome}. The crowd puts that at ${formatProbability(branch.probability)}.`
        : "Happens only if a crowd forecast resolves one way.";
    default:
      return "";
  }
}

/** When the effect usually shows: "Within a day", "About 2 weeks later". */
export function lagText(lagDays: number | null): string | null {
  if (lagDays === null || lagDays === undefined || lagDays < 0) return null;
  if (lagDays <= 1) return "Within a day";
  if (lagDays < 14) return `About ${lagDays} days later`;
  if (lagDays < 60) return `About ${Math.round(lagDays / 7)} weeks later`;
  if (lagDays < 730) return `About ${Math.round(lagDays / 30)} months later`;
  return `About ${Math.round(lagDays / 365)} years later`;
}

/**
 * The accessible name of a link: "Raises delivered costs: reported link,
 * high confidence (70%). If YES · 62%."
 */
export function linkSummary(link: Pick<CascadeLink, "mechanism" | "link_type" | "confidence">, branch?: BranchInfo | null, ai = false): string {
  const type = ai ? "AI projection" : `${LINK_TYPES[link.link_type]?.label ?? link.link_type} link`;
  const parts = [`${capitalise(link.mechanism)}: ${type.toLowerCase()}, ${confidenceWords(link.confidence).toLowerCase()}`];
  if (branch) parts.push(`${branchLabel(branch.outcome, branch.probability)} crowd forecast`);
  return `${parts.join(". ")}.`;
}

/**
 * The accessible name of a card in the flow: its place in the cascade, the
 * headline, then impact, place and time. "Effect, 1 step on: … Risk, rising.
 * Shanghai. 3 h ago."
 */
export function nodeLabel(node: Pick<CascadeNode, "role" | "depth" | "story" | "ai">, now = Date.now()): string {
  const { story } = node;
  const steps = Math.abs(node.depth);
  const place =
    node.role === "focus"
      ? "This story"
      : node.ai
        ? "AI projection, not news"
        : node.role === "cause"
          ? `Cause, ${steps} ${steps === 1 ? "step" : "steps"} back`
          : `Effect, ${steps} ${steps === 1 ? "step" : "steps"} on`;
  const parts = [`${place}: ${story.headline}.`];
  if (!story.analysed) parts.push("Draft, awaiting analysis.");
  else {
    const tone = IMPACT_TONES[story.impact] ?? IMPACT_TONES.neutral;
    parts.push(`${tone.label}${story.direction ? `, ${DIRECTION_WORDS[story.direction]}` : ""}.`);
  }
  if (story.region) parts.push(`${story.region.name}.`);
  if (story.kind === "projected" && !node.ai) parts.push("Projected.");
  else if (story.first_seen) {
    const when = relativeTime(story.first_seen, now);
    if (when) parts.push(`${capitalise(when)}.`);
  }
  if (node.ai && story.confidence !== null) parts.push(`Confidence ${formatProbability(story.confidence)}.`);
  if (story.is_sample) parts.push("Sample data.");
  return parts.join(" ");
}

export function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
