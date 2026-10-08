import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Cards: quiet panels. `glass` floats over the globe; `surface` sits inside
 * a panel; `sunken` groups things inside a card.
 */
const cardVariants = cva("rounded-xl border text-fg", {
  variants: {
    variant: {
      surface: "border-line bg-surface",
      glass: "border-line bg-glass shadow-panel backdrop-blur-xl",
      sunken: "border-line bg-bg-sunken/60",
      plain: "border-transparent bg-transparent",
    },
    interactive: {
      true: "cursor-pointer text-left transition-colors hover:border-line-strong hover:bg-surface-2",
      false: "",
    },
  },
  defaultVariants: { variant: "surface", interactive: false },
});

/**
 * A card. With `asChild`, it renders its child (e.g. a `<button>`) with the
 * card's look, which is how to make a whole card tappable.
 */
function Card({
  className,
  variant,
  interactive,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return <Comp data-slot="card" className={cn(cardVariants({ variant, interactive }), className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex items-start gap-2 p-4 pb-2", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="card-title" className={cn("text-body font-semibold text-fg", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-body text-fg-muted", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 border-t border-line px-4 py-3", className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cardVariants };
