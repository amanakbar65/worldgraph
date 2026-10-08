import type { Kpi } from "@/api/contract";
import { SampleBadge } from "@/components/SampleBadge";
import { Sparkline } from "@/components/Sparkline";
import { impactTone, kpiChangeImpact } from "@/lib/meaning";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Digits that suit the size of the number: 81.24, 412.6, 1,284, 1.4M. */
function formatValue(value: number, locale?: string): string {
  const abs = Math.abs(value);
  if (abs >= 100_000) {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

const isPercent = (unit: string) => unit.trim() === "%";

export interface KpiTileProps {
  /** One indicator from api.region / api.entity / api.compare. */
  kpi: Kpi;
  /** Number formatting locale; defaults to the viewer's. */
  locale?: string;
  /** Makes the tile a button, e.g. to open the indicator page. */
  onClick?: (kpi: Kpi) => void;
  className?: string;
}

/**
 * A KPI at a glance: name, the latest value with its unit, the change with
 * ▲/▼ coloured by what the change means (up on a "worse" indicator is risk
 * amber, up on a "better" one is opportunity teal), and a quiet sparkline.
 */
export function KpiTile({ kpi, locale, onClick, className }: KpiTileProps) {
  const impact = kpiChangeImpact(kpi.change, kpi.higher_is);
  const tone = impactTone(impact);
  const percent = isPercent(kpi.unit);
  const value = formatValue(kpi.latest, locale);
  const change = kpi.change;
  const changeText =
    change === null
      ? null
      : `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${formatValue(Math.abs(change), locale)}${percent ? " pts" : ""}`;
  const changeWords =
    change === null
      ? ""
      : change === 0
        ? "unchanged"
        : `${change > 0 ? "up" : "down"} ${formatValue(Math.abs(change), locale)}${percent ? " points" : ` ${kpi.unit}`}`;
  const asOf = formatDate(kpi.as_of, undefined, locale);
  const summary = `${kpi.name}: ${value}${percent ? "%" : ` ${kpi.unit}`}${changeWords ? `, ${changeWords}` : ""}${
    impact !== "neutral" ? ` (${tone.label.toLowerCase()})` : ""
  }, as of ${asOf}. Source: ${kpi.source_name}.`;

  const body = (
    <>
      <div aria-hidden className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-label text-fg-muted">{kpi.name}</span>
        {kpi.is_sample && <SampleBadge iconOnly />}
      </div>
      <div aria-hidden className="flex items-baseline gap-1">
        <span className="text-figure font-semibold text-fg tabular-nums">
          {value}
          {percent && "%"}
        </span>
        {!percent && <span className="truncate text-label text-fg-muted">{kpi.unit}</span>}
      </div>
      <div aria-hidden className="flex items-center gap-2">
        {changeText && (
          <span className={cn("shrink-0 text-label font-medium whitespace-nowrap tabular-nums", tone.text)}>
            {changeText}
          </span>
        )}
        <Sparkline
          values={kpi.series.map((pt) => pt.v)}
          tone="muted"
          endTone={impact}
          className="h-7 min-w-0 flex-1"
        />
      </div>
      <span className="sr-only">
        {summary}
        {kpi.is_sample ? " Sample data." : ""}
      </span>
    </>
  );

  const look = cn(
    "flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-2/50 p-3 text-left",
    className,
  );
  const title = `As of ${asOf} · ${kpi.source_name}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(kpi)}
        title={title}
        className={cn(look, "cursor-pointer transition-colors hover:border-line-strong hover:bg-surface-2")}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={look} title={title}>
      {body}
    </div>
  );
}
