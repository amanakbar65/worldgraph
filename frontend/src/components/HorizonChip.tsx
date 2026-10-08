import { CalendarDays, CalendarRange, Clock } from "lucide-react";

import type { Horizon } from "@/api/contract";
import { Chip } from "@/components/ui/chip";
import { HORIZON_LABELS } from "@/lib/meaning";

const ICONS = { now: Clock, weeks: CalendarDays, months: CalendarRange } as const;

export interface HorizonChipProps {
  /** When the effects land: now (days), weeks or months. */
  horizon: Horizon;
  size?: "sm" | "md";
  className?: string;
}

/** When a story's effects are expected: Now, Weeks or Months. */
export function HorizonChip({ horizon, size = "sm", className }: HorizonChipProps) {
  const Icon = ICONS[horizon] ?? Clock;
  const info = HORIZON_LABELS[horizon];
  return (
    <Chip size={size} className={className} title={info.description}>
      <Icon aria-hidden />
      <span className="sr-only">Horizon: </span>
      {info.label}
    </Chip>
  );
}
