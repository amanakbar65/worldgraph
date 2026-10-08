import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StateAction {
  /** A short verb phrase, e.g. "Show 30 days". */
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  /** A friendly icon for the situation (default: an inbox). */
  icon?: LucideIcon;
  /** What's going on, in a few calm words. */
  title: string;
  /** One short line that suggests what to try. */
  description?: ReactNode;
  /** The next tap. */
  action?: StateAction;
  /** A quieter second option. */
  secondaryAction?: StateAction;
  /** Tighter spacing for use inside cards and lists. */
  compact?: boolean;
  /** `alert` announces the message right away (used for errors). */
  role?: "status" | "alert";
  className?: string;
}

/**
 * A designed "nothing here" moment: an icon, a short title, one line of
 * help, and a button for the next tap. Never a blank panel.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  role,
  className,
}: EmptyStateProps) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-3 py-5" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-full bg-surface-2 text-fg-muted",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </span>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-body font-medium text-fg">{title}</p>
        {description && <p className="text-body text-fg-muted">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action && <StateButton action={action} primary />}
          {secondaryAction && <StateButton action={secondaryAction} />}
        </div>
      )}
    </div>
  );
}

/** The buttons used by EmptyState and ErrorState (40 px tall for thumbs). */
export function StateButton({ action, primary = false }: { action: StateAction; primary?: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-4 text-body font-medium transition-colors",
        primary
          ? "bg-fg text-bg hover:bg-fg/85"
          : "border border-line-strong text-fg hover:bg-surface-2",
      )}
    >
      {Icon && <Icon aria-hidden className="size-4" />}
      {action.label}
    </button>
  );
}
