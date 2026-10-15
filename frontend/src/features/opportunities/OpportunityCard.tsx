import { KeyRound, MapPin, Telescope } from "lucide-react";

import type { Profile } from "@/api/contract";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { HorizonChip } from "@/components/HorizonChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { SectorChip } from "@/components/SectorChip";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, SECTORS, eventTypeKey, eventTypeLabel } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { matches, ROLE_INFO, type MatchReason } from "@/state/profile";

import { DraftLabel, ForecastFacts, ScoreMeter } from "@/features/business/business-parts";
import { useEntityName } from "@/features/business/entity-names";

import { scoreNames, suitChips, whyNow, type OpportunityItem } from "./opportunity-data";

export interface OpportunityCardProps {
  item: OpportunityItem;
  rank: number;
  /** The profile, when the list is ranked for it (shows why it fits). */
  profile: Profile | null;
  /** Highlighted because its dot is under the pointer. */
  active?: boolean;
  onOpen: (storyId: string) => void;
  onOpenForecast: (forecastId: string) => void;
  onHover?: (storyId: string | null) => void;
}

/**
 * One opening: what happened, why now, who it suits, how well it fits you,
 * how fast it's moving, and the crowd's view on what comes next.
 */
export function OpportunityCard({
  item,
  rank,
  profile,
  active = false,
  onOpen,
  onOpenForecast,
  onHover,
}: OpportunityCardProps) {
  const { story, forecast } = item;
  const names = scoreNames(profile !== null);
  const reasons = profile ? matches(profile, story) : [];
  const suits = suitChips(item.suits);
  const why = whyNow(item);
  const projected = story.kind === "projected";
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;

  return (
    <article
      aria-label={`${rank}. ${story.headline}`}
      onMouseEnter={onHover ? () => onHover(story.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4 transition-colors",
        projected ? "border-dashed border-line-strong" : "border-line",
        active && "border-fg/40",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-label font-semibold text-fg tabular-nums"
        >
          {rank}
        </span>
        {story.analysed ? <ImpactBadge impact={story.impact} direction={story.direction} /> : <DraftLabel />}
        {projected ? (
          <Chip tone="outline" title="A possible next effect that hasn't happened yet">
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
          <button
            type="button"
            onClick={() => onOpen(story.id)}
            onFocus={onHover ? () => onHover(story.id) : undefined}
            className="cursor-pointer text-left underline-offset-2 hover:underline"
          >
            {story.headline}
          </button>
        </h3>
        {why && (
          <p className="text-body text-fg-muted">
            <span className="font-medium text-fg">Why now: </span>
            {why}
          </p>
        )}
      </div>

      {suits.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-label font-medium text-fg-muted">Suits</span>
          {suits.map((s) =>
            s.sector ? (
              <SectorChip key={s.label} sector={s.sector} size="sm" />
            ) : (
              <Chip key={s.label} size="sm">
                <span className="truncate">{s.label}</span>
              </Chip>
            ),
          )}
        </div>
      )}

      {reasons.length > 0 && profile && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-label font-medium text-fg-muted">Fits you</span>
          {reasons.map((r) => (
            <ReasonChip key={reasonKey(r)} reason={r} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ScoreMeter label={names.relevance} value={item.relevance} />
        <ScoreMeter label={names.momentum} value={item.momentum} />
        {story.analysed && story.confidence !== null && (
          <span className="inline-flex items-center gap-1.5 text-label text-fg-muted">
            <span aria-hidden>Confidence</span>
            <ConfidenceMeter confidence={story.confidence} />
          </span>
        )}
      </div>

      {forecast && (
        <button
          type="button"
          onClick={() => onOpenForecast(forecast.id)}
          className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg border border-forecast/30 bg-forecast/6 p-2.5 text-left transition-colors hover:bg-forecast/12"
        >
          <ProbabilityRing
            size="sm"
            probability={forecast.probability}
            change24h={forecast.change_24h}
            thin={forecast.thin}
            label={forecast.short_title}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 text-body text-fg">{forecast.short_title}</span>
            <ForecastFacts forecast={forecast} />
          </span>
        </button>
      )}

      {(story.region || (story.analysed && story.horizon)) && (
        <footer className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
          {story.region && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin aria-hidden className="size-3.5 shrink-0 text-type-region" />
              <span className="truncate">{story.region.name}</span>
            </span>
          )}
          {story.analysed && story.horizon && <HorizonChip horizon={story.horizon} />}
        </footer>
      )}
    </article>
  );
}

function reasonKey(r: MatchReason): string {
  return r.kind === "sector" ? `s:${r.sector}` : r.kind === "place" ? `p:${r.id}` : `k:${r.keyword}`;
}

/** One way the opening touches the profile: a shared sector, one of your places, or a keyword. */
function ReasonChip({ reason }: { reason: MatchReason }) {
  if (reason.kind === "sector") {
    const info = SECTORS[reason.sector];
    return (
      <Chip size="sm">
        <info.icon aria-hidden />
        <span className="truncate text-fg">{info.label}</span>
        <span className="text-fg-subtle">Sector</span>
      </Chip>
    );
  }
  if (reason.kind === "keyword") {
    return (
      <Chip size="sm">
        <KeyRound aria-hidden />
        <span className="truncate">“{reason.keyword}”</span>
      </Chip>
    );
  }
  return <PlaceChip id={reason.id} role={reason.role} />;
}

function PlaceChip({ id, role }: { id: string; role: "locations" | "suppliers" | "markets" }) {
  const entity = useEntityName(id);
  return (
    <Chip size="sm">
      <MapPin aria-hidden className="text-type-region" />
      <span className="truncate text-fg">{entity.name}</span>
      <span className="text-fg-subtle">{ROLE_INFO[role].short}</span>
    </Chip>
  );
}
