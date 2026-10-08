import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A loading placeholder in the shape of what is coming (never a spinner).
 * The shimmer stops under reduced motion. Mark the loading region itself
 * with aria-busy; skeletons are hidden from screen readers.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
      {...props}
    />
  );
}

/** A few lines of text, the last one shorter. */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText };
