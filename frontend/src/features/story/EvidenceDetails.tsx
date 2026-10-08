/**
 * Why two stories are linked: the mechanism, how we know (link type, in
 * plain words), how sure we are, the crowd forecast it depends on, and the
 * evidence with its source, date and a link when there is one. Also shows an
 * AI projection's details (no evidence: it is a possibility, not news).
 */
import { ArrowDown, FileSearch, Sparkles, Telescope, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import type { StorySummary } from "@/api/contract";
import { ConfidenceMeter, LinkTypeLabel } from "@/components/ConfidenceMeter";
import { ForecastRow } from "@/components/ForecastRow";
import { SectionHeader } from "@/components/SectionHeader";
import { SourcesList } from "@/components/SourcesList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CascadeEdge, CascadeNode } from "./cascade-data";
import { capitalise, confidenceWords, lagText, linkTypeExplanation } from "./cascade-style";
import { ImpactTile, StoryMeta } from "./story-parts";

export type EvidenceTarget = { kind: "edge"; edge: CascadeEdge } | { kind: "projection"; node: CascadeNode; edge: CascadeEdge | null };

interface DetailsProps {
  target: EvidenceTarget;
  stories: ReadonlyMap<string, StorySummary>;
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}

function StoryLine({ label, story, onOpen }: { label: string; story: StorySummary | undefined; onOpen?: (id: string) => void }) {
  if (!story) return null;
  const body = (
    <>
      <ImpactTile impact={story.analysed ? story.impact : "neutral"} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label text-fg-muted">{label}</span>
        <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
        <StoryMeta story={story} />
      </span>
    </>
  );
  const look = "flex w-full items-start gap-2.5 rounded-lg p-2 text-left";
  if (!onOpen) return <div className={look}>{body}</div>;
  return (
    <button type="button" onClick={() => onOpen(story.id)} className={cn(look, "cursor-pointer transition-colors hover:bg-surface-2/70")}>
      {body}
    </button>
  );
}

/** The evidence for one link, or an AI projection's details. */
export function EvidenceDetails({ target, stories, onOpenStory, onOpenForecast }: DetailsProps) {
  if (target.kind === "projection") return <ProjectionDetails target={target} stories={stories} />;
  const { edge } = target;
  const { link, branch } = edge;
  const from = stories.get(link.src);
  const to = stories.get(link.dst);
  const lag = lagText(link.lag_days);
  const canOpen = (id: string) => (id.startsWith("story:") ? onOpenStory : undefined);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-stretch rounded-xl border border-line bg-surface-2/30 p-1">
        <StoryLine label="From" story={from} onOpen={canOpen(link.src)} />
        <ArrowDown aria-hidden className="mx-auto my-0.5 size-4 text-fg-subtle" />
        <StoryLine label="To" story={to} onOpen={edge.ai ? undefined : canOpen(link.dst)} />
      </div>

      <section className="flex flex-col gap-2">
        <p className="text-body font-semibold text-fg">{capitalise(link.mechanism)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <LinkTypeLabel linkType={link.link_type} />
          {lag && <span className="text-label text-fg-muted">{lag}</span>}
        </div>
        <p className="text-body text-fg-muted">{linkTypeExplanation(link.link_type, branch, edge.ai)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceMeter confidence={link.confidence} hideValue />
          <span className="text-label text-fg">{confidenceWords(link.confidence)}</span>
        </div>
      </section>

      {branch && (
        <section className="flex flex-col gap-1">
          <SectionHeader as="h4" title="Depends on this crowd forecast" description="Crowd odds, not facts. Information only." />
          <ForecastRow
            forecast={branch.forecast}
            short
            onOpen={(f) => onOpenForecast(f.id)}
            className="-mx-3"
          />
        </section>
      )}

      <section className="flex flex-col gap-1">
        <SectionHeader as="h4" title="Evidence" icon={FileSearch} count={link.evidence.length} />
        {link.evidence.length > 0 ? (
          <SourcesList items={link.evidence} />
        ) : (
          <p className="text-body text-fg-muted">
            {link.link_type === "projected" || link.link_type === "conditional"
              ? "No source yet: this is a possible effect, not something that has happened."
              : "No evidence snippet is stored for this link."}
          </p>
        )}
      </section>
    </div>
  );
}

function ProjectionDetails({
  target,
  stories,
}: {
  target: Extract<EvidenceTarget, { kind: "projection" }>;
  stories: ReadonlyMap<string, StorySummary>;
}) {
  const { node, edge } = target;
  const story = node.story;
  const from = edge ? stories.get(edge.link.src) : undefined;
  const lag = lagText(edge?.link.lag_days ?? null);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2.5 rounded-xl border-2 border-dotted border-line-strong p-3">
        <Telescope aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <p className="text-body text-fg">
          <span className="font-semibold">Projection, not news.</span>{" "}
          <span className="text-fg-muted">Made by AI just now from this story. It isn't saved and has no source.</span>
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <p className="text-body font-semibold text-fg">{story.headline}</p>
        {story.so_what && <p className="text-body text-fg-muted">{story.so_what}</p>}
        <StoryMeta story={story} />
      </section>
      {edge && (
        <section className="flex flex-col gap-2">
          <SectionHeader as="h4" title="How it could follow" icon={Sparkles} />
          {from && <p className="text-label text-fg-muted">From: {from.headline}</p>}
          <p className="text-body font-medium text-fg">{capitalise(edge.link.mechanism)}</p>
          {lag && <p className="text-label text-fg-muted">{lag}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceMeter confidence={edge.link.confidence} hideValue />
            <span className="text-label text-fg">{confidenceWords(edge.link.confidence)}</span>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The evidence drawer over the flow: a side sheet on wide screens, a bottom
 * sheet on phones. Focus moves into it; Escape or Close puts it back.
 */
export function EvidenceDrawer({
  target,
  placement,
  onClose,
  ...details
}: DetailsProps & { placement: "side" | "bottom"; onClose: () => void }) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [target]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Close the drawer, not the whole panel.
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
  };

  const title = target.kind === "projection" ? "AI projection" : "Why these are linked";

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute z-20 flex flex-col overflow-hidden border-line bg-surface shadow-panel",
        placement === "side"
          ? "inset-y-3 right-3 w-[min(380px,calc(100%-24px))] rounded-xl border"
          : "inset-x-0 bottom-0 max-h-[80%] rounded-t-2xl border-t",
      )}
    >
      <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
        <h3 ref={heading} id={titleId} tabIndex={-1} className="min-w-0 flex-1 truncate text-body font-semibold text-fg outline-none">
          {title}
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the evidence">
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <EvidenceDetails target={target} {...details} />
      </div>
    </div>
  );
}
