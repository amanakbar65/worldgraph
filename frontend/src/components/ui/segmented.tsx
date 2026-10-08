import type { LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible text. */
  label: React.ReactNode;
  icon?: LucideIcon;
  /** Accessible name when the label is an icon or abbreviation (e.g. "Last 7 days"). */
  ariaLabel?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Names the whole control for screen readers, e.g. "Time window". */
  "aria-label": string;
  /** `md` (default) is 40 px tall for thumbs; `sm` is for dense toolbars. */
  size?: "sm" | "md";
  /** Stretch the segments to fill the width. */
  fill?: boolean;
  className?: string;
}

/**
 * A segmented control (one choice out of a few), e.g. 24 h / 7 d / 30 d.
 * Arrow keys move between segments; one is always selected.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  fill = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix sends "" when the active segment is pressed again; keep the choice.
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-stretch gap-0.5 rounded-lg border border-line bg-bg-sunken/70 p-0.5",
        size === "md" ? "h-10" : "h-8",
        fill && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            aria-label={option.ariaLabel}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-fg-muted tabular-nums transition-colors",
              "hover:text-fg data-[state=on]:bg-surface-2 data-[state=on]:text-fg data-[state=on]:shadow-[inset_0_0_0_1px_var(--line-strong)]",
              size === "md" ? "px-3 text-body" : "px-2.5 text-label",
              fill && "flex-1",
            )}
          >
            {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
            {option.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
