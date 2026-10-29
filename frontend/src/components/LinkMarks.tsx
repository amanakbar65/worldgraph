/**
 * Small marks for links, shared by the graph, the cascade and entity pages:
 * which way a cause moves its effect (▲ raises / ▼ lowers, always with the
 * word), a clock for delayed effects, and the one trust legend (line width
 * for strength, transparency for confidence, "?" for weak links).
 */
import { Clock } from "lucide-react";

import { DELAYED_WORDS, polarityInfo, TRUST_LEGEND, TRUST_OPACITY, TRUST_WIDTH } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { WeakMark } from "./WeakMark";

/** "▲ raises" or "▼ lowers"; nothing when the polarity is unknown. */
export function PolarityMark({
  polarity,
  className,
}: {
  polarity: number | null | undefined;
  className?: string;
}) {
  const info = polarityInfo(polarity);
  if (!info) return null;
  return (
    <span title={info.description} className={cn("inline-flex items-center gap-1 whitespace-nowrap text-fg", className)}>
      <span aria-hidden>{info.glyph}</span>
      {info.word}
    </span>
  );
}

/** A small clock for an effect that shows after a delay; nothing otherwise. */
export function DelayedMark({ delayed, withWord = false, className }: { delayed: boolean | null | undefined; withWord?: boolean; className?: string }) {
  if (!delayed) return null;
  return (
    <span
      role={withWord ? undefined : "img"}
      aria-label={withWord ? undefined : DELAYED_WORDS.description}
      title={DELAYED_WORDS.description}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap text-fg-muted", className)}
    >
      <Clock aria-hidden className="size-3.5" />
      {withWord && DELAYED_WORDS.label}
    </span>
  );
}

/** Two short lines: a thin and a thick one, or a faint and a solid one. Decorative. */
export function TrustSwatch({ kind }: { kind: "width" | "opacity" }) {
  const lines =
    kind === "width"
      ? [
          { y: 2, width: TRUST_WIDTH.min, opacity: 1 },
          { y: 7, width: TRUST_WIDTH.max, opacity: 1 },
        ]
      : [
          { y: 2, width: 2, opacity: TRUST_OPACITY.min },
          { y: 7, width: 2, opacity: TRUST_OPACITY.max },
        ];
  return (
    <svg aria-hidden viewBox="0 0 24 9" className="h-2.5 w-6 shrink-0 overflow-visible">
      {lines.map((l) => (
        <line
          key={l.y}
          x1="1"
          x2="23"
          y1={l.y}
          y2={l.y}
          className="stroke-fg-muted"
          strokeWidth={l.width}
          strokeOpacity={l.opacity}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/**
 * The trust part of every legend, in the same words everywhere
 * (TRUST_LEGEND): thicker is stronger, fainter is less certain, "?" is weak.
 * Renders list items; the caller supplies the list.
 */
export function TrustLegendItems({
  minConfidence,
  polarity = false,
  className,
}: {
  /** Said with the opacity row when links below it are hidden. */
  minConfidence?: number;
  /** Also explain ▲ raises / ▼ lowers. */
  polarity?: boolean;
  className?: string;
}) {
  const item = cn("flex items-center gap-1.5 text-label text-fg-muted", className);
  return (
    <>
      <li className={item}>
        <TrustSwatch kind="width" />
        {TRUST_LEGEND.width}
      </li>
      <li className={item}>
        <TrustSwatch kind="opacity" />
        <span>
          {TRUST_LEGEND.opacity}
          {minConfidence !== undefined && minConfidence > 0 && (
            <span className="text-fg-subtle"> · under {Math.round(minConfidence * 100)}% hidden</span>
          )}
        </span>
      </li>
      <li className={item}>
        <WeakMark />
        {TRUST_LEGEND.weak}
      </li>
      {polarity && (
        <li className={item}>
          <span aria-hidden className="w-6 shrink-0 text-center text-fg">
            ▲▼
          </span>
          Raises or lowers what it leads to
        </li>
      )}
    </>
  );
}
