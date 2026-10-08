import type { Direction, Impact } from "@/api/contract";
import { IMPACT_ICONS } from "@/lib/icons";
import { DIRECTION_ARROWS, DIRECTION_WORDS, impactTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

export interface ImpactBadgeProps {
  /** Risk (amber), opportunity (teal) or neutral (slate). */
  impact: Impact;
  /** Which way the story pushes things: ▲ up or ▼ down. Null or omitted hides the arrow. */
  direction?: Direction | null;
  /** Replaces the word, e.g. "Risk to you". */
  label?: string;
  /** Hide the word (icon and arrow stay); the word is still read by screen readers. */
  iconOnly?: boolean;
  /** `sm` (default) for rows and cards; `md` for panel headers. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Impact as icon + word + ▲/▼, in the impact colour. Never colour alone:
 * the icon and the word carry the meaning by themselves.
 */
export function ImpactBadge({ impact, direction, label, iconOnly = false, size = "sm", className }: ImpactBadgeProps) {
  const tone = impactTone(impact);
  const Icon = (IMPACT_ICONS[impact] ?? IMPACT_ICONS.neutral).icon;
  const word = label ?? tone.label;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-label" : "h-8 px-2.5 text-body",
        iconOnly && (size === "sm" ? "w-auto px-1.5" : "px-2"),
        tone.text,
        tone.tint,
        tone.border,
        className,
      )}
    >
      <Icon aria-hidden className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-4")} />
      <span className={cn(iconOnly && "sr-only")}>{word}</span>
      {direction && (
        <>
          <span aria-hidden className="leading-none">
            {DIRECTION_ARROWS[direction]}
          </span>
          <span className="sr-only">, {DIRECTION_WORDS[direction]}</span>
        </>
      )}
    </span>
  );
}
