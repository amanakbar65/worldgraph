import { ArrowRight, Telescope, Users } from "lucide-react";

import type { ForecastSummary, SectorId, StorySummary } from "@/api/contract";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { EntityChip, type EntityChipEntity } from "@/components/EntityChip";
import { HorizonChip } from "@/components/HorizonChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { SampleBadge } from "@/components/SampleBadge";
import { SectorChip } from "@/components/SectorChip";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, IMPACT_ICONS, eventTypeKey, eventTypeLabel } from "@/lib/icons";
import { DIRECTION_ARROWS, DIRECTION_WORDS, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

/** A story summary, plus its actions when the caller has them (api.story, api.affects). */
export type StoryCardStory = StorySummary & { actions?: readonly string[] };

export interface StoryCardProps {
  story: StoryCardStory;
  /** `compact`: icon + headline (the globe's Top 5). `full` (default): the card. */
  variant?: "compact" | "full";
  /** Position in a ranked list (compact only), e.g. 1–5. */
  rank?: number;
  /** Optional crowd forecast row ("what the crowd expects next"). */
  forecast?: ForecastSummary | null;
  /** Opens the story. Compact cards become one button; full cards make the headline a button. */
  onOpen?: (story: StoryCardStory) => void;
  /** Called from the region chip. */
  onEntityClick?: (entity: EntityChipEntity) => void;
  onSectorClick?: (sector: SectorId) => void;
  onForecastClick?: (forecast: ForecastSummary) => void;
  className?: string;
}

/**
 * A story at two depths. Compact is the glance: event icon in the impact
 * colour, headline, and one quiet line (impact, place, time). Full is the
 * tap: what happened, why it matters, three chips, the crowd's view, and
 * what you could do.
 */
export function StoryCard(props: StoryCardProps) {
  return props.variant === "compact" ? <CompactStory {...props} /> : <FullStory {...props} />;
}

function CompactStory({ story, rank, onOpen, className }: StoryCardProps) {
  const tone = impactTone(story.impact);
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;
  const ImpactIcon = (IMPACT_ICONS[story.impact] ?? IMPACT_ICONS.neutral).icon;
  const body = (
    <>
      {rank !== undefined && (
        <span aria-hidden className="w-3 shrink-0 pt-2.5 text-center text-label text-fg-subtle tabular-nums">
          {rank}
        </span>
      )}
      <span
        aria-hidden
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", tone.tint, tone.border)}
      >
        <EventIcon className={cn("size-4", tone.text)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
          <span className={cn("inline-flex items-center gap-1 font-medium", tone.text)}>
            <ImpactIcon aria-hidden className="size-3.5" />
            {tone.label}
            {story.direction && (
              <>
                <span aria-hidden>{DIRECTION_ARROWS[story.direction]}</span>
                <span className="sr-only">, {DIRECTION_WORDS[story.direction]}</span>
              </>
            )}
          </span>
          {story.region && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{story.region.name}</span>
            </>
          )}
          {story.first_seen && (
            <>
              <span aria-hidden>·</span>
              <TimeAgo value={story.first_seen} />
            </>
          )}
          {story.kind === "projected" && (
            <>
              <span aria-hidden>·</span>
              <span>Projected</span>
            </>
          )}
          {story.is_sample && (
            <>
              <span aria-hidden>·</span>
              <span>Sample</span>
            </>
          )}
        </span>
      </span>
    </>
  );

  const look = cn("flex w-full items-start gap-3 rounded-lg p-2 text-left", className);
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(story)}
        className={cn(look, "cursor-pointer transition-colors hover:bg-surface-2/70")}
      >
        {body}
      </button>
    );
  }
  return <div className={look}>{body}</div>;
}

function FullStory({
  story,
  forecast,
  onOpen,
  onEntityClick,
  onSectorClick,
  onForecastClick,
  className,
}: StoryCardProps) {
  const eventKey = eventTypeKey(story.event_type);
  const EventIcon = (EVENT_TYPE_ICONS[eventKey] ?? DEFAULT_EVENT_ICON).icon;
  const projected = story.kind === "projected";
  const actions = story.actions ?? [];

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4",
        // Projections are inferences, not facts: a dashed edge keeps them apart.
        projected ? "border-dashed border-line-strong" : "border-line",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <ImpactBadge impact={story.impact} direction={story.direction} />
        {projected ? (
          <Chip tone="outline">
            <Telescope aria-hidden />
            Projected
          </Chip>
        ) : (
          <span className="inline-flex items-center gap-1 text-label text-fg-muted">
            <EventIcon aria-hidden className="size-3.5" />
            {eventTypeLabel(story.event_type)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-label text-fg-muted">
          {story.first_seen && <TimeAgo value={story.first_seen} />}
          {story.is_sample && <SampleBadge compact />}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <h3 className="text-body font-semibold text-fg">
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(story)}
              className="cursor-pointer text-left underline-offset-2 hover:underline"
            >
              {story.headline}
            </button>
          ) : (
            story.headline
          )}
        </h3>
        {story.so_what ? (
          <p className="text-body text-fg-muted">{story.so_what}</p>
        ) : (
          <p className="text-label text-fg-subtle">Analysis pending</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {story.sectors.slice(0, 2).map((sector) => (
          <SectorChip key={sector} sector={sector} size="sm" onClick={onSectorClick} />
        ))}
        {story.region && (
          <EntityChip
            size="sm"
            entity={{ id: story.region.id, type: "region", name: story.region.name }}
            onClick={onEntityClick}
          />
        )}
        {story.horizon && <HorizonChip horizon={story.horizon} />}
        {story.confidence !== null && <ConfidenceMeter confidence={story.confidence} className="ml-1" />}
      </div>

      {forecast && <CrowdRow forecast={forecast} onClick={onForecastClick} />}

      {actions.length > 0 && (
        <section aria-label="What you could do" className="flex flex-col gap-1 border-t border-line pt-3">
          <h4 className="text-label font-medium text-fg-muted">What you could do</h4>
          <ul className="flex flex-col gap-1">
            {actions.slice(0, 3).map((action) => (
              <li key={action} className="flex items-start gap-2 text-body text-fg">
                <ArrowRight aria-hidden className="mt-[3px] size-3.5 shrink-0 text-fg-muted" />
                {action}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** The crowd's view on what happens next, inside a story card. */
function CrowdRow({ forecast, onClick }: { forecast: ForecastSummary; onClick?: (f: ForecastSummary) => void }) {
  const content = (
    <>
      <Users aria-hidden className="size-4 shrink-0 text-forecast" />
      <span className="min-w-0 flex-1 truncate text-label text-fg-muted">{forecast.short_title}</span>
      <ProbabilityBar
        size="sm"
        probability={forecast.probability}
        change24h={forecast.change_24h}
        thin={forecast.thin}
        label={forecast.short_title}
        className="w-36 shrink-0"
      />
    </>
  );
  const look = "flex items-center gap-2 rounded-lg border border-forecast/30 bg-forecast/6 px-2.5 py-2 text-left";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(forecast)}
        className={cn(look, "min-h-10 w-full cursor-pointer transition-colors hover:bg-forecast/12")}
      >
        {content}
      </button>
    );
  }
  return <div className={look}>{content}</div>;
}
