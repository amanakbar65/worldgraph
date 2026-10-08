/**
 * The cascade as a list: the accessible alternative to the flow, and the
 * default on phones. Causes, the story, then effects step by step; each
 * story shows the links that put it there, with their evidence inline.
 */
import { ChevronDown, ChevronRight, CornerDownRight, Sparkles } from "lucide-react";
import { useId, useState } from "react";

import type { StorySummary } from "@/api/contract";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CascadeEdge, CascadeModel, CascadeNode, ListItem } from "./cascade-data";
import { listSections } from "./cascade-data";
import { nodeLabel } from "./cascade-style";
import { EvidenceDetails } from "./EvidenceDetails";
import { ImpactTile, LinkLine, StoryMeta } from "./story-parts";

interface CascadeListProps {
  model: CascadeModel;
  stories: ReadonlyMap<string, StorySummary>;
  onOpenNode: (node: CascadeNode) => void;
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}

export function CascadeList({ model, stories, onOpenNode, onOpenStory, onOpenForecast }: CascadeListProps) {
  const sections = listSections(model);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-4 pb-10">
      {sections.map((section) => (
        <Section
          key={section.key}
          title={section.title}
          kind={section.kind}
          items={section.items}
          focusId={model.focus}
          stories={stories}
          onOpenNode={onOpenNode}
          onOpenStory={onOpenStory}
          onOpenForecast={onOpenForecast}
        />
      ))}
    </div>
  );
}

function Section({
  title,
  kind,
  items,
  ...rest
}: {
  title: string;
  kind: "causes" | "focus" | "effects" | "ai";
  items: ListItem[];
  focusId: string;
} & Omit<CascadeListProps, "model">) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="flex items-center gap-2 text-label font-medium text-fg-muted">
        {kind === "ai" && <Sparkles aria-hidden className="size-3.5" />}
        {title}
        {kind !== "focus" && (
          <span className="rounded-full bg-surface-2 px-1.5 tabular-nums">{items.length}</span>
        )}
        {kind === "ai" && <span className="font-normal">· Projection, not news · not saved</span>}
      </h3>
      <ol className="flex flex-col gap-2">
        {items.map((item) => (
          <Item key={item.node.id} item={item} {...rest} />
        ))}
      </ol>
    </section>
  );
}

function Item({
  item,
  focusId,
  stories,
  onOpenNode,
  onOpenStory,
  onOpenForecast,
}: { item: ListItem; focusId: string } & Omit<CascadeListProps, "model">) {
  const { node } = item;
  const focus = node.role === "focus";
  const [open, setOpen] = useState(false);
  const aiEdge = node.ai ? (item.links[0] ?? null) : null;

  return (
    <li
      className={cn(
        "flex flex-col rounded-xl border bg-surface",
        focus ? "border-2 border-fg/55" : "border-line",
        node.story.kind === "projected" && !node.ai && !focus && "border-dashed border-line-strong",
        node.ai && "border-2 border-dotted border-fg-subtle/60",
      )}
    >
      <button
        type="button"
        onClick={() => (node.ai ? setOpen((v) => !v) : onOpenNode(node))}
        aria-label={node.ai ? `${nodeLabel(node)} ${open ? "Hide" : "Show"} details.` : nodeLabel(node)}
        aria-expanded={node.ai ? open : undefined}
        className="flex w-full cursor-pointer items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-surface-2/60"
      >
        <ImpactTile impact={node.story.analysed ? node.story.impact : "neutral"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body font-medium text-fg">{node.story.headline}</span>
          {node.ai ? (
            <span className="text-label text-fg-muted">Projection, not news</span>
          ) : (
            <StoryMeta story={node.story} />
          )}
        </span>
        {node.ai ? (
          <ChevronDown aria-hidden className={cn("mt-2.5 size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
        ) : (
          <ChevronRight aria-hidden className="mt-2.5 size-4 shrink-0 text-fg-subtle" />
        )}
      </button>
      {node.ai
        ? open && (
            <div className="border-t border-line p-3">
              <EvidenceDetails
                target={{ kind: "projection", node, edge: aiEdge }}
                stories={stories}
                onOpenStory={onOpenStory}
                onOpenForecast={onOpenForecast}
              />
            </div>
          )
        : item.links.map((edge) => {
            const otherId = node.role === "cause" ? edge.link.dst : edge.link.src;
            return (
              <LinkRow
                key={edge.id}
                edge={edge}
                // Links to and from the story itself need no "after" line.
                other={otherId === focusId ? undefined : stories.get(otherId)}
                towards={node.role === "cause"}
                stories={stories}
                onOpenStory={onOpenStory}
                onOpenForecast={onOpenForecast}
              />
            );
          })}
    </li>
  );
}

function LinkRow({
  edge,
  other,
  towards,
  stories,
  onOpenStory,
  onOpenForecast,
}: {
  edge: CascadeEdge;
  other: StorySummary | undefined;
  /** True for a cause (the link leads to `other`), false for an effect (it comes from `other`). */
  towards: boolean;
  stories: ReadonlyMap<string, StorySummary>;
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <div className="flex items-start gap-2">
        <CornerDownRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {other && (
            <span className="line-clamp-1 text-label text-fg-muted">
              {towards ? "Leads to: " : "After: "}
              {other.headline}
            </span>
          )}
          <LinkLine link={edge.link} branch={edge.branch} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="-my-1 shrink-0"
        >
          Evidence
          <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div id={panelId} hidden={!open} className="rounded-lg bg-surface-2/30 p-3">
        {open && (
          <EvidenceDetails
            target={{ kind: "edge", edge }}
            stories={stories}
            onOpenStory={onOpenStory}
            onOpenForecast={onOpenForecast}
          />
        )}
      </div>
    </div>
  );
}
