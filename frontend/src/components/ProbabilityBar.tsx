import { formatPointChange, formatProbability } from "@/lib/format";
import { describeForecast } from "@/lib/meaning";
import { cn } from "@/lib/utils";

export interface ProbabilityBarProps {
  /** P(YES), 0..1. */
  probability: number;
  /** 24-hour change in probability units (0.08 = ▲ 8 points). Null or omitted hides it. */
  change24h?: number | null;
  /** Low-liquidity market: the bar fades and its track turns dashed. */
  thin?: boolean;
  /** What the forecast is about, prepended to the accessible name. */
  label?: string;
  /** `sm` for dense lists (6 px bar), `md` default (8 px bar). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * A crowd forecast as a horizontal violet bar, with the percentage and the
 * 24-hour change in points beside it.
 */
export function ProbabilityBar({ probability, change24h, thin = false, label, size = "md", className }: ProbabilityBarProps) {
  const p = Math.min(1, Math.max(0, probability));
  const description = describeForecast(p, change24h, thin);
  const hasChange = change24h !== undefined && change24h !== null;
  return (
    <div
      role="img"
      aria-label={label ? `${label}: ${description}` : description}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <div
        aria-hidden
        className={cn(
          "relative min-w-12 flex-1 overflow-hidden rounded-full",
          size === "sm" ? "h-1.5" : "h-2",
          thin ? "border border-dashed border-forecast/45 bg-transparent" : "bg-forecast/18",
        )}
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", thin ? "bg-forecast/55" : "bg-forecast")}
          style={{ width: `${p * 100}%` }}
        />
      </div>
      <span
        aria-hidden
        className={cn("w-10 shrink-0 text-right font-semibold tabular-nums", size === "sm" ? "text-label" : "text-body", thin ? "text-fg-muted" : "text-fg")}
      >
        {formatProbability(p)}
      </span>
      {hasChange && (
        <span aria-hidden className="w-9 shrink-0 text-label whitespace-nowrap text-fg-muted tabular-nums">
          {formatPointChange(change24h)}
        </span>
      )}
    </div>
  );
}
