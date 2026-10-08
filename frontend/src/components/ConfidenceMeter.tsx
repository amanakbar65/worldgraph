import type { LinkType } from "@/api/contract";
import { LINK_TYPES } from "@/lib/meaning";
import { cn } from "@/lib/utils";

const BARS = 5;

export interface LinkTypeSwatchProps {
  /** Reported (solid), inferred (dashed), projected or conditional (dotted). */
  linkType: LinkType;
  className?: string;
}

/** A short line drawn the way the cascade draws this link type. Decorative. */
export function LinkTypeSwatch({ linkType, className }: LinkTypeSwatchProps) {
  const info = LINK_TYPES[linkType];
  return (
    <svg aria-hidden viewBox="0 0 24 4" className={cn("h-1 w-6 shrink-0 overflow-visible", className)}>
      <line
        x1="1"
        x2="23"
        y1="2"
        y2="2"
        className="stroke-fg-muted"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={info?.dasharray}
      />
    </svg>
  );
}

export interface LinkTypeLabelProps {
  linkType: LinkType;
  className?: string;
}

/** The link type as line swatch + word ("Inferred"), with its meaning as a tooltip. */
export function LinkTypeLabel({ linkType, className }: LinkTypeLabelProps) {
  const info = LINK_TYPES[linkType];
  return (
    <span
      title={info?.description}
      className={cn("inline-flex items-center gap-1.5 text-label whitespace-nowrap text-fg-muted", className)}
    >
      <LinkTypeSwatch linkType={linkType} />
      {info?.label ?? linkType}
    </span>
  );
}

export interface ConfidenceMeterProps {
  /** 0..1. Shown as five bars plus a percentage. */
  confidence: number;
  /** For causal links: adds the link type (Reported / Inferred / Projected / Conditional). */
  linkType?: LinkType;
  /** Hide the % label (the bars and accessible name stay). */
  hideValue?: boolean;
  className?: string;
}

/**
 * How sure we are: five small rising bars and a % label. For causal links
 * it also says how the link is known, drawn with the cascade's line style.
 */
export function ConfidenceMeter({ confidence, linkType, hideValue = false, className }: ConfidenceMeterProps) {
  const c = Math.min(1, Math.max(0, confidence));
  const pct = Math.round(c * 100);
  const filled = c > 0 ? Math.max(1, Math.round(c * BARS)) : 0;
  const linkInfo = linkType ? LINK_TYPES[linkType] : undefined;
  const name = `Confidence ${pct}%${linkInfo ? `, ${linkInfo.label.toLowerCase()} link` : ""}`;

  return (
    <span role="img" aria-label={name} className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="inline-flex h-3 items-end gap-[2px]">
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-[1px]", i < filled ? "bg-fg-muted" : "bg-line-strong")}
            style={{ height: `${40 + i * 15}%` }}
          />
        ))}
      </span>
      {!hideValue && (
        <span aria-hidden className="text-label text-fg-muted tabular-nums">
          {pct}%
        </span>
      )}
      {linkType && (
        <span aria-hidden className="inline-flex items-center gap-2">
          <span className="h-3 w-px bg-line-strong" />
          <LinkTypeLabel linkType={linkType} />
        </span>
      )}
    </span>
  );
}
