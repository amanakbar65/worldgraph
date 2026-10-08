import { keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft, Info, List, RotateCw, Sparkles, Square, Workflow, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { StorySummary } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsDesktop } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { Panel } from "@/state/nav";

import {
  DEFAULT_CASCADE_DEPTH,
  projectionElements,
  projectionInput,
  projectionRegions,
  shapeCascade,
  type CascadeModel,
  type CascadeNode,
} from "./cascade-data";
import { layoutCascade } from "./cascade-layout";
import { CascadeFlow } from "./CascadeFlow";
import { CascadeList } from "./CascadeList";
import { EvidenceDrawer, type EvidenceTarget } from "./EvidenceDetails";
import { DraftLabel } from "./story-parts";
import { useProjection, type EngineInfo, type ProjectionStatus } from "./use-projection";
import { useStoryNav } from "./use-story-nav";

type View = "flow" | "list";
type Selection = { kind: "edge"; id: string } | { kind: "projection"; id: string } | null;

const DEPTHS = [
  { value: "1", label: "1", ariaLabel: "1 step each way" },
  { value: "2", label: "2", ariaLabel: "2 steps each way" },
  { value: "3", label: "3", ariaLabel: "3 steps each way" },
] as const;

/**
 * The cascade view: what led to a story and what it leads to, as a
 * left-to-right flow (or a list), with If YES / If NO branches from crowd
 * forecasts, the evidence behind every link, and on request a few clearly
 * labelled AI projections of what could come next.
 */
export default function CascadePanel({ panel }: { panel: Extract<Panel, { kind: "cascade" }> }) {
  // A new focus story starts fresh (depth, projections, open evidence).
  return <CascadeView key={panel.id} id={panel.id} />;
}

function CascadeView({ id }: { id: string }) {
  const isDesktop = useIsDesktop();
  const nav = useStoryNav();
  const [depth, setDepth] = useState(DEFAULT_CASCADE_DEPTH);
  const [viewChoice, setViewChoice] = useState<View | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const view: View = viewChoice ?? (isDesktop ? "flow" : "list");
  const direction = isDesktop ? "LR" : "TB";

  const query = useRpc("cascade", { id, depth }, { placeholderData: keepPreviousData });
  const projection = useProjection();
  const { status } = projection;

  const model = useMemo<CascadeModel | null>(() => {
    if (!query.data) return null;
    const projected =
      status.phase === "done" ? projectionElements(query.data.focus, status.effects, status.regions) : null;
    return shapeCascade(query.data, projected);
  }, [query.data, status]);

  const layout = useMemo(
    () => (model && view === "flow" ? layoutCascade(model, direction) : null),
    [model, view, direction],
  );

  const stories = useMemo(
    () => new Map<string, StorySummary>(model?.nodes.map((n) => [n.id, n.story]) ?? []),
    [model],
  );

  const openNode = useCallback(
    (node: CascadeNode) => {
      if (node.ai) setSelection({ kind: "projection", id: node.id });
      else nav.replaceWithStory(node.id);
    },
    [nav],
  );
  const openEvidence = useCallback((edgeId: string) => setSelection({ kind: "edge", id: edgeId }), []);

  const project = useCallback(() => {
    if (!model) return;
    const regions = projectionRegions(model);
    void projection.run(projectionInput(model, regions), regions);
  }, [model, projection]);

  const target = useMemo<EvidenceTarget | null>(() => {
    if (!model || !selection) return null;
    if (selection.kind === "edge") {
      const edge = model.edges.find((e) => e.id === selection.id);
      if (!edge) return null;
      if (edge.ai) {
        const node = model.nodes.find((n) => n.id === edge.link.dst);
        return node ? { kind: "projection", node, edge } : null;
      }
      return { kind: "edge", edge };
    }
    const node = model.nodes.find((n) => n.id === selection.id);
    const edge = model.edges.find((e) => e.ai && e.link.dst === selection.id) ?? null;
    return node ? { kind: "projection", node, edge } : null;
  }, [model, selection]);

  if (query.isPending) return <CascadeSkeleton />;
  if (query.isError && !query.data) {
    return (
      <div className="p-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (!model) return null;

  const focus = model.focusStory;
  const empty = model.nodes.length <= 1;
  const canProject = !!focus?.analysed;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
            <Workflow className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="line-clamp-2 text-body font-semibold text-fg lg:line-clamp-1">
              {focus?.headline ?? "Cascade"}
            </h2>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted">
              <span>Cascade</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {model.causes + model.effects} linked {model.causes + model.effects === 1 ? "story" : "stories"} within{" "}
                {depth} {depth === 1 ? "step" : "steps"}
              </span>
              {focus && !focus.analysed && <DraftLabel className="ml-1" />}
              {model.hasSample && <SampleBadge className="ml-1" />}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-label text-fg-muted" aria-hidden>
              Steps
            </span>
            <Segmented
              aria-label="Steps each way"
              value={String(depth) as "1" | "2" | "3"}
              onValueChange={(v) => setDepth(Number(v))}
              options={DEPTHS}
            />
          </div>
          <Segmented
            aria-label="Show the cascade as"
            value={view}
            onValueChange={(v) => {
              setViewChoice(v);
              setSelection(null);
            }}
            options={[
              { value: "flow", label: "Flow", icon: Workflow },
              { value: "list", label: "List", icon: List, ariaLabel: "View as list" },
            ]}
          />
          <ProjectControl
            engine={projection.engine}
            status={status}
            canProject={canProject}
            onProject={project}
            onStop={projection.stop}
            onClear={() => {
              projection.clear();
              setSelection(null);
            }}
          />
        </div>
      </header>

      <ProjectionNote status={status} onRetry={project} />

      <div className={cn("relative min-h-0 flex-1", query.isFetching && query.isPlaceholderData && "opacity-70")}>
        {empty && status.phase !== "done" ? (
          <div className="flex h-full items-center justify-center overflow-y-auto">
            <EmptyState
              icon={Workflow}
              title="No causes or effects yet"
              description={
                canProject
                  ? "Links appear as related news is analysed. You can ask the AI for possible next effects."
                  : "Links appear as related news is analysed."
              }
              action={
                canProject && projection.engine?.kind !== "none" && status.phase !== "running"
                  ? { label: "Project next effects", onClick: project, icon: Sparkles }
                  : undefined
              }
              secondaryAction={{ label: "Back to the story", onClick: () => nav.replaceWithStory(id), icon: ArrowLeft }}
            />
          </div>
        ) : view === "flow" && layout ? (
          <CascadeFlow
            model={model}
            layout={layout}
            selectedEdge={selection?.kind === "edge" ? selection.id : null}
            onOpenNode={openNode}
            onOpenEvidence={openEvidence}
            onOpenForecast={nav.openForecast}
          />
        ) : (
          <div className="h-full overflow-y-auto overscroll-contain">
            <CascadeList
              model={model}
              stories={stories}
              onOpenNode={openNode}
              onOpenStory={nav.replaceWithStory}
              onOpenForecast={nav.openForecast}
            />
          </div>
        )}
        {view === "flow" && target && (
          <EvidenceDrawer
            target={target}
            placement={isDesktop ? "side" : "bottom"}
            stories={stories}
            onClose={() => setSelection(null)}
            onOpenStory={nav.replaceWithStory}
            onOpenForecast={nav.openForecast}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project next effects (AI)
// ---------------------------------------------------------------------------

function Unavailable({ reason, label }: { reason: string; label: string }) {
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        aria-label={`${label}. ${reason}`}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-label text-fg-muted"
      >
        <Info aria-hidden className="size-3.5" />
        {label}
      </span>
    </Tooltip>
  );
}

function ProjectControl({
  engine,
  status,
  canProject,
  onProject,
  onStop,
  onClear,
}: {
  engine: EngineInfo | null;
  status: ProjectionStatus;
  canProject: boolean;
  onProject: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  if (engine?.kind === "none") {
    return <Unavailable label="AI projection unavailable" reason={engine.reason ?? "AI isn't available here."} />;
  }
  if (!canProject) {
    return <Unavailable label="AI projection" reason="Available once this story has been analysed." />;
  }
  if (status.phase === "running") {
    return (
      <div className="flex items-center gap-1">
        <Button variant="outline" disabled aria-label="Projecting next effects">
          <Sparkles aria-hidden className="animate-pulse" />
          Projecting…
        </Button>
        <Button variant="ghost" onClick={onStop}>
          <Square aria-hidden className="size-3" />
          Stop
        </Button>
      </div>
    );
  }
  const who = engine?.kind === "artifact" ? "your Claude account" : "WorldGraph AI";
  return (
    <div className="flex items-center gap-1">
      <Tooltip content={`Asks ${who} for up to 3 possible next effects. Nothing is saved.`}>
        <Button variant="outline" onClick={onProject}>
          <Sparkles aria-hidden />
          {status.phase === "done" ? "Project again" : "Project next effects"}
        </Button>
      </Tooltip>
      {status.phase === "done" && status.effects.length > 0 && (
        <Button variant="ghost" onClick={onClear} aria-label="Clear the AI projections">
          <X aria-hidden />
          Clear
        </Button>
      )}
    </div>
  );
}

/** One calm line about the AI request, announced to screen readers. */
function ProjectionNote({ status, onRetry }: { status: ProjectionStatus; onRetry: () => void }) {
  let content: ReactNode = null;
  if (status.phase === "running") {
    content = <span>Projecting possible next effects…</span>;
  } else if (status.phase === "done") {
    content =
      status.effects.length === 0 ? (
        <span>The AI found no plausible next effects to add.</span>
      ) : (
        <span>
          {status.effects.length} AI {status.effects.length === 1 ? "projection" : "projections"} added, drawn dotted.
          They are possibilities, not news, and aren't saved.
        </span>
      );
  } else if (status.phase === "error") {
    const retry = status.kind !== "unavailable" && status.kind !== "budget";
    content = (
      <>
        <span>
          {status.kind === "declined"
            ? "Claude isn't allowed for this page yet. Allow it when asked, then try again."
            : status.message}
        </span>
        {retry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="-my-1">
            <RotateCw aria-hidden />
            Try again
          </Button>
        )}
      </>
    );
  }
  return (
    <div aria-live="polite" className={cn(content && "border-b border-line bg-surface-2/40 px-4 py-2")}>
      {content && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-fg-muted">
          <Sparkles aria-hidden className="size-3.5 shrink-0" />
          {content}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function CascadeSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading the cascade">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/3 max-w-md" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="hidden h-8 w-64 rounded-lg md:block" />
      </div>
      <div className="flex flex-1 items-center justify-center gap-6 overflow-hidden p-6 md:gap-16">
        {[2, 1, 3].map((count, column) => (
          <div key={column} className="flex flex-col gap-4">
            {Array.from({ length: count }, (_, i) => (
              <Skeleton key={i} className={cn("h-[88px] w-40 rounded-xl md:w-60", column === 1 && "h-28 md:w-72")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
