import { ArrowRight, List, Shapes } from "lucide-react";
import { useId, useMemo, useState } from "react";

import type { EntityType } from "@/api/contract";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_RELATION_ICON, ENTITY_TYPE_ICONS, RELATION_ICONS } from "@/lib/icons";
import { useMediaQuery } from "@/lib/hooks";
import { cn } from "@/lib/utils";

import { describeEdge, edgeGeometry, layoutSchema, shapeSchema, type SchemaBubble, type SchemaEdge } from "./schema-data";
import { useElementSize } from "./use-graph-theme";
import { useSchema } from "./use-graph-schema";

const count = (n: number) => n.toLocaleString("en-GB");

export interface SchemaViewProps {
  /** A kind was chosen: list things of that kind. */
  onOpenType: (type: EntityType) => void;
  /** A relation between two kinds was chosen: the graph, showing only it. */
  onOpenRelation: (edge: SchemaEdge) => void;
  /** Px at the top covered by the toolbar. */
  insetTop: number;
  /** Px at the right covered by a side panel. */
  insetRight?: number;
}

/**
 * The schema map (Phase A5): what kinds of thing the graph holds, how many
 * of each (bubble size), and which relations join them, labelled with how
 * many links. Tap a kind to list it, a relation to see it in the graph. On
 * phones, and on request, the same as a list.
 */
export function SchemaView({ onOpenType, onOpenRelation, insetTop, insetRight = 0 }: SchemaViewProps) {
  const schema = useSchema(true);
  const wide = useMediaQuery("(min-width: 640px)");
  const [asList, setAsList] = useState(false);
  const shape = useMemo(() => (schema.data ? shapeSchema(schema.data) : null), [schema.data]);

  if (schema.isPending && !schema.data) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" aria-busy="true" aria-label="Loading the schema">
        <Skeleton className="size-40 rounded-full" />
      </div>
    );
  }
  if (!shape) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-glass shadow-panel backdrop-blur-xl">
          <ErrorState error={schema.error ?? new Error("Not available")} onRetry={() => void schema.refetch()} />
        </div>
      </div>
    );
  }
  if (shape.bubbles.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <EmptyState icon={Shapes} title="Nothing in the graph yet" description="Kinds and their links appear as data arrives." />
      </div>
    );
  }

  const list = !wide || asList;
  return (
    <>
      {list ? (
        <div
          className="absolute inset-0 overflow-y-auto px-3 pb-16"
          style={{ paddingTop: insetTop + 12, paddingRight: insetRight || undefined }}
        >
          <SchemaList shape={shape} onOpenType={onOpenType} onOpenRelation={onOpenRelation} className="mx-auto max-w-3xl" />
        </div>
      ) : (
        <SchemaMap
          shape={shape}
          onOpenType={onOpenType}
          onOpenRelation={onOpenRelation}
          insetTop={insetTop}
          insetRight={insetRight}
        />
      )}
      {wide && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2" style={{ bottom: 52 }}>
          <Button variant="outline" className="border-line bg-glass backdrop-blur-xl" onClick={() => setAsList((v) => !v)}>
            {list ? <Shapes aria-hidden /> : <List aria-hidden />}
            {list ? "Show the map" : "Read as a list"}
          </Button>
          {!list && <p className="text-label text-fg-muted">Tap a kind to list it, a link to see it in the graph.</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

function SchemaMap({
  shape,
  onOpenType,
  onOpenRelation,
  insetTop,
  insetRight,
}: {
  shape: ReturnType<typeof shapeSchema>;
  onOpenType: (type: EntityType) => void;
  onOpenRelation: (edge: SchemaEdge) => void;
  insetTop: number;
  insetRight: number;
}) {
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [hotType, setHotType] = useState<EntityType | null>(null);
  const [hotEdge, setHotEdge] = useState<string | null>(null);
  const markerId = useId().replace(/:/g, "");
  const box = { width: size.width, height: Math.max(0, size.height) };
  const laid = useMemo(() => (box.width > 0 && box.height > 0 ? layoutSchema(shape, box) : null), [shape, box.width, box.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const byKey = useMemo(() => new Map((laid?.bubbles ?? []).map((b) => [b.key, b])), [laid]);
  const maxEdge = Math.max(1, ...shape.edges.map((e) => e.count));
  const center = { x: box.width / 2, y: box.height / 2 };

  const lit = (e: SchemaEdge) => hotEdge === e.id || (hotType !== null && (e.src === hotType || e.dst === hotType));
  const anyHot = hotEdge !== null || hotType !== null;

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={`Schema map: ${shape.bubbles.length} kinds of thing and ${shape.edges.length} kinds of link between them`}
      className="absolute inset-x-0 bottom-0"
      style={{ top: insetTop, right: insetRight }}
    >
      {laid && (
        <>
          <svg aria-hidden width={box.width} height={box.height} className="absolute inset-0 overflow-visible">
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" className="fill-fg-muted" />
              </marker>
            </defs>
            {laid.edges.map((e) => {
              const a = byKey.get(e.src);
              const b = byKey.get(e.dst);
              if (!a || !b) return null;
              const g = edgeGeometry(e, a, b, center);
              const on = lit(e);
              return (
                <path
                  key={e.id}
                  d={g.path}
                  fill="none"
                  className={e.causal ? "stroke-fg-muted" : "stroke-fg-subtle"}
                  strokeWidth={0.75 + 2.5 * (Math.log1p(e.count) / Math.log1p(maxEdge)) + (on ? 0.75 : 0)}
                  strokeOpacity={anyHot ? (on ? 0.95 : 0.15) : 0.55}
                  strokeLinecap="round"
                  markerEnd={e.symmetric ? undefined : `url(#${markerId})`}
                />
              );
            })}
          </svg>

          {laid.edges.map((e) => {
            const a = byKey.get(e.src);
            const b = byKey.get(e.dst);
            if (!a || !b) return null;
            const g = edgeGeometry(e, a, b, center);
            const Icon = (RELATION_ICONS[e.relation] ?? DEFAULT_RELATION_ICON).icon;
            const on = lit(e);
            const open = hotEdge === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onOpenRelation(e)}
                onMouseEnter={() => setHotEdge(e.id)}
                onMouseLeave={() => setHotEdge(null)}
                onFocus={() => setHotEdge(e.id)}
                onBlur={() => setHotEdge(null)}
                aria-label={`${describeEdge(e, byKey)}. Show in the graph`}
                title={e.description}
                style={{ left: g.label.x, top: g.label.y, zIndex: open ? 4 : 2 }}
                className={cn(
                  "absolute inline-flex h-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-full border bg-surface px-1.5 text-label whitespace-nowrap text-fg-muted shadow-panel transition-opacity",
                  "before:absolute before:-inset-2 before:content-['']",
                  on ? "border-line-strong text-fg" : "border-line",
                  anyHot && !on && "opacity-30",
                )}
              >
                <Icon aria-hidden className="size-3.5 shrink-0" />
                {open && <span>{e.label}</span>}
                <span className="tabular-nums">{count(e.count)}</span>
              </button>
            );
          })}

          {laid.bubbles.map((b) => (
            <BubbleButton
              key={b.key}
              bubble={b}
              dim={anyHot && hotType !== b.key && !(hotEdge && laid.edges.some((e) => e.id === hotEdge && (e.src === b.key || e.dst === b.key)))}
              onOpen={() => onOpenType(b.key)}
              onHot={(on) => setHotType(on ? b.key : null)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function BubbleButton({
  bubble,
  dim,
  onOpen,
  onHot,
}: {
  bubble: SchemaBubble;
  dim: boolean;
  onOpen: () => void;
  onHot: (on: boolean) => void;
}) {
  const Icon = (ENTITY_TYPE_ICONS[bubble.key] ?? ENTITY_TYPE_ICONS.story).icon;
  const color = `var(--${bubble.tone})`;
  const forecast = bubble.key === "forecast";
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onHot(true)}
      onMouseLeave={() => onHot(false)}
      onFocus={() => onHot(true)}
      onBlur={() => onHot(false)}
      aria-label={`${bubble.plural}: ${count(bubble.count)}. List them`}
      title={bubble.description}
      style={{ left: bubble.x, top: bubble.y - bubble.r, zIndex: 3 }}
      className={cn(
        "group absolute flex w-32 -translate-x-1/2 cursor-pointer flex-col items-center gap-1 rounded-xl transition-opacity",
        dim && "opacity-40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-surface shadow-panel transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100",
          forecast ? "border-[3px]" : "border-2",
        )}
        style={{
          width: bubble.r * 2,
          height: bubble.r * 2,
          borderColor: color,
          backgroundImage: `linear-gradient(color-mix(in oklch, ${color} 18%, transparent), color-mix(in oklch, ${color} 18%, transparent))`,
        }}
      >
        <Icon style={{ color, width: Math.max(14, bubble.r * 0.8), height: Math.max(14, bubble.r * 0.8) }} />
      </span>
      <span aria-hidden className="rounded-md bg-bg-sunken/80 px-1.5 text-center text-label leading-tight text-fg">
        {bubble.plural} <span className="text-fg-muted tabular-nums">{count(bubble.count)}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The list (phones, and the accessible alternative)
// ---------------------------------------------------------------------------

function SchemaList({
  shape,
  onOpenType,
  onOpenRelation,
  className,
}: {
  shape: ReturnType<typeof shapeSchema>;
  onOpenType: (type: EntityType) => void;
  onOpenRelation: (edge: SchemaEdge) => void;
  className?: string;
}) {
  const kindsId = useId();
  const linksId = useId();
  const byKey = useMemo(() => new Map(shape.bubbles.map((b) => [b.key, b])), [shape]);
  const row = "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2";
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <section aria-labelledby={kindsId} className="rounded-xl border border-line bg-surface/80 p-2">
        <h2 id={kindsId} className="px-2 py-1 text-label font-medium text-fg-muted">
          Kinds of thing
        </h2>
        <ul className="flex flex-col">
          {shape.bubbles.map((b) => {
            const Icon = (ENTITY_TYPE_ICONS[b.key] ?? ENTITY_TYPE_ICONS.story).icon;
            return (
              <li key={b.key}>
                <button type="button" onClick={() => onOpenType(b.key)} className={row} aria-label={`${b.plural}: ${count(b.count)}. List them`}>
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-surface"
                    style={{ borderColor: `var(--${b.tone})` }}
                  >
                    <Icon className="size-4" style={{ color: `var(--${b.tone})` }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{b.plural}</span>
                  <span className="shrink-0 text-label text-fg-muted tabular-nums">{count(b.count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby={linksId} className="rounded-xl border border-line bg-surface/80 p-2">
        <h2 id={linksId} className="px-2 py-1 text-label font-medium text-fg-muted">
          How they link
        </h2>
        <ul className="flex flex-col">
          {shape.edges.map((e) => {
            const Icon = (RELATION_ICONS[e.relation] ?? DEFAULT_RELATION_ICON).icon;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => onOpenRelation(e)} className={row} aria-label={`${describeEdge(e, byKey)}. Show in the graph`}>
                  <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-body text-fg">
                    <span>{byKey.get(e.src)?.plural ?? e.src}</span>
                    <ArrowRight aria-hidden className="size-3.5 text-fg-subtle" />
                    <span className="text-fg-muted">{e.label.toLowerCase()}</span>
                    <ArrowRight aria-hidden className="size-3.5 text-fg-subtle" />
                    <span>{byKey.get(e.dst)?.plural ?? e.dst}</span>
                  </span>
                  <span className="shrink-0 text-label text-fg-muted tabular-nums">{count(e.count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
