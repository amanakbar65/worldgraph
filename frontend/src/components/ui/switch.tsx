import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * An on/off switch. Give it a name: wrap it with `SwitchField`, point a
 * `<label htmlFor>` at its id, or pass `aria-label`. The hit area reaches
 * 40 px around the 24 px track.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-bg-sunken transition-colors",
        "before:absolute before:-inset-2 before:content-['']",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[18px] translate-x-[2px] rounded-full bg-fg-muted shadow-sm transition-transform",
          "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-bg",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

interface SwitchFieldProps extends Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "id"> {
  /** The visible label; it also names the switch. */
  label: React.ReactNode;
  /** One short line under the label. */
  description?: React.ReactNode;
  className?: string;
}

/** A switch with its label and an optional description, as one 40 px+ row. */
function SwitchField({ label, description, className, ...props }: SwitchFieldProps) {
  const id = React.useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-body text-fg">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-label text-fg-muted">
            {description}
          </p>
        )}
      </div>
      <Switch id={id} aria-describedby={descriptionId} {...props} />
    </div>
  );
}

export { Switch, SwitchField };
