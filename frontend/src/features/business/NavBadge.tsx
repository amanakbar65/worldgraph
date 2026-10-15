import { cn } from "@/lib/utils";

import { useBusinessAlertCount } from "./use-business";

/**
 * The number of alerts since the last visit, for the "My Business" item in
 * the header and the phone tab bar. Renders nothing when there are none.
 * It reads the same cached calls as the screen.
 */
export function BusinessAlertBadge({ className }: { className?: string }) {
  const count = useBusinessAlertCount();
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-fg px-1 text-label leading-none font-semibold text-bg tabular-nums",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
      <span className="sr-only"> new since your last visit</span>
    </span>
  );
}
