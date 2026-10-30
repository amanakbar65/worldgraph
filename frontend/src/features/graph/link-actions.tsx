/**
 * What a chosen graph link offers under its card: "Why is this here?"
 * (kg.provenance) for its edge or causal link (linkTarget).
 */
import type { ReactNode } from "react";

import { useWhyAvailable } from "@/features/provenance/use-why";
import { WhyButton } from "@/features/provenance/WhyButton";

import { linkEnds, linkRelationName, linkTarget, type RelationIndex, type VizGraph, type VizLink } from "./graph-data";

/** A link in words, from its source: "DP World, operates, Jebel Ali Port". */
export function linkWords(link: VizLink, graph: Pick<VizGraph, "byId">, relations: RelationIndex | null): string {
  const relation = relations
    ? linkRelationName(link, relations).toLowerCase()
    : link.linkType
      ? "leads to"
      : link.type.replace(/_/g, " ");
  const ends = linkEnds(link, graph.byId);
  return ends ? `${ends[0].name}, ${relation}, ${ends[1].name}` : relation;
}

/** The actions for the chosen link's card; null when there are none (flag off, or no api id). */
export function useLinkActions(
  link: VizLink | null,
  graph: Pick<VizGraph, "byId"> | null,
  relations: RelationIndex | null,
): ReactNode {
  const on = useWhyAvailable();
  if (!on || !link || !graph) return null;
  const target = linkTarget(link);
  if (!target) return null;
  return (
    <WhyButton
      target={target.target}
      id={target.id}
      subject={linkWords(link, graph, relations)}
      weak={link.weak}
      className="self-start"
    />
  );
}
