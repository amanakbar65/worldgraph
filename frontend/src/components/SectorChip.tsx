import type { SectorId } from "@/api/contract";
import { Chip, ChipButton } from "@/components/ui/chip";
import { DEFAULT_EVENT_ICON, SECTORS } from "@/lib/icons";
import { cn } from "@/lib/utils";

export interface SectorChipProps {
  /** One of the nine sectors. */
  sector: SectorId;
  /** Makes the chip a button (e.g. open the sector, or toggle a lens). */
  onClick?: (sector: SectorId) => void;
  /** With `onClick`, makes it a toggle: the sector lens chips on the globe. */
  selected?: boolean;
  /** Show only the icon; the name stays available to screen readers and as a tooltip. */
  iconOnly?: boolean;
  /** `sm` (24 px) for cards, `md` (32 px, default) for filters. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * A sector as icon + name. Sectors are a lens, not a meaning, so the chip is
 * neutral; a selected lens fills in and announces itself as pressed.
 */
export function SectorChip({ sector, onClick, selected, iconOnly = false, size = "md", className }: SectorChipProps) {
  const info = SECTORS[sector] ?? { ...DEFAULT_EVENT_ICON, label: sector };
  const Icon = info.icon;
  const label = info.label;
  const content = (
    <>
      <Icon aria-hidden />
      <span className={cn("truncate", iconOnly && "sr-only")}>{label}</span>
    </>
  );
  if (!onClick) {
    return (
      <Chip size={size} title={iconOnly ? label : undefined} className={cn(iconOnly && "px-1.5", className)}>
        {content}
      </Chip>
    );
  }
  return (
    <ChipButton
      size={size}
      selected={selected}
      onClick={() => onClick(sector)}
      title={iconOnly ? label : undefined}
      className={cn(iconOnly && "px-2", className)}
    >
      {content}
    </ChipButton>
  );
}
