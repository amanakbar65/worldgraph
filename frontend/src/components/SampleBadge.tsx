import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SampleBadgeProps {
  /** `true` shows just "Sample" (for tight rows); the default says "Sample data". */
  compact?: boolean;
  className?: string;
}

/**
 * Marks illustrative sample data so it is never mistaken for a real event.
 * Neutral and dashed, so it reads as a label, not as a meaning colour.
 */
export function SampleBadge({ compact = false, className }: SampleBadgeProps) {
  return (
    <span
      title="Illustrative sample data, not a real event"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-1.5 text-label font-medium text-fg-muted",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3" />
      {compact ? "Sample" : "Sample data"}
    </span>
  );
}
