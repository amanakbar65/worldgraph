import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Scroll direction(s). */
  orientation?: "vertical" | "horizontal" | "both";
  /**
   * Names the scrolling region. When set, the region can take keyboard
   * focus so it scrolls with the arrow keys even without focusable content.
   */
  label?: string;
  viewportClassName?: string;
}

/** A scroll container with thin, quiet scrollbars that match the theme. */
function ScrollArea({
  className,
  viewportClassName,
  orientation = "vertical",
  label,
  children,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit]",
          // Radix wraps content in a `display: table` box that defeats truncation; vertical lists don't need it.
          orientation === "vertical" && "[&>div]:!block",
          viewportClassName,
        )}
        {...(label ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
      {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-0.5 transition-colors select-none",
        orientation === "vertical" ? "h-full w-2.5" : "h-2.5 flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-line-strong hover:bg-fg-subtle" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
