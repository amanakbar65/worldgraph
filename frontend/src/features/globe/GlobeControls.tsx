import {
  History,
  Home,
  Layers,
  List,
  Map as MapIcon,
  Minus,
  Play,
  Plus,
  SlidersHorizontal,
  Square,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { SECTOR_IDS, type SectorId, type TimeWindow } from "@/api/contract";
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

import type { LayerToggles } from "./layers";
import { lensSummary, type ReplaySpan } from "./model";

/** Floating glass for controls over the globe. */
export const GLASS = "border border-line bg-glass shadow-panel backdrop-blur-xl";

// ---------------------------------------------------------------------------
// Time window and replay
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
      options={TIME_WINDOWS.map((w) => ({
        value: w,
        label: WINDOW_LABELS[w].short,
        ariaLabel: WINDOW_LABELS[w].long,
      }))}
      className={cn(GLASS, "rounded-lg", className)}
    />
  );
}

/** Plays the window's events in the order they appeared; pressed again, it stops. */
export function ReplayButton({
  running,
  window,
  onToggle,
  disabled = false,
  className,
}: {
  running: boolean;
  window: TimeWindow;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={running}
      aria-label={running ? "Stop the replay" : `Replay the ${WINDOW_LABELS[window].long.toLowerCase()}`}
      title={running ? "Stop the replay" : "Replay"}
      disabled={disabled}
      onClick={onToggle}
      className={cn(GLASS, "text-fg aria-pressed:bg-fg aria-pressed:text-bg", className)}
    >
      {running ? <Square aria-hidden className="size-3.5 fill-current" /> : <Play aria-hidden />}
    </Button>
  );
}

function replayLabel(at: number, window: TimeWindow, locale?: string): string {
  const options: Intl.DateTimeFormatOptions =
    window === "24h"
      ? { weekday: "short", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", day: "numeric", month: "short", hour: window === "7d" ? "numeric" : undefined };
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** While a replay runs: where its clock is, how far it has got, and Stop. */
export function ReplayBar({
  at,
  span,
  window,
  shown,
  onStop,
  className,
}: {
  at: number;
  span: ReplaySpan;
  window: TimeWindow;
  /** Events on the globe so far. */
  shown: number;
  onStop: () => void;
  className?: string;
}) {
  const progress = Math.round(
    Math.max(0, Math.min(1, (at - span.from) / Math.max(1, span.to - span.from))) * 100,
  );
  return (
    <div className={cn(GLASS, "flex h-10 items-center gap-3 rounded-full pl-3.5", className)}>
      <History aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <span className="text-body font-medium whitespace-nowrap text-fg tabular-nums">
        {replayLabel(at, window)}
      </span>
      <span
        role="progressbar"
        aria-label="Replay progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-line-strong sm:w-32"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-fg-muted"
          style={{ width: `${progress}%` }}
        />
      </span>
      <span className="text-label whitespace-nowrap text-fg-muted tabular-nums">
        {shown} {shown === 1 ? "event" : "events"}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 rounded-full"
        onClick={onStop}
        aria-label="Stop the replay"
      >
        <Square aria-hidden className="size-3.5 fill-current" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector lens
// ---------------------------------------------------------------------------

export interface SectorLensProps {
  selected: readonly SectorId[];
  onToggle: (sector: SectorId) => void;
  onClear: () => void;
  /** `row`: one line (desktop); `wrap`: a grid of chips (in the popover). */
  layout: "row" | "wrap";
}

export function SectorLens({ selected, onToggle, onClear, layout }: SectorLensProps) {
  const chip = layout === "row" ? GLASS : undefined;
  return (
    <div
      role="group"
      aria-label="Sector lens"
      className={cn("flex items-center gap-1.5", layout === "row" ? "py-1" : "flex-wrap")}
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

/** The lens behind one button that says what is on (phones, and narrow desktops). */
export function SectorLensButton({
  labelled = false,
  ...props
}: Omit<SectorLensProps, "layout"> & { labelled?: boolean }) {
  const count = props.selected.length;
  const only = count === 1 ? SECTORS[props.selected[0]] : null;
  const summary = lensSummary(props.selected);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={labelled ? "default" : "icon"}
          className={cn(
            GLASS,
            "relative text-fg",
            labelled && "px-3",
            !labelled && count > 0 && "w-auto gap-1.5 px-3",
            count > 0 && "border-fg/40",
          )}
          aria-label={labelled ? undefined : `Sector lens: ${summary}`}
        >
          {only ? <only.icon aria-hidden /> : <SlidersHorizontal aria-hidden />}
          {labelled ? (
            <>
              <span className="sr-only">Sector lens: </span>
              {summary}
            </>
          ) : (
            count > 0 && <span className="text-label tabular-nums">{count}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-2 text-label font-medium text-fg-muted">Sector lens</p>
        <SectorLens {...props} layout="wrap" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Desktop: the chips in one line when they fit the space, otherwise the
 * lens folds into a button with a popover (no hidden horizontal scrolling).
 */
export function SectorLensBar(props: Omit<SectorLensProps, "layout">) {
  const slot = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [needed, setNeeded] = useState(0);
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);
  const inline = needed === 0 || room >= needed;

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const measure = () => {
      setRoom(el.clientWidth);
      // The row shrinks to its content, so its scroll width is what it needs.
      if (row.current) setNeeded(row.current.scrollWidth);
    };
    measure();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready.then(measure);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [inline]);

  return (
    <div ref={slot} className="flex min-w-0 flex-1 items-center">
      {inline ? (
        <div ref={row} className="w-max max-w-full overflow-hidden">
          <SectorLens {...props} layout="row" />
        </div>
      ) : (
        <SectorLensButton {...props} labelled />
      )}
    </div>
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
  const off = LAYER_ROWS.filter((row) => !toggles[row.key]).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={cn(GLASS, "text-fg", !compact && "px-3")}
          aria-label={compact ? `Map layers and key${off ? `, ${off} hidden` : ""}` : undefined}
        >
          <MapIcon aria-hidden />
          {!compact && "Layers"}
          {!compact && off > 0 && <span className="text-label text-fg-muted tabular-nums">{off} off</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side={compact ? "bottom" : "top"} className="w-80 p-4">
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
  return <li className="flex items-center gap-1.5 [&>*:not(:last-child)]:shrink-0">{children}</li>;
}

/**
 * What the colours and shapes mean. Every colour sits next to its icon (and
 * ▲ ▼ where direction matters), so nothing depends on colour alone.
 */
export function MapKey({ detailed = false, className }: { detailed?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 text-label text-fg-muted", className)}>
      {detailed && <p className="font-medium">Key</p>}
      <ul
        aria-label="Map key"
        className={cn("flex gap-x-3 gap-y-1.5", detailed ? "flex-col" : "flex-wrap items-center")}
      >
        {(["risk", "opportunity", "neutral"] as const).map((impact) => {
          const Icon = IMPACT_ICONS[impact].icon;
          const tone = IMPACT_TONES[impact];
          return (
            <KeyItem key={impact}>
              <span aria-hidden className={cn("size-2.5 rounded-full", tone.bg)} />
              <Icon aria-hidden className={cn("size-3.5", tone.text)} />
              <span className="whitespace-nowrap">
                {tone.label}
                {detailed && impact !== "neutral" && (
                  <span className="text-fg-subtle"> · countries lean this way</span>
                )}
              </span>
            </KeyItem>
          );
        })}
        <KeyItem>
          <span aria-hidden className="size-3 rounded-full border-2 border-forecast" />
          <Users aria-hidden className="size-3.5 text-forecast" />
          <span className="whitespace-nowrap">
            Crowd forecast
            {detailed && <span className="text-fg-subtle"> · glow: moved 5+ points</span>}
          </span>
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

export function ListToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={open}
      aria-label="List of events"
      onClick={() => onChange(!open)}
      className={cn(GLASS, "text-fg aria-pressed:bg-fg aria-pressed:text-bg")}
    >
      <List aria-hidden />
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
    <div
      role="group"
      aria-label="Zoom"
      className={cn(GLASS, "flex flex-col overflow-hidden rounded-lg", className)}
    >
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
