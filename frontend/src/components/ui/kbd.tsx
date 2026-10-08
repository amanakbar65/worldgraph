import * as React from "react";

import { cn } from "@/lib/utils";

/** A keyboard key, e.g. <Kbd>⌘K</Kbd>. Shown on desktop only by callers. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-label text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A key combination, e.g. <KbdCombo keys={["Ctrl", "K"]} />. */
function KbdCombo({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}

export { Kbd, KbdCombo };
