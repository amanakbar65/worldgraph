import type { Impact } from "@/api/contract";
import { FORECAST_TONE, IMPACT_TONES } from "@/lib/meaning";
import { cn } from "@/lib/utils";

export type SparklineTone = Impact | "forecast" | "muted";

const TONES: Record<SparklineTone, { stroke: string; fill: string; dot: string }> = {
  risk: { stroke: IMPACT_TONES.risk.stroke, fill: IMPACT_TONES.risk.fill, dot: IMPACT_TONES.risk.bg },
  opportunity: {
    stroke: IMPACT_TONES.opportunity.stroke,
    fill: IMPACT_TONES.opportunity.fill,
    dot: IMPACT_TONES.opportunity.bg,
  },
  neutral: { stroke: IMPACT_TONES.neutral.stroke, fill: IMPACT_TONES.neutral.fill, dot: IMPACT_TONES.neutral.bg },
  forecast: { stroke: FORECAST_TONE.stroke, fill: FORECAST_TONE.fill, dot: FORECAST_TONE.bg },
  muted: { stroke: "stroke-fg-subtle", fill: "fill-fg-subtle", dot: "bg-fg-muted" },
};

export interface SparklineProps {
  /** The series, oldest first. Fewer than two points draws nothing. */
  values: readonly number[];
  /** Line and wash colour. `muted` (default) keeps trends quiet. */
  tone?: SparklineTone;
  /** Colour of the end dot, to emphasise the latest value (defaults to `tone`). */
  endTone?: SparklineTone;
  /** Fixed y range, e.g. [0, 1] for probabilities. Defaults to the data's range. */
  domain?: readonly [number, number];
  /** Draws a hairline at this value (e.g. the start, or 50 %). */
  baseline?: number | null;
  /** A text alternative, read by screen readers instead of the drawing. */
  label?: string;
  /** Size comes from here (e.g. "h-8 w-24"); the line scales to fill the box. */
  className?: string;
}

/**
 * A small trend line with a soft area wash and an emphasised end dot. It
 * stretches to whatever box it is given. The drawing is hidden from screen
 * readers; pass `label` to describe it.
 */
export function Sparkline({ values, tone = "muted", endTone, domain, baseline, label, className }: SparklineProps) {
  const colors = TONES[tone];
  const dotColor = TONES[endTone ?? tone].dot;
  const finite = values.filter((v) => Number.isFinite(v));

  let lo = domain ? domain[0] : Math.min(...finite);
  let hi = domain ? domain[1] : Math.max(...finite);
  if (baseline !== undefined && baseline !== null && !domain) {
    lo = Math.min(lo, baseline);
    hi = Math.max(hi, baseline);
  }
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const n = finite.length;
  // 0..100 in both axes; y has 8 % headroom so the line never touches the edge.
  const x = (i: number) => (n === 1 ? 100 : (i / (n - 1)) * 100);
  const y = (v: number) => 92 - ((v - lo) / (hi - lo)) * 84;

  const line = finite.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join("");
  const area = n > 1 ? `${line}L100,100L0,100Z` : "";
  const end = n > 0 ? { left: x(n - 1), top: y(finite[n - 1]) } : null;

  return (
    <div className={cn("relative h-8 w-full", className)}>
      {label && <span className="sr-only">{label}</span>}
      {n > 1 && (
        <div aria-hidden className="absolute inset-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <path d={area} className={colors.fill} fillOpacity={0.12} />
            {baseline !== undefined && baseline !== null && (
              <line
                x1="0"
                x2="100"
                y1={y(baseline)}
                y2={y(baseline)}
                className="stroke-line-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={line}
              fill="none"
              className={colors.stroke}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {end && (
            <span
              className={cn("absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", dotColor)}
              style={{ left: `${end.left}%`, top: `${end.top}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
