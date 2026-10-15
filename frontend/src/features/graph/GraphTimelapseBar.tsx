import { History, Pause, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

import type { Timelapse } from "./use-timelapse";

export interface GraphTimelapseBarProps {
  timelapse: Timelapse;
  /** Nodes on show at the cursor, and in all. */
  shown: number;
  total: number;
  calm: boolean;
  /** A shorter button label (phones). */
  compact?: boolean;
  className?: string;
}

/**
 * Replays how the graph grew. Off: one button. On: play/pause, a scrubber
 * with the date and how many nodes have appeared, and a close button.
 * Under reduced motion it steps instead of gliding.
 */
export function GraphTimelapseBar({ timelapse, shown, total, calm, compact = false, className }: GraphTimelapseBarProps) {
  const { active, playing, range, cursor } = timelapse;
  if (!range) return null;

  if (!active) {
    const long = calm ? "Step through how the graph grew" : "Replay how the graph grew";
    return (
      <Button
        variant="outline"
        onClick={timelapse.start}
        className={cn("border-line bg-glass shadow-panel backdrop-blur-xl", compact && "px-3", className)}
        title={long}
        aria-label={long}
      >
        <History aria-hidden />
        {compact ? (calm ? "Steps" : "Replay") : calm ? "Step through growth" : "Replay growth"}
      </Button>
    );
  }

  const span = Math.max(1, range.end - range.start);
  const step = Math.max(1, Math.round(span / 100));
  const date = formatDate(cursor);
  return (
    <div
      role="group"
      aria-label="Graph growth replay"
      className={cn(
        "flex h-12 items-center gap-2 rounded-xl border border-line bg-glass pr-1 pl-1 shadow-panel backdrop-blur-xl",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={timelapse.toggle}
        aria-label={playing ? "Pause replay" : "Play replay"}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <input
        type="range"
        min={range.start}
        max={range.end}
        step={step}
        value={Math.min(range.end, Math.max(range.start, cursor))}
        onChange={(e) => timelapse.seek(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={`${date}: ${shown} of ${total} items`}
        className="h-10 min-w-0 flex-1 cursor-pointer accent-[var(--ring)]"
      />
      <p className="w-28 shrink-0 text-right text-label text-fg-muted tabular-nums" aria-live="off">
        <span className="block font-medium text-fg">{date}</span>
        {shown} of {total}
      </p>
      <Button variant="ghost" size="icon" onClick={timelapse.stop} aria-label="Close replay">
        <X aria-hidden />
      </Button>
    </div>
  );
}
