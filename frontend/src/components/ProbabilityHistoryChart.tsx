import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { HistoryPoint } from "@/api/contract";
import { formatProbability } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

const MARGIN = { top: 10, right: 46, bottom: 24, left: 40 };
const GRID = [1, 0.5, 0] as const;
const DAY = 86_400_000;

export interface ProbabilityHistoryChartProps {
  /** Snapshots of P(YES), any order; sorted by time here. */
  points: readonly Pick<HistoryPoint, "ts" | "p">[];
  /** What the forecast is about; names the chart for screen readers. */
  label: string;
  /** `line` (default) joins snapshots; `step` holds each value until the next. */
  variant?: "line" | "step";
  /** Total height in px, including the date axis. */
  height?: number;
  /** Low-liquidity market: the line fades. */
  thin?: boolean;
  locale?: string;
  className?: string;
}

/** Keeps a box's width in state (ResizeObserver reports it on mount and on resize). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * How a crowd forecast has moved: a violet line (or step) chart on a fixed
 * 0–100 % axis with three gridlines and the latest value labelled at the end.
 * Hover shows a crosshair with the value and date; the chart also takes
 * keyboard focus, and the arrow keys (Home, End) step through the points.
 */
export function ProbabilityHistoryChart({
  points,
  label,
  variant = "line",
  height = 180,
  thin = false,
  locale,
  className,
}: ProbabilityHistoryChartProps) {
  const [ref, width] = useWidth(320);
  const [active, setActive] = useState<number | null>(null);
  const descriptionId = useId();

  const data = useMemo(
    () =>
      points
        .map((pt) => ({ t: Date.parse(pt.ts), p: Math.min(1, Math.max(0, pt.p)) }))
        .filter((d) => Number.isFinite(d.t))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  const n = data.length;

  if (n === 0) {
    return (
      <div className={cn("flex items-center justify-center text-label text-fg-muted", className)} style={{ height }}>
        No history yet
      </div>
    );
  }

  const innerW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const t0 = data[0].t;
  const span = data[n - 1].t - t0 || 1;
  const x = (t: number) => MARGIN.left + (n === 1 ? innerW : ((t - t0) / span) * innerW);
  const y = (p: number) => MARGIN.top + (1 - p) * innerH;

  let line = `M${x(data[0].t)},${y(data[0].p)}`;
  for (let i = 1; i < n; i++) {
    line += variant === "step" ? `H${x(data[i].t)}V${y(data[i].p)}` : `L${x(data[i].t)},${y(data[i].p)}`;
  }
  const area = n > 1 ? `${line}L${x(data[n - 1].t)},${y(0)}L${x(t0)},${y(0)}Z` : "";
  const last = data[n - 1];
  const shortSpan = span < 3 * DAY;

  const pointDate = (t: number) =>
    shortSpan
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(t)
      : formatDate(t, data[n - 1].t, locale);

  const nearest = (px: number) => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x(data[mid].t) < px) lo = mid;
      else hi = mid;
    }
    return Math.abs(x(data[lo].t) - px) <= Math.abs(x(data[hi].t) - px) ? lo : hi;
  };

  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (box) setActive(nearest(e.clientX - box.left));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = active ?? n - 1;
    const page = Math.max(1, Math.round(n / 10));
    const next =
      e.key === "ArrowLeft"
        ? current - 1
        : e.key === "ArrowRight"
          ? current + 1
          : e.key === "PageDown"
            ? current - page
            : e.key === "PageUp"
              ? current + page
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? n - 1
                  : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };

  const activePoint = active !== null ? data[active] : null;
  // The readout sits beside the crosshair, on the side with more room.
  const activeX = activePoint ? x(activePoint.t) : 0;
  const tooltipOnLeft = activeX > MARGIN.left + innerW / 2;
  const endLabelY = Math.min(Math.max(y(last.p), MARGIN.top + 6), MARGIN.top + innerH - 6);

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={`${label}: crowd forecast history`}
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      className={cn("relative w-full rounded-md select-none", className)}
      style={{ height }}
    >
      <p id={descriptionId} className="sr-only">
        {n} points from {pointDate(t0)} to {pointDate(last.t)}, now {formatProbability(last.p)}. Use the left and right
        arrow keys to read each point.
      </p>
      <svg aria-hidden width={width} height={height} className="absolute inset-0 overflow-visible">
        {GRID.map((g) => (
          <g key={g}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + innerW}
              y1={y(g)}
              y2={y(g)}
              className="stroke-line-strong"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={MARGIN.left - 8}
              y={y(g)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-fg-subtle text-label tabular-nums"
            >
              {formatProbability(g)}
            </text>
          </g>
        ))}
        <text x={MARGIN.left} y={height - 6} className="fill-fg-subtle text-label">
          {pointDate(t0)}
        </text>
        {n > 1 && (
          <text x={MARGIN.left + innerW} y={height - 6} textAnchor="end" className="fill-fg-subtle text-label">
            {pointDate(last.t)}
          </text>
        )}

        <g className={cn(thin && "opacity-55")}>
          {area && <path d={area} className="fill-forecast" fillOpacity={0.1} />}
          <path
            d={line}
            fill="none"
            className="stroke-forecast"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={x(last.t)} cy={y(last.p)} r={4} className="fill-forecast stroke-surface" strokeWidth={2} />
        </g>
        <text
          x={x(last.t) + 8}
          y={endLabelY}
          dominantBaseline="middle"
          className="fill-fg text-body font-semibold tabular-nums"
        >
          {formatProbability(last.p)}
        </text>

        {activePoint && (
          <g>
            <line
              x1={x(activePoint.t)}
              x2={x(activePoint.t)}
              y1={MARGIN.top}
              y2={MARGIN.top + innerH}
              className="stroke-fg-subtle"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <circle
              cx={x(activePoint.t)}
              cy={y(activePoint.p)}
              r={5}
              className="fill-forecast stroke-surface"
              strokeWidth={2}
            />
          </g>
        )}

        <rect
          x={MARGIN.left}
          y={0}
          width={innerW}
          height={MARGIN.top + innerH}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>

      {activePoint && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-10 flex flex-col rounded-md border border-line-strong bg-surface-2 px-2 py-1 whitespace-nowrap shadow-panel",
            tooltipOnLeft ? "-translate-x-full items-end" : "items-start",
          )}
          style={{ left: tooltipOnLeft ? activeX - 10 : activeX + 10, top: MARGIN.top }}
        >
          <span className="text-body font-semibold text-fg tabular-nums">{formatProbability(activePoint.p)}</span>
          <span className="text-label text-fg-muted">{pointDate(activePoint.t)}</span>
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {activePoint ? `${formatProbability(activePoint.p)} on ${pointDate(activePoint.t)}` : ""}
      </div>
    </div>
  );
}
