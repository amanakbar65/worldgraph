import { cn } from "@/lib/utils";

/**
 * The "?" mark on weak items: under 50 % sure, unknown, or with no source
 * (lib/meaning.ts isWeak). Decorative unless labelled. The same mark as on
 * the globe, shared by the graph, the cascade and the entity pages.
 */
export function WeakMark({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong text-label leading-none font-semibold text-fg-muted",
        className,
      )}
    >
      ?
    </span>
  );
}

