import { Users } from "lucide-react";

import { formatPointChange, formatProbability } from "@/lib/format";
import { describeForecast } from "@/lib/meaning";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { px: 44, stroke: 4, text: "text-body", icon: false },
  md: { px: 88, stroke: 6, text: "text-figure", icon: true },
  lg: { px: 120, stroke: 8, text: "text-figure", icon: true },
} as const;

export interface ProbabilityRingProps {
  /** P(YES), 0..1. The ring fills to this share. */
  probability: number;
  /** 24-hour change in probability units (0.08 = ▲ 8 points). Null or omitted hides it. */
  change24h?: number | null;
  /** A soft halo for big movers. It pulses gently unless motion is reduced. */
  glow?: boolean;
  /** Low-liquidity market: the ring fades and a "Thin market" tag appears. */
  thin?: boolean;
  /** `sm` 44 px (lists), `md` 88 px (cards, default), `lg` 120 px (detail). */
  size?: keyof typeof SIZES;
  /** What the forecast is about, prepended to the accessible name. */
  label?: string;
  className?: string;
}

/**
 * A crowd forecast as a violet ring: the fill is the probability, the large
 * number in the middle is the percentage, and the 24-hour change sits below
 * in points. Forecasts never look like facts: ring shape, violet, crowd icon.
 */
export function ProbabilityRing({
  probability,
  change24h,
  glow = false,
  thin = false,
  size = "md",
  label,
  className,
}: ProbabilityRingProps) {
  const spec = SIZES[size];
  const p = Math.min(1, Math.max(0, probability));
  const strokeWidth = (spec.stroke * 100) / spec.px;
  const r = 50 - strokeWidth / 2;
  const circumference = 2 * Math.PI * r;
  const description = describeForecast(p, change24h, thin);
  const hasChange = change24h !== undefined && change24h !== null;

  return (
    <div
      role="img"
      aria-label={label ? `${label}: ${description}` : description}
      className={cn("inline-flex shrink-0 flex-col items-center gap-1", className)}
    >
      <div
        className={cn("relative", thin && "opacity-55")}
        style={{ width: spec.px, height: spec.px }}
        aria-hidden
      >
        {glow && (
          <span
            className="absolute inset-0 animate-pulse rounded-full"
            style={{ boxShadow: "0 0 18px 3px color-mix(in oklch, var(--forecast) 55%, transparent)" }}
          />
        )}
        <svg viewBox="0 0 100 100" className="relative size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-forecast/20"
            strokeDasharray={thin ? "2 3" : undefined}
          />
          {p > 0 && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap={p < 1 ? "round" : "butt"}
              className="stroke-forecast"
              strokeDasharray={`${p * circumference} ${circumference}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {spec.icon && <Users className="size-3.5 text-forecast" />}
          <span className={cn(spec.text, "leading-none font-semibold text-fg tabular-nums")}>
            {formatProbability(p)}
          </span>
        </div>
      </div>
      {(hasChange || thin) && (
        <div className="flex flex-col items-center gap-0.5" aria-hidden>
          {hasChange && <span className="text-label text-fg-muted tabular-nums">{formatPointChange(change24h)}</span>}
          {thin && (
            <span className="rounded-full border border-dashed border-line-strong px-1.5 text-label whitespace-nowrap text-fg-muted">
              Thin market
            </span>
          )}
        </div>
      )}
    </div>
  );
}
