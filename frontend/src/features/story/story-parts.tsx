/**
 * Small pieces shared by the story card and the cascade: the impact tile,
 * the draft label, the If YES / If NO badge and a linked-story row.
 */
import { ChevronRight, Hourglass, Telescope, Users } from "lucide-react";

import type { CascadeLink, Impact, StorySummary } from "@/api/contract";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { SampleBadge } from "@/components/SampleBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { IMPACT_ICONS } from "@/lib/icons";
import { DIRECTION_ARROWS, DIRECTION_WORDS, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { branchLabel, type BranchInfo } from "./cascade-data";
import { capitalise, linkSummary } from "./cascade-style";

/** The impact icon on its colour wash: the glance mark of a story. */
export function ImpactTile({ impact, size = "md", className }: { impact: Impact; size?: "sm" | "md"; className?: string }) {
  const tone = impactTone(impact);
  const Icon = (IMPACT_ICONS[impact] ?? IMPACT_ICONS.neutral).icon;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border",
        size === "sm" ? "size-7" : "size-9",
        tone.tint,
        tone.border,
        className,
      )}
    >
      <Icon className={cn(size === "sm" ? "size-3.5" : "size-4", tone.text)} />
    </span>
  );
}

/** "Risk ▲" in the impact colour, for one-line metadata. */
export function ImpactWord({ impact, direction }: Pick<StorySummary, "impact" | "direction">) {
  const tone = impactTone(impact);
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium whitespace-nowrap", tone.text)}>
      {tone.label}
      {direction && (
        <>
          <span aria-hidden>{DIRECTION_ARROWS[direction]}</span>
          <span className="sr-only">, {DIRECTION_WORDS[direction]}</span>
        </>
      )}
    </span>
  );
}

/** A news draft from the live pipeline that the AI hasn't analysed yet. */
export function DraftLabel({ className }: { className?: string }) {
  return (
    <Chip tone="outline" className={className} title="Straight from the news feed; the summary and actions come after analysis">
      <Hourglass aria-hidden />
      Draft · awaiting analysis
    </Chip>
  );
}

/** "If YES · 62%": the forecast outcome a conditional effect depends on. */
export function BranchBadge({ branch, className }: { branch: BranchInfo; className?: string }) {
  return (
    <Chip tone="forecast" className={className} title={`${branch.forecast.short_title}: crowd forecast`}>
      <Users aria-hidden />
      <span className="tabular-nums">{branchLabel(branch.outcome, branch.probability)}</span>
      <span className="sr-only"> crowd forecast</span>
    </Chip>
  );
}

/**
 * One line of story metadata: impact, place and time (or "Projected").
 * `oneLine` keeps it to a single line (the place gives way first); turn
 * `showSample` off where the whole view is already labelled sample data.
 */
export function StoryMeta({
  story,
  oneLine = false,
  showSample = true,
  className,
}: {
  story: StorySummary;
  oneLine?: boolean;
  showSample?: boolean;
  className?: string;
}) {
  const projected = story.kind === "projected";
  const keep = "shrink-0 whitespace-nowrap";
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-x-1.5 text-label text-fg-muted",
        oneLine ? "flex-nowrap overflow-hidden" : "flex-wrap",
        className,
      )}
    >
      <span className={keep}>
        {story.analysed ? <ImpactWord impact={story.impact} direction={story.direction} /> : "Draft"}
      </span>
      {story.region && (
        <>
          <span aria-hidden className={keep}>
            ·
          </span>
          <span className="min-w-0 truncate">{story.region.name}</span>
        </>
      )}
      {projected ? (
        <>
          <span aria-hidden className={keep}>
            ·
          </span>
          <span className={cn("inline-flex items-center gap-1", keep)} title="Projected: a possible effect, not news yet">
            <Telescope aria-hidden className="size-3" />
            <span className={cn(oneLine && "sr-only")}>Projected</span>
          </span>
        </>
      ) : (
        story.first_seen && (
          <>
            <span aria-hidden className={keep}>
              ·
            </span>
            <TimeAgo value={story.first_seen} className={keep} />
          </>
        )
      )}
      {story.is_sample && showSample && <SampleBadge iconOnly className="ml-0.5" />}
    </span>
  );
}

/** How a link reads in a list: mechanism, then type and confidence (and the branch). */
export function LinkLine({
  link,
  branch,
  ai = false,
  className,
}: {
  link: Pick<CascadeLink, "mechanism" | "link_type" | "confidence">;
  branch?: BranchInfo | null;
  ai?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="text-label font-medium text-fg">{capitalise(link.mechanism)}</span>
      <ConfidenceMeter confidence={link.confidence} linkType={link.link_type} />
      {branch && <BranchBadge branch={branch} />}
      {ai && <span className="text-label text-fg-muted">AI projection</span>}
    </span>
  );
}

/** A story one step from another, with the link between them. Tapping opens it. */
export function LinkedStoryRow({
  story,
  link,
  branch,
  onOpen,
}: {
  story: StorySummary;
  link: CascadeLink;
  branch: BranchInfo | null;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(story.id)}
        aria-label={`${story.headline}. ${linkSummary(link, branch)}`}
        className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
      >
        <ImpactTile impact={story.analysed ? story.impact : "neutral"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
          <LinkLine link={link} branch={branch} />
          <StoryMeta story={story} />
        </span>
        <ChevronRight aria-hidden className="mt-2.5 size-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}
