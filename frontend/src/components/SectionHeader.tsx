import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  /** A few words, sentence case. */
  title: string;
  icon?: LucideIcon;
  /** A count shown after the title, e.g. the number of stories. */
  count?: number;
  /** One short line under the title. */
  description?: ReactNode;
  /** A control on the right, e.g. a "See all" button or a segmented control. */
  action?: ReactNode;
  /** Heading level for the document outline (default h2). */
  as?: "h2" | "h3" | "h4";
  /** Id for the heading, so a section can use aria-labelledby. */
  id?: string;
  className?: string;
}

/** The title row of a section in a panel or view. */
export function SectionHeader({
  title,
  icon: Icon,
  count,
  description,
  action,
  as: Heading = "h2",
  id,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex min-h-10 items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        <Heading id={id} className="flex items-center gap-2 text-body font-semibold text-fg">
          {Icon && <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />}
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="rounded-full bg-surface-2 px-1.5 text-label font-medium text-fg-muted tabular-nums">
              {count}
            </span>
          )}
        </Heading>
        {description && <p className="mt-0.5 text-label text-fg-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
