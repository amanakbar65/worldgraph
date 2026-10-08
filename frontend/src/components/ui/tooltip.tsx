import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Optional: one provider near the root shares the open delay between tooltips. */
function TooltipProvider({ delayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

const contentClass =
  "z-50 max-w-64 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-label text-fg shadow-panel data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0";

interface TooltipProps {
  /** What the tooltip says. Keep it to one short line. */
  content: React.ReactNode;
  /** The trigger: a single focusable element (button, link, or tabIndex=0). */
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A short hint on hover and keyboard focus. Tooltips add detail; they never
 * hold the only copy of something the viewer needs (that goes in the UI or
 * in an aria-label).
 */
function Tooltip({ content, children, side = "top", align = "center", className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} align={align} sideOffset={6} className={cn(contentClass, className)}>
            {content}
            <TooltipPrimitive.Arrow className="fill-surface-2" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip, TooltipProvider };
