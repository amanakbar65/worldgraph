/**
 * "Why is this here?" (Phase A3, kg.provenance): the plain words and shapes
 * the sheet and its entry points share, from api.provenance's answer.
 */
import type { ProvenanceKind, ProvenanceResponse, RpcArgs } from "@/api/contract";
import type { SourceItem } from "@/components/SourcesList";
import { LINK_TYPES } from "@/lib/meaning";
import type { Panel } from "@/state/nav";

export type WhyPanelState = Extract<Panel, { kind: "why" }>;
export type ProvenanceTarget = WhyPanelState["target"];

/** The api's arguments for a "why" panel: node ids as they are, edge and link ids as numbers. */
export function provenanceArgs(panel: Pick<WhyPanelState, "target" | "id">): RpcArgs["provenance"] {
  return panel.target === "node" ? { target: "node", id: panel.id } : { target: panel.target, id: Number(panel.id) };
}

/** What the thing is, in a word or two. */
export const TARGET_WORDS: Record<ProvenanceTarget, string> = {
  node: "Item",
  edge: "Link",
  link: "Cause and effect",
};

/** How it is known: the causal link types in the cascade's words, plus people and AI suggestions. */
export const KIND_WORDS: Record<ProvenanceKind, { label: string; description: string }> = {
  reported: { label: LINK_TYPES.reported.label, description: "A named source states it." },
  inferred: { label: LINK_TYPES.inferred.label, description: LINK_TYPES.inferred.description },
  projected: { label: LINK_TYPES.projected.label, description: LINK_TYPES.projected.description },
  conditional: { label: LINK_TYPES.conditional.label, description: LINK_TYPES.conditional.description },
  user: { label: "Added by a person", description: "Someone added it by hand." },
  ai_suggested: { label: "Suggested by AI", description: "An AI suggested it; nobody has checked it yet." },
};

/** The kinds the cascade draws as line styles (the rest get a word only). */
export function isLinkKind(kind: ProvenanceKind): kind is keyof typeof LINK_TYPES {
  return kind in LINK_TYPES;
}

/** The sources as SourcesList shows them (sample ones say "Sample source" and never link). */
export function provenanceSources(data: Pick<ProvenanceResponse, "sources" | "is_sample">): SourceItem[] {
  return data.sources.map((s) => ({
    source_name: s.name,
    url: s.url,
    published_at: s.published_at,
    title: s.title,
    snippet: s.snippet,
    is_sample: data.is_sample,
  }));
}

/** The source row it came from, when the list of sources doesn't already name it. */
export function originSource(data: Pick<ProvenanceResponse, "source" | "sources">): ProvenanceResponse["source"] {
  const { source } = data;
  if (!source) return null;
  return data.sources.some((s) => s.name === source.name) ? null : source;
}

/** Changed since it was added (more than a minute later)? */
export function updatedSinceAdded(data: Pick<ProvenanceResponse, "created_at" | "updated_at">): boolean {
  const created = Date.parse(data.created_at);
  const updated = Date.parse(data.updated_at);
  return Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000;
}

/** The sheet's question, on its buttons and as its eyebrow. */
export const WHY = "Why is this here?";
/** Said after the question on a weak item's button. */
export const WEAK_WORDS = "Weak: under 50% sure, or no source.";

/**
 * The accessible name of an icon button that opens the sheet: "Why is DP
 * World here?" for an item, "Why is this link here? DP World, operates,
 * Jebel Ali Port." for a link; weak ones say so.
 */
export function whyLabel(subject: string, { link = false, weak = false }: { link?: boolean; weak?: boolean } = {}): string {
  const name = subject.trim();
  const question = link ? `Why is this link here?${name ? ` ${name}.` : ""}` : `Why is ${name || "this"} here?`;
  return weak ? `${question} ${WEAK_WORDS}` : question;
}
