/**
 * Small pieces shared by the region panel and Compare: the window switch,
 * impact counts with icons, a stacked impact bar, the sector pulse grid,
 * story rows (drafts included) and child-region rows.
 */
import { ChevronRight, Hourglass } from "lucide-react";

import type { Direction, StorySummary, TimeWindow } from "@/api/contract";
import { SampleBadge } from "@/components/SampleBadge";
import { StoryCard } from "@/components/StoryCard";
import { TimeAgo } from "@/components/TimeAgo";
import { Chip } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, IMPACT_ICONS, SECTORS, eventTypeKey } from "@/lib/icons";
import { DIRECTION_ARROWS, impactTone } from "@/lib/meaning";
import { TIME_WINDOWS, WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";

import { describeCounts, impactShares, totalOf, type ImpactCounts, type PulseTile, type RegionChild } from "./region-data";

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const WINDOW_OPTIONS = TIME_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w].short, ariaLabel: WINDOW_LABELS[w].long }));

/** 24 h / 7 d / 30 d, shared with the globe (it lives in the navigation state). */
export function WindowSwitch({ className }: { className?: string }) {
  const value = useNav((s) => s.window);
  const setWindow = useNav((s) => s.setWindow);
  return (
    <Segmented<TimeWindow>
      size="sm"
      aria-label="Time window"
      value={value}
      onValueChange={setWindow}
      options={WINDOW_OPTIONS}
      className={className}
    />
  );
}

/** A quiet "Updating…" while fresh data replaces what's on screen. */
export function Updating({ active }: { active: boolean }) {
  return (
    <span role="status" aria-live="polite" className="text-label text-fg-muted">
      {active ? "Updating…" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Impact counts
// ---------------------------------------------------------------------------

/** "✦ 3  ⚠ 2  – 1": each count with its impact icon (non-zero ones only). */
export function ImpactCountsInline({ counts, className }: { counts: ImpactCounts; className?: string }) {
  const parts = (["opportunity", "risk", "neutral"] as const).filter((k) => counts[k] > 0);
  if (parts.length === 0) {
    return <span className={cn("text-label text-fg-subtle", className)}>No stories</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-2 text-label tabular-nums", className)}>
      {parts.map((impact) => {
        const tone = impactTone(impact);
        const Icon = IMPACT_ICONS[impact].icon;
        return (
          <span key={impact} className="inline-flex items-center gap-0.5 text-fg-muted" title={`${counts[impact]} ${impact}`}>
            <Icon aria-hidden className={cn("size-3.5", tone.text)} />
            <span aria-hidden>{counts[impact]}</span>
            <span className="sr-only">
              {counts[impact]} {impact}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A thin stacked bar of opportunity / neutral / risk shares. Decorative: pair it with ImpactCountsInline. */
export function ImpactSplitBar({ counts, scale = 1, className }: { counts: ImpactCounts; scale?: number; className?: string }) {
  const shares = impactShares(counts);
  return (
    <span aria-hidden className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <span className="flex h-full gap-px" style={{ width: `${Math.max(0, Math.min(1, scale)) * 100}%` }}>
        {shares.map((s) => (
          <span key={s.impact} className={cn("h-full first:rounded-l-full last:rounded-r-full", impactTone(s.impact).bg)} style={{ width: `${s.share * 100}%` }} />
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sector pulse
// ---------------------------------------------------------------------------

/** ▲ / ▼ for momentum vs the previous window. */
export function MomentumArrow({ direction, className }: { direction: Direction | null; className?: string }) {
  if (!direction) return null;
  return (
    <span aria-hidden className={cn("text-fg-muted", className)}>
      {DIRECTION_ARROWS[direction]}
    </span>
  );
}

/**
 * Nine sector tiles. Each shows how many stories touch the sector, the
 * dominant impact (icon and wash), and ▲▼ against the previous window.
 * Tapping one turns that sector's lens on or off for the whole app.
 */
export function SectorPulseGrid({
  tiles,
  selected,
  onToggle,
}: {
  tiles: readonly PulseTile[];
  selected: readonly string[];
  onToggle: (tile: PulseTile) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => {
        const on = selected.includes(tile.sector);
        const quiet = tile.count === 0;
        const tone = impactTone(tile.impact);
        const SectorIcon = SECTORS[tile.sector].icon;
        const ImpactIcon = IMPACT_ICONS[tile.impact].icon;
        return (
          <li key={tile.sector} className="min-w-0">
            <button
              type="button"
              aria-pressed={on}
              aria-label={`${tile.description} ${on ? "Lens on." : "Tap to filter by this sector."}`}
              title={tile.description}
              onClick={() => onToggle(tile)}
              className={cn(
                "flex min-h-14 w-full cursor-pointer flex-col justify-between gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
                quiet ? "border-line bg-transparent hover:bg-surface-2/60" : cn(tone.border, tone.tint, "hover:border-line-strong"),
                on && "outline-2 outline-offset-1 outline-fg/70",
              )}
            >
              <span className="flex items-center gap-1.5">
                <SectorIcon aria-hidden className={cn("size-4 shrink-0", quiet ? "text-fg-subtle" : "text-fg-muted")} />
                <span className="ml-auto inline-flex items-center gap-1 text-label tabular-nums">
                  {!quiet && <ImpactIcon aria-hidden className={cn("size-3.5", tone.text)} />}
                  <span className={quiet ? "text-fg-subtle" : "font-semibold text-fg"}>{tile.count}</span>
                  <MomentumArrow direction={tile.direction} />
                </span>
              </span>
              <span className={cn("truncate text-label", quiet ? "text-fg-subtle" : "font-medium text-fg")}>{tile.shortLabel}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/**
 * A story in a list. Analysed stories use the compact story card; drafts
 * from the live feed show their source headline with a "Draft · awaiting
 * analysis" label and no impact (nothing is invented before analysis).
 */
export function RegionStoryRow({ story, onOpen }: { story: StorySummary; onOpen: (id: string) => void }) {
  if (story.analysed) return <StoryCard story={story} variant="compact" onOpen={() => onOpen(story.id)} />;
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(story.id)}
      aria-label={`${story.headline}. Draft, awaiting analysis.`}
      className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong">
        <EventIcon className="size-4 text-fg-muted" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted">
          <Chip tone="outline" title="Straight from the news feed; the summary and actions come after analysis">
            <Hourglass aria-hidden />
            Draft · awaiting analysis
          </Chip>
          {story.first_seen && <TimeAgo value={story.first_seen} />}
          {story.is_sample && <SampleBadge iconOnly />}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

/** A state, city or member country with its story counts. Tapping opens it. */
export function ChildRow({ child, max, onOpen }: { child: RegionChild; max: number; onOpen: (id: string) => void }) {
  const total = totalOf(child);
  const quiet = total === 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(child.id)}
      aria-label={`${child.name}: ${describeCounts(child)}.`}
      className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/70"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={cn("truncate text-body", quiet ? "text-fg-muted" : "font-medium text-fg")}>{child.name}</span>
        {!quiet && <ImpactSplitBar counts={child} scale={max > 0 ? total / max : 0} className="h-1" />}
      </span>
      <ImpactCountsInline counts={child} className="shrink-0" />
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
    </button>
  );
}
