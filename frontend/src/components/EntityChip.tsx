import type { EntityRef } from "@/api/contract";
import { Chip, ChipButton } from "@/components/ui/chip";
import { ENTITY_TYPE_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";

/** The parts of an entity a chip needs (an EntityRef, a GraphNode, a backlink…). */
export type EntityChipEntity = Pick<EntityRef, "type" | "name"> & { id?: string };

export interface EntityChipProps {
  /** The entity to show: its type picks the icon and colour. */
  entity: EntityChipEntity;
  /** Makes the chip a button, e.g. to open the entity page. */
  onClick?: (entity: EntityChipEntity) => void;
  /** Shows the chip as chosen (a toggle); only with `onClick`. */
  selected?: boolean;
  /** `sm` (24 px, for dense rows) or `md` (32 px, default). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * An entity as type icon + name. The icon, border and wash take the type's
 * fixed colour (the same on the globe, in the graph and on chips); the name
 * stays in the text colour so it is always readable.
 */
export function EntityChip({ entity, onClick, selected, size = "md", className }: EntityChipProps) {
  const tone = entityTypeTone(entity.type);
  const Icon = (ENTITY_TYPE_ICONS[entity.type] ?? ENTITY_TYPE_ICONS.story).icon;
  const content = (
    <>
      <Icon aria-hidden className={tone.text} />
      <span className="truncate text-fg">{entity.name}</span>
    </>
  );
  const look = cn(tone.border, "bg-surface-2/70", className);

  if (!onClick) {
    return (
      <Chip size={size} className={look} title={`${tone.label}: ${entity.name}`}>
        {content}
        <span className="sr-only">({tone.label})</span>
      </Chip>
    );
  }
  return (
    <ChipButton
      size={size}
      selected={selected}
      onClick={() => onClick(entity)}
      aria-label={`${entity.name}, ${tone.label.toLowerCase()}`}
      className={cn(look, "hover:bg-surface-2")}
    >
      {content}
    </ChipButton>
  );
}
