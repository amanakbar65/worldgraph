import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SampleBadgeProps {
  /** `true` shows just "Sample" (for tight rows); the default says "Sample data". */
  compact?: boolean;
  /** Only the flask icon (for tiles); the words stay available to screen readers and as a tooltip. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Marks illustrative sample data so it is never mistaken for a real event.
 * Neutral and dashed, so it reads as a label, not as a meaning colour.
 */
export function SampleBadge({ compact = false, iconOnly = false, className }: SampleBadgeProps) {
  return (
    <span
      title="Illustrative sample data, not a real event"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong text-label font-medium text-fg-muted",
        iconOnly ? "w-5 justify-center" : "px-1.5",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3" />
      <span className={cn(iconOnly && "sr-only")}>{compact ? "Sample" : "Sample data"}</span>
    </span>
  );
}
