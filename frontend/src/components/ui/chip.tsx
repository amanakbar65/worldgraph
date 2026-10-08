import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Chips: small rounded labels. `Chip` is static; `ChipButton` is clickable
 * and, when `selected` is given, a toggle (aria-pressed).
 *
 * Tones other than `default` and `outline` are meaning colours; pair them
 * with an icon or ▲ ▼ (the chip doesn't add one for you).
 */
const chipVariants = cva(
  "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        default: "border-line bg-surface-2/70 text-fg-muted",
        outline: "border-line-strong bg-transparent text-fg-muted",
        risk: "border-risk/40 bg-risk/12 text-risk",
        opportunity: "border-opportunity/40 bg-opportunity/12 text-opportunity",
        neutral: "border-neutral/40 bg-neutral/12 text-neutral",
        forecast: "border-forecast/40 bg-forecast/12 text-forecast",
      },
      size: {
        sm: "h-6 px-2 text-label",
        md: "h-8 px-2.5 text-label",
        lg: "h-10 px-3.5 text-body [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { tone: "default", size: "sm" },
  },
);

type ChipVariants = VariantProps<typeof chipVariants>;

/** A static chip (a label, not a control). */
function Chip({ className, tone, size, ...props }: React.ComponentProps<"span"> & ChipVariants) {
  return <span data-slot="chip" className={cn(chipVariants({ tone, size }), className)} {...props} />;
}

interface ChipButtonProps extends Omit<React.ComponentProps<"button">, "onChange">, ChipVariants {
  /** When set, the chip is a toggle and announces its state (aria-pressed). */
  selected?: boolean;
}

/**
 * A clickable chip. Its hit area reaches 40 px tall even when the chip looks
 * smaller, so it is easy to tap.
 */
function ChipButton({ className, tone, size = "md", selected, type = "button", ...props }: ChipButtonProps) {
  return (
    <button
      data-slot="chip"
      type={type}
      aria-pressed={selected}
      className={cn(
        chipVariants({ tone, size }),
        "relative cursor-pointer transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-['']",
        "hover:border-line-strong hover:text-fg disabled:pointer-events-none disabled:opacity-50",
        "aria-pressed:border-fg/45 aria-pressed:bg-fg/12 aria-pressed:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export { Chip, ChipButton, chipVariants };
