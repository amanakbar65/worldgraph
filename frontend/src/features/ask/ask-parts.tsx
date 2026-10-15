/**
 * The pieces of an Ask answer: bullets with their citations, the mini
 * cascade, related crowd forecasts, follow-ups, and the states around them
 * (searching, AI problems, what WorldGraph found without an answer).
 */
import { ChevronRight, Hourglass, MessageCircle, RotateCw, Users, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { CascadeLink, ForecastSummary } from "@/api/contract";
import type { AiEngine, AiError } from "@/ai/engine";
import { EmptyState } from "@/components/EmptyState";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { ChipButton } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftLabel, ImpactTile, LinkLine, StoryMeta } from "@/features/story/story-parts";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, eventTypeKey, type IconInfo } from "@/lib/icons";
import { LINK_TYPES, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { aiProblemCopy, volumeText } from "./ask-copy";
import type { AskStory, CascadeChain, ShapedAnswer } from "./ask-data";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A titled block of the answer. */
export function AnswerSection({
  title,
  icon: Icon,
  note,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <h4 id={id} className="flex items-center gap-1.5 text-label font-medium text-fg-muted">
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        {title}
        {note && <span className="font-normal text-fg-subtle">· {note}</span>}
      </h4>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Citations and bullets
// ---------------------------------------------------------------------------

const DRAFT_ICON: IconInfo = { icon: Hourglass, name: "hourglass" };

/** A cited story as a chip: its event icon in the impact colour and the headline. Opens the story. */
export function CitationChip({ story, onOpen }: { story: AskStory; onOpen: (id: string) => void }) {
  const tone = impactTone(story.analysed ? story.impact : "neutral");
  const info = story.analysed ? (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON) : DRAFT_ICON;
  const Icon = info.icon;
  return (
    <ChipButton
      size="sm"
      onClick={() => onOpen(story.id)}
      title={story.headline}
      aria-label={`Source story: ${story.headline}${story.analysed ? "" : " (draft, awaiting analysis)"}`}
      className="max-w-[15rem] border-line bg-surface-2/60"
    >
      <Icon aria-hidden className={tone.text} />
      <span className="truncate text-fg">{story.headline}</span>
    </ChipButton>
  );
}

export function AnswerBullets({ answer, onOpenStory }: { answer: ShapedAnswer; onOpenStory: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {answer.bullets.map((bullet, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-fg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="text-body text-fg">{bullet.text}</p>
            <div className="flex flex-wrap gap-1.5" aria-label="Sources for this point" role="group">
              {bullet.cites.map((story) => (
                <CitationChip key={story.id} story={story} onOpen={onOpenStory} />
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Mini cascade
// ---------------------------------------------------------------------------

function StoryNode({
  story,
  onOpen,
  showSample = true,
}: {
  story: AskStory;
  onOpen: (id: string) => void;
  showSample?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(story.id)}
      className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
    >
      <ImpactTile impact={story.analysed ? story.impact : "neutral"} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-body text-fg">{story.headline}</span>
        {story.analysed ? (
          <StoryMeta story={story} oneLine showSample={showSample} />
        ) : (
          <DraftLabel className="self-start" />
        )}
      </span>
      <ChevronRight aria-hidden className="mt-1.5 size-4 shrink-0 text-fg-subtle" />
    </button>
  );
}

/** The line between two stories, drawn the way the cascade draws its link type. */
function Connector({ link }: { link: CascadeLink }) {
  const dash = LINK_TYPES[link.link_type]?.dasharray;
  return (
    <div className="flex items-stretch gap-3 pl-2">
      <svg aria-hidden viewBox="0 0 28 40" preserveAspectRatio="none" className="h-auto min-h-9 w-7 shrink-0">
        <line
          x1="14"
          x2="14"
          y1="0"
          y2="40"
          className="stroke-fg-subtle"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <LinkLine link={link} className="py-2" />
    </div>
  );
}

/** From → mechanism → to, for each run of linked stories, with each link's type and confidence. */
export function MiniCascade({
  chains,
  onOpenStory,
  showSample = true,
}: {
  chains: CascadeChain[];
  onOpenStory: (id: string) => void;
  /** Off when one badge already labels the whole answer as sample data. */
  showSample?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {chains.map((chain, c) => (
        <ol
          key={c}
          aria-label={`Chain of ${chain.nodes.length} linked stories`}
          className="flex flex-col rounded-xl border border-line bg-surface/60 p-1"
        >
          {chain.nodes.map((node, i) => (
            <li key={node.id} className="flex flex-col">
              {i > 0 && <Connector link={chain.links[i - 1]} />}
              <StoryNode story={node} onOpen={onOpenStory} showSample={showSample} />
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crowd forecasts
// ---------------------------------------------------------------------------

/** A crowd forecast as a ring with its title, provider, volume and last update. Opens the forecast. */
export function CrowdForecastRow({
  forecast,
  onOpen,
  showSample = true,
}: {
  forecast: ForecastSummary;
  onOpen: (id: string) => void;
  showSample?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(forecast.id)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
    >
      <ProbabilityRing
        size="sm"
        probability={forecast.probability}
        change24h={forecast.change_24h}
        thin={forecast.thin}
        label={forecast.short_title}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body text-fg">{forecast.short_title}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
          <span className="inline-flex items-center gap-1 text-forecast">
            <Users aria-hidden className="size-3.5" />
            Crowd forecast
          </span>
          <span aria-hidden>·</span>
          <span>{forecast.provider_name}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{volumeText(forecast)}</span>
          {forecast.updated_at && (
            <>
              <span aria-hidden>·</span>
              <TimeAgo value={forecast.updated_at} prefix="Updated" />
            </>
          )}
          {forecast.is_sample && showSample && <SampleBadge iconOnly />}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups and suggestions
// ---------------------------------------------------------------------------

/** Questions to ask next; tapping one asks it. */
export function QuestionList({
  questions,
  onAsk,
  disabled = false,
}: {
  questions: readonly string[];
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {questions.map((q) => (
        <li key={q}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(q)}
            className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface/60 px-3 py-2 text-left text-body text-fg transition-colors hover:border-line-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle aria-hidden className="size-4 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1">{q}</span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// What WorldGraph found (when there is no AI answer)
// ---------------------------------------------------------------------------

export function FoundStories({
  stories,
  forecasts,
  onOpenStory,
  onOpenForecast,
}: {
  stories: readonly AskStory[];
  forecasts: readonly ForecastSummary[];
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}) {
  if (stories.length === 0 && forecasts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {stories.length > 0 && (
        <AnswerSection title="Closest stories in WorldGraph" note="facts from sources">
          <ul className="flex flex-col">
            {stories.slice(0, 4).map((story) => (
              <li key={story.id}>
                <StoryNode story={story} onOpen={onOpenStory} />
              </li>
            ))}
          </ul>
        </AnswerSection>
      )}
      {forecasts.length > 0 && (
        <AnswerSection title="Related crowd forecasts" icon={Users}>
          <ul className="flex flex-col">
            {forecasts.slice(0, 2).map((f) => (
              <li key={f.id}>
                <CrowdForecastRow forecast={f} onOpen={onOpenForecast} />
              </li>
            ))}
          </ul>
        </AnswerSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI problems
// ---------------------------------------------------------------------------

export function AiProblem({
  kind,
  message,
  engine,
  onRetry,
}: {
  kind: AiError["kind"];
  message: string;
  engine: AiEngine["kind"] | null;
  onRetry: () => void;
}) {
  const copy = aiProblemCopy(kind, engine, message);
  return (
    <EmptyState
      role="alert"
      compact
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      action={copy.retry ? { label: copy.retry, onClick: onRetry, icon: RotateCw } : undefined}
      className="rounded-xl border border-line bg-surface/60"
    />
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="mt-2 size-1.5 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className={cn("h-3.5", i === 1 ? "w-1/2" : "w-4/5")} />
            <Skeleton className="h-6 w-40 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
