import { ArrowRight, ChevronDown, CircleDot, GitBranch, KeyRound, Pencil, Radar, Target, X } from "lucide-react";
import { useId, useState } from "react";

import type { CascadeLink, Profile } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { HorizonChip } from "@/components/HorizonChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SECTORS } from "@/lib/icons";
import { LINK_TYPES } from "@/lib/meaning";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { ROLE_INFO } from "@/state/profile";

import { DraftLabel, ScoreMeter, TypeIcon } from "./business-parts";
import {
  anySample,
  buildHopChain,
  feedCounts,
  filterFeed,
  hopCount,
  isDirect,
  keywordHits,
  matchedNodes,
  sectorOfNode,
  whySentence,
  type AffectsItem,
  type FeedFilter,
  type ImpactFilter,
  type MatchedNode,
  type PathFilter,
} from "./business-data";
import type { useAffects } from "./use-business";

const PAGE = 8;

export interface AffectsFeedProps {
  affects: ReturnType<typeof useAffects>;
  profile: Profile;
  filter: FeedFilter;
  onFilter: (filter: FeedFilter) => void;
  /** Name of the node the feed is narrowed to (from "Where it reaches you"). */
  nodeName: string | null;
  onEditProfile: () => void;
}

/**
 * "Affects you": stories that touch the profile, directly or a step or two
 * down a cause-and-effect chain, most relevant first. Each says why it
 * matched, how relevant it is, and what you could do.
 */
export function AffectsFeed({ affects, profile, filter, onFilter, nodeName, onEditProfile }: AffectsFeedProps) {
  const timeWindow = useNav((s) => s.window);
  const setWindow = useNav((s) => s.setWindow);
  const [shown, setShown] = useState(PAGE);
  const headingId = useId();
  const items = affects.data?.items ?? [];
  const counts = feedCounts(items);
  const visible = filterFeed(items, filter);
  const windowWords = WINDOW_LABELS[timeWindow].long.toLowerCase();

  const impactOptions = [
    { value: "all" as const, label: `All ${counts.all}`, ariaLabel: `All, ${counts.all}` },
    { value: "risk" as const, label: `Risks ${counts.risk}`, ariaLabel: `Risks, ${counts.risk}` },
    { value: "opportunity" as const, label: `Opportunities ${counts.opportunity}`, ariaLabel: `Opportunities, ${counts.opportunity}` },
  ];
  const pathOptions = [
    { value: "all" as const, label: "Any route" },
    { value: "direct" as const, label: `Direct ${counts.direct}`, ariaLabel: `Direct matches, ${counts.direct}` },
    {
      value: "downstream" as const,
      label: `Knock-on ${counts.downstream}`,
      ariaLabel: `Knock-on effects, ${counts.downstream}`,
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        id={headingId}
        title="Affects you"
        icon={Radar}
        count={affects.data ? items.length : undefined}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Stories that touch your business, {windowWords}, most relevant first.
            {anySample(items.map((i) => i.story)) && <SampleBadge compact />}
            {affects.isPlaceholderData && affects.isFetching && <span>Updating…</span>}
          </span>
        }
      />

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ImpactFilter>
            aria-label="Show risks or opportunities"
            size="sm"
            value={filter.impact}
            onValueChange={(impact) => {
              setShown(PAGE);
              onFilter({ ...filter, impact });
            }}
            options={impactOptions}
          />
          <Segmented<PathFilter>
            aria-label="How it reaches you"
            size="sm"
            value={filter.path}
            onValueChange={(path) => {
              setShown(PAGE);
              onFilter({ ...filter, path });
            }}
            options={pathOptions}
          />
          {filter.node && (
            <Chip size="md" className="pr-0.5">
              <Target aria-hidden />
              <span className="truncate">Only {nodeName ?? "this"}</span>
              <button
                type="button"
                onClick={() => onFilter({ ...filter, node: null })}
                aria-label={`Show all stories, not only ${nodeName ?? "this one"}`}
                className="relative flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2 hover:text-fg before:absolute before:-inset-1.5 before:content-['']"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </Chip>
          )}
        </div>
      )}

      {affects.isPending && affects.ready ? (
        <FeedSkeleton />
      ) : affects.isError && !affects.data ? (
        <ErrorState error={affects.error} onRetry={() => void affects.refetch()} className="rounded-xl border border-line bg-surface" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Radar}
            title={`Nothing touches your business ${windowWords}`}
            description="A longer window or a few more places and inputs usually help."
            action={timeWindow !== "30d" ? { label: "Show 30 days", onClick: () => setWindow("30d") } : undefined}
            secondaryAction={{ label: "Edit profile", onClick: onEditProfile, icon: Pencil }}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            compact
            icon={Target}
            title="No stories match these filters"
            description="Try another filter, or show everything."
            action={{
              label: "Show everything",
              onClick: () => {
                onFilter({ impact: "all", path: "all", node: null });
              },
            }}
          />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label="Stories that affect you">
            {visible.slice(0, shown).map((item) => (
              <li key={item.story.id}>
                <AffectsCard item={item} profile={profile} />
              </li>
            ))}
          </ul>
          {visible.length > PAGE && (
            <button
              type="button"
              onClick={() => setShown(shown >= visible.length ? PAGE : shown + PAGE * 2)}
              className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line text-body text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {shown >= visible.length ? "Show fewer" : `Show more (${visible.length - shown} left)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FeedSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading stories that affect you" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-4/5" />
          <SkeletonText lines={2} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// One story
// ---------------------------------------------------------------------------

export function AffectsCard({ item, profile }: { item: AffectsItem; profile: Profile }) {
  const open = useNav((s) => s.open);
  const { story } = item;
  const nodes = matchedNodes(item.matched, profile);
  const keywords = keywordHits(story, profile);
  const direct = isDirect(item);
  const hops = hopCount(item);
  const actions = story.analysed ? item.actions.slice(0, 3) : [];
  const why = whySentence(item, profile);
  const projected = story.kind === "projected";

  return (
    <article
      aria-label={story.headline}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4",
        projected ? "border-dashed border-line-strong" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        {story.analysed ? <ImpactBadge impact={story.impact} direction={story.direction} /> : <DraftLabel />}
        <Chip tone="outline" title={direct ? "This story touches your profile itself" : "This story follows from one that touches your profile"}>
          {direct ? <CircleDot aria-hidden /> : <GitBranch aria-hidden />}
          {direct ? "Direct" : `Knock-on · ${hops} ${hops === 1 ? "step" : "steps"}`}
        </Chip>
        <ScoreMeter label="Relevance" value={item.relevance} className="ml-auto" />
      </header>

      <div className="flex flex-col gap-1">
        <h3 className="text-body font-semibold text-fg">
          <button
            type="button"
            onClick={() => open({ kind: "story", id: story.id })}
            className="cursor-pointer text-left underline-offset-2 hover:underline"
          >
            {story.headline}
          </button>
        </h3>
        {story.analysed && story.so_what && <p className="text-body text-fg-muted">{story.so_what}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="sr-only">{why}</p>
        <div aria-hidden className="flex flex-wrap items-center gap-1.5">
          <span className="text-label font-medium text-fg-muted">Why you</span>
          {nodes.map((node) => (
            <MatchChip key={node.entity.id} node={node} />
          ))}
          {keywords.map((k) => (
            <Chip key={k} size="sm">
              <KeyRound aria-hidden />
              <span className="truncate">“{k}”</span>
            </Chip>
          ))}
          {nodes.length === 0 && keywords.length === 0 && <Chip size="sm">Your profile</Chip>}
        </div>
        {!direct && <HopChain item={item} />}
      </div>

      {actions.length > 0 && (
        <section aria-label="What you could do" className="flex flex-col gap-1 border-t border-line pt-3">
          <h4 className="text-label font-medium text-fg-muted">What you could do</h4>
          <ul className="flex flex-col gap-1">
            {actions.map((action) => (
              <li key={action} className="flex items-start gap-2 text-body text-fg">
                <ArrowRight aria-hidden className="mt-[3px] size-3.5 shrink-0 text-fg-muted" />
                {action}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-fg-muted">
        {story.region && <span className="truncate">{story.region.name}</span>}
        {story.region && (story.first_seen || projected) && <span aria-hidden>·</span>}
        {projected ? <span>Projected effect</span> : <TimeAgo value={story.first_seen} />}
        {story.analysed && story.horizon && <HorizonChip horizon={story.horizon} />}
        {story.is_sample && <SampleBadge className="ml-auto" />}
      </footer>
    </article>
  );
}

/** One profile node a story reaches: its type icon, name and role ("Input"). */
function MatchChip({ node }: { node: MatchedNode }) {
  const sector = sectorOfNode(node.entity.id);
  const role = node.roles[0];
  const SectorIcon = sector ? SECTORS[sector].icon : null;
  return (
    <Chip size="sm" className="max-w-full">
      {SectorIcon ? <SectorIcon aria-hidden /> : <TypeIcon type={node.entity.type} className="size-3.5" />}
      <span className="truncate text-fg">{sector ? SECTORS[sector].label : node.entity.name}</span>
      {role && role !== "sectors" && <span className="text-fg-subtle">{ROLE_INFO[role].short}</span>}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// How a knock-on story reaches you
// ---------------------------------------------------------------------------

function HopChain({ item }: { item: AffectsItem }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
        className="relative inline-flex w-fit cursor-pointer items-center gap-1 rounded-md text-label font-medium text-fg-muted underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-[''] hover:text-fg hover:underline"
      >
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        {expanded ? "Hide how it reaches you" : "How it reaches you"}
      </button>
      <div id={panelId} hidden={!expanded}>
        {expanded && <HopChainSteps item={item} />}
      </div>
    </div>
  );
}

function HopChainSteps({ item }: { item: AffectsItem }) {
  const open = useNav((s) => s.open);
  const query = useRpc("cascade", { id: item.story.id, depth: 2 }, { staleTime: 5 * 60_000, refetchInterval: false });
  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading the chain" className="flex flex-col gap-2 rounded-lg border border-line bg-bg-sunken/60 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (query.isError) return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;
  const steps = buildHopChain(item.path, query.data);
  return (
    <ol aria-label="From the story that touches you to this one" className="flex flex-col rounded-lg border border-line bg-bg-sunken/60 p-3">
      {steps.map((step, i) => {
        const headline = step.story?.headline ?? "An earlier story";
        const last = i === steps.length - 1;
        return (
          <li key={step.id} className="flex flex-col">
            {step.link && <LinkLine link={step.link} />}
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", last ? "bg-fg" : "border border-fg-muted")}
              />
              {last ? (
                <span className="text-body text-fg">
                  {headline}
                  <span className="text-label text-fg-muted"> · this story</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => open({ kind: "story", id: step.id })}
                  className="cursor-pointer text-left text-body text-fg underline-offset-2 hover:underline"
                >
                  {headline}
                  {i === 0 && <span className="text-label text-fg-muted"> · touches your profile</span>}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The causal link between two steps: its mechanism, type (line style) and confidence. */
function LinkLine({ link }: { link: CascadeLink }) {
  const info = LINK_TYPES[link.link_type];
  return (
    <div className="ml-[3px] flex items-stretch gap-3 py-1">
      <svg aria-hidden viewBox="0 0 2 24" preserveAspectRatio="none" className="h-auto min-h-6 w-0.5 shrink-0 overflow-visible">
        <line x1="1" x2="1" y1="0" y2="24" strokeWidth={2} className="stroke-fg-muted" strokeDasharray={info?.dasharray} />
      </svg>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-label text-fg-muted">
        <span className="font-medium text-fg">{link.mechanism}</span>
        <ConfidenceMeter confidence={link.confidence} linkType={link.link_type} />
      </span>
    </div>
  );
}
