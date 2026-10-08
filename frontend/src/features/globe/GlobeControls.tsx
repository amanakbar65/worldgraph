import { Home, Layers, List, Map as MapIcon, Minus, Plus, SlidersHorizontal, Users } from "lucide-react";
import type { ReactNode } from "react";

import type { SectorId, TimeWindow } from "@/api/contract";
import { LinkTypeSwatch } from "@/components/ConfidenceMeter";
import { SectorChip } from "@/components/SectorChip";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { SwitchField } from "@/components/ui/switch";
import { IMPACT_ICONS, SECTORS } from "@/lib/icons";
import { IMPACT_TONES } from "@/lib/meaning";
import { TIME_WINDOWS, WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SECTOR_IDS } from "@/api/contract";

import type { LayerToggles } from "./layers";

/** Floating glass for controls over the globe. */
export const GLASS = "border border-line bg-glass shadow-panel backdrop-blur-xl";

// ---------------------------------------------------------------------------
// Time window
// ---------------------------------------------------------------------------

export function WindowControl({
  value,
  onChange,
  className,
}: {
  value: TimeWindow;
  onChange: (w: TimeWindow) => void;
  className?: string;
}) {
  return (
    <Segmented
      aria-label="Time window"
      value={value}
      onValueChange={onChange}
      options={TIME_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w].short, ariaLabel: WINDOW_LABELS[w].long }))}
      className={cn(GLASS, "rounded-lg", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Sector lens
// ---------------------------------------------------------------------------

export interface SectorLensProps {
  selected: readonly SectorId[];
  onToggle: (sector: SectorId) => void;
  onClear: () => void;
  /** `row`: one scrolling line (desktop); `wrap`: a grid of chips (phone popover). */
  layout: "row" | "wrap";
}

export function SectorLens({ selected, onToggle, onClear, layout }: SectorLensProps) {
  const chip = layout === "row" ? cn(GLASS, "bg-glass") : undefined;
  return (
    <div
      role="group"
      aria-label="Sector lens"
      className={cn(
        "flex items-center gap-1.5",
        layout === "row"
          ? "min-w-0 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex-wrap",
      )}
    >
      <ChipButton selected={selected.length === 0} onClick={onClear} className={cn("shrink-0", chip)}>
        <Layers aria-hidden />
        All sectors
      </ChipButton>
      {SECTOR_IDS.map((sector) => (
        <SectorChip
          key={sector}
          sector={sector}
          selected={selected.includes(sector)}
          onClick={onToggle}
          className={cn("shrink-0", chip)}
        />
      ))}
    </div>
  );
}

/** Phones: the lens behind one button that says how many sectors are on. */
export function SectorLensButton(props: Omit<SectorLensProps, "layout">) {
  const count = props.selected.length;
  const only = count === 1 ? SECTORS[props.selected[0]] : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(GLASS, "relative text-fg", count > 0 && "w-auto gap-1.5 px-3")}
          aria-label={count === 0 ? "Sector lens: all sectors" : `Sector lens: ${count} on`}
        >
          {only ? <only.icon aria-hidden /> : <SlidersHorizontal aria-hidden />}
          {count > 0 && <span className="text-label tabular-nums">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-2 text-label font-medium text-fg-muted">Sector lens</p>
        <SectorLens {...props} layout="wrap" />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Layers and the map key
// ---------------------------------------------------------------------------

const LAYER_ROWS: { key: keyof LayerToggles; label: string; description: string }[] = [
  { key: "events", label: "Events", description: "Dots sized by importance" },
  { key: "heat", label: "Heat", description: "Where events cluster" },
  { key: "arcs", label: "Cascade links", description: "Causes and effects across borders" },
  { key: "forecasts", label: "Crowd forecasts", description: "Rings filled to the chance of yes" },
];

export function LayersButton({
  toggles,
  onToggle,
  compact = false,
}: {
  toggles: LayerToggles;
  onToggle: (key: keyof LayerToggles, on: boolean) => void;
  compact?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={cn(GLASS, "text-fg", !compact && "px-3")}
          aria-label={compact ? "Map layers and key" : undefined}
        >
          <MapIcon aria-hidden />
          {!compact && "Layers"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-fg-muted">Show on the globe</p>
          {LAYER_ROWS.map((row) => (
            <SwitchField
              key={row.key}
              label={row.label}
              description={row.description}
              checked={toggles[row.key]}
              onCheckedChange={(on) => onToggle(row.key, on)}
            />
          ))}
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <MapKey detailed />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function KeyItem({ children }: { children: ReactNode }) {
  return <li className="flex items-center gap-1.5 whitespace-nowrap">{children}</li>;
}

/**
 * What the colours and shapes mean. Every colour sits next to its icon (and
 * ▲ ▼ where direction matters), so nothing depends on colour alone.
 */
export function MapKey({ detailed = false, className }: { detailed?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 text-label text-fg-muted", className)}>
      {detailed && <p className="font-medium">Key</p>}
      <ul aria-label="Map key" className={cn("flex gap-x-3 gap-y-1.5", detailed ? "flex-col" : "flex-wrap items-center")}>
        {(["risk", "opportunity", "neutral"] as const).map((impact) => {
          const Icon = IMPACT_ICONS[impact].icon;
          const tone = IMPACT_TONES[impact];
          return (
            <KeyItem key={impact}>
              <span aria-hidden className={cn("size-2.5 rounded-full", tone.bg)} />
              <Icon aria-hidden className={cn("size-3.5", tone.text)} />
              {tone.label}
              {detailed && impact !== "neutral" && (
                <span className="text-fg-subtle">· country shade leans this way</span>
              )}
            </KeyItem>
          );
        })}
        <KeyItem>
          <span aria-hidden className="size-3 rounded-full border-2 border-forecast" />
          <Users aria-hidden className="size-3.5 text-forecast" />
          Crowd forecast
          {detailed && <span className="text-fg-subtle">· glow: moved 5+ points in 24 h</span>}
        </KeyItem>
        {detailed && (
          <>
            <KeyItem>
              <LinkTypeSwatch linkType="reported" />
              Reported link
            </KeyItem>
            <KeyItem>
              <LinkTypeSwatch linkType="inferred" />
              Inferred link
            </KeyItem>
            <KeyItem>
              <span aria-hidden className="size-3 rounded-full border border-fg-muted" />
              Ring: new in the last hour
            </KeyItem>
            <KeyItem>
              <span aria-hidden>▲ ▼</span>
              Which way a story pushes things
            </KeyItem>
          </>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List toggle and zoom
// ---------------------------------------------------------------------------

export function ListToggle({
  open,
  onChange,
  compact = false,
}: {
  open: boolean;
  onChange: (open: boolean) => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "default"}
      aria-pressed={open}
      aria-label={compact ? "List of events" : undefined}
      onClick={() => onChange(!open)}
      className={cn(GLASS, "text-fg aria-pressed:bg-fg aria-pressed:text-bg", !compact && "px-3")}
    >
      <List aria-hidden />
      {!compact && "List"}
    </Button>
  );
}

export function ZoomControls({
  onZoom,
  onReset,
  className,
}: {
  onZoom: (delta: number) => void;
  onReset: () => void;
  className?: string;
}) {
  const btn = "size-10 rounded-none first:rounded-t-lg last:rounded-b-lg text-fg";
  return (
    <div role="group" aria-label="Zoom" className={cn(GLASS, "flex flex-col overflow-hidden rounded-lg", className)}>
      <Button variant="ghost" size="icon" className={btn} onClick={() => onZoom(1)} aria-label="Zoom in">
        <Plus aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" className={btn} onClick={() => onZoom(-1)} aria-label="Zoom out">
        <Minus aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" className={btn} onClick={onReset} aria-label="Show the whole globe">
        <Home aria-hidden />
      </Button>
    </div>
  );
}
