/** Small building blocks shared by My Business and Opportunities. */
import { CircleAlert, Cloud, HardDrive, Hourglass, Minus, Sparkles, Users, X, Zap } from "lucide-react";
import type { ReactNode } from "react";

import type { EntityType, ForecastSummary } from "@/api/contract";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { ENTITY_TYPE_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import type { UserStore } from "@/platform/storage";

import { volumeText, type ImpactCounts } from "./business-data";

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** A news draft from the live pipeline that the AI hasn't analysed yet. */
export function DraftLabel({ className }: { className?: string }) {
  return (
    <Chip
      tone="outline"
      className={className}
      title="Straight from the news feed; the summary and actions come after analysis"
    >
      <Hourglass aria-hidden />
      Draft · awaiting analysis
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/**
 * A 0..1 score as a short bar and a percentage, e.g. relevance or momentum.
 * Neutral ink: it measures fit or pace, not risk or opportunity.
 */
export function ScoreMeter({
  label,
  value,
  className,
  showLabel = true,
}: {
  /** e.g. "Relevance"; also the start of the accessible name. */
  label: string;
  value: number;
  className?: string;
  showLabel?: boolean;
}) {
  const v = Math.min(1, Math.max(0, value));
  const pct = Math.round(v * 100);
  return (
    <span
      role="img"
      aria-label={`${label} ${pct}%`}
      className={cn("inline-flex items-center gap-1.5 text-label text-fg-muted", className)}
    >
      {showLabel && <span aria-hidden>{label}</span>}
      <span aria-hidden className="relative h-1.5 w-10 overflow-hidden rounded-full bg-line-strong">
        <span className="absolute inset-y-0 left-0 rounded-full bg-fg-muted" style={{ width: `${pct}%` }} />
      </span>
      <span aria-hidden className="w-8 text-right font-medium text-fg tabular-nums">
        {pct}%
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Impact counts
// ---------------------------------------------------------------------------

/** Counts with their icons: amber risk, teal opportunity, slate the rest. Never colour alone. */
export function ImpactCountsInline({ counts, className }: { counts: ImpactCounts; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-2 text-label tabular-nums", className)}>
      {counts.risk > 0 && (
        <span className="inline-flex items-center gap-0.5 font-medium text-risk">
          <CircleAlert className="size-3.5" />
          {counts.risk}
        </span>
      )}
      {counts.opportunity > 0 && (
        <span className="inline-flex items-center gap-0.5 font-medium text-opportunity">
          <Sparkles className="size-3.5" />
          {counts.opportunity}
        </span>
      )}
      {counts.other > 0 && (
        <span className="inline-flex items-center gap-0.5 text-neutral">
          <Minus className="size-3.5" />
          {counts.other}
        </span>
      )}
    </span>
  );
}

/** A thin bar split by impact; its width shows the share of the busiest row. */
export function ImpactSplitBar({
  counts,
  scale,
  className,
}: {
  counts: ImpactCounts;
  scale: number;
  className?: string;
}) {
  const total = counts.risk + counts.opportunity + counts.other;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span aria-hidden className={cn("block h-1.5 overflow-hidden rounded-full bg-line", className)}>
      <span className="flex h-full" style={{ width: `${Math.max(0.08, Math.min(1, scale)) * 100}%` }}>
        <span className="h-full bg-risk" style={{ width: pct(counts.risk) }} />
        <span className="h-full bg-opportunity" style={{ width: pct(counts.opportunity) }} />
        <span className="h-full bg-neutral/70" style={{ width: pct(counts.other) }} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** An entity type's icon in its fixed colour. */
export function TypeIcon({ type, className }: { type: EntityType; className?: string }) {
  const Icon = (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.region).icon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", entityTypeTone(type).text, className)} />;
}

/**
 * A chosen profile or watchlist entry: type icon, name and a remove button.
 * The remove button is 40 px tall for thumbs while the chip looks small.
 */
export function RemovableChip({
  type,
  name,
  onRemove,
  removeLabel,
  muted = false,
  children,
}: {
  type: EntityType;
  name: string;
  onRemove: () => void;
  removeLabel: string;
  /** Still loading or no longer available. */
  muted?: boolean;
  children?: ReactNode;
}) {
  const tone = entityTypeTone(type);
  const Icon = (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.region).icon;
  return (
    <span
      className={cn(
        "inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-surface-2/70 pr-0.5 pl-2.5 text-label font-medium",
        tone.border,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", tone.text)} />
      <span className={cn("truncate", muted ? "text-fg-muted" : "text-fg")}>{name}</span>
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-surface-2 hover:text-fg"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Forecasts
// ---------------------------------------------------------------------------

/**
 * The facts every forecast carries: "Crowd forecast · Manifold · 12K MANA
 * volume · Updated 2 h ago". Information only.
 */
export function ForecastFacts({ forecast, className }: { forecast: ForecastSummary; className?: string }) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label text-fg-muted",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 font-medium text-forecast">
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
      {forecast.thin && (
        <span className="rounded-full border border-dashed border-line-strong px-1.5">Thin market</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Where things are saved
// ---------------------------------------------------------------------------

const STORE_COPY: Record<UserStore["kind"], { icon: typeof Cloud; text: string; detail: string }> = {
  cloud: {
    icon: Cloud,
    text: "Saved to your Claude account",
    detail: "Private to you, on any device where you open this link.",
  },
  browser: {
    icon: HardDrive,
    text: "Saved in this browser",
    detail: "It stays on this device; clearing site data removes it.",
  },
  memory: {
    icon: Zap,
    text: "Kept for this visit only",
    detail: "This view can't save, so it resets when you close the page.",
  },
};

/** Where the profile and watchlist are saved, in plain words. */
export function StoreNote({
  kind,
  error,
  showDetail = false,
  className,
}: {
  kind: UserStore["kind"] | null;
  error?: Error | null;
  showDetail?: boolean;
  className?: string;
}) {
  if (!kind) return null;
  const copy = STORE_COPY[kind];
  const Icon = copy.icon;
  return (
    <p role="status" className={cn("flex items-start gap-1.5 text-label text-fg-muted", className)}>
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        {error ? "Couldn't save just now; your changes are kept for this visit." : copy.text}
        {showDetail && !error && (
          <span className="text-fg-subtle"> · {copy.detail} Only your choices and keywords, nothing personal.</span>
        )}
      </span>
    </p>
  );
}
