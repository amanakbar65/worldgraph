import {
  ArrowRight,
  CircleCheck,
  GitFork,
  ListChecks,
  Newspaper,
  Shapes,
  Telescope,
  Users,
  Workflow,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { StoryResponse } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { EmptyState } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { HorizonChip } from "@/components/HorizonChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { SectorChip } from "@/components/SectorChip";
import { SourcesList } from "@/components/SourcesList";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, eventTypeKey, eventTypeLabel } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Panel } from "@/state/nav";

import { DEFAULT_CASCADE_DEPTH, directLinks } from "./cascade-data";
import { DraftLabel, LinkedStoryRow } from "./story-parts";
import { useStoryNav } from "./use-story-nav";

type Story = StoryResponse["story"];
type Nav = ReturnType<typeof useStoryNav>;

const MAGNITUDE_WORDS = ["", "Minor", "Small", "Moderate", "Large", "Major"] as const;

/**
 * The story card: what happened, why it matters, what you could do, what
 * the crowd expects next, the causes and effects, who is involved, and the
 * sources. Drafts from the live feed show their source headline and sources
 * until the AI has analysed them.
 */
export default function StoryPanel({ panel }: { panel: Extract<Panel, { kind: "story" }> }) {
  const query = useRpc("story", { id: panel.id });
  const nav = useStoryNav();

  if (query.isPending) return <StorySkeleton />;
  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const data = query.data;
  return data.story.analysed ? <AnalysedStory data={data} nav={nav} /> : <DraftStory data={data} nav={nav} />;
}

// ---------------------------------------------------------------------------
// Analysed story
// ---------------------------------------------------------------------------

function AnalysedStory({ data, nav }: { data: StoryResponse; nav: Nav }) {
  const { story } = data;
  const headingId = useId();
  const projected = story.kind === "projected";
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 p-4 pb-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge impact={story.impact} direction={story.direction} size="md" />
          {projected ? (
            <Chip tone="outline" size="md">
              <Telescope aria-hidden />
              Projected
            </Chip>
          ) : (
            <span className="inline-flex items-center gap-1 text-label text-fg-muted">
              <EventIcon aria-hidden className="size-3.5" />
              {eventTypeLabel(story.event_type)}
            </span>
          )}
          {story.is_sample && <SampleBadge className="ml-auto" />}
        </div>
        <h2 id={headingId} className="text-figure font-semibold tracking-tight text-fg">
          {story.headline}
        </h2>
        {story.so_what && <p className="text-body text-fg-muted">{story.so_what}</p>}
        <StoryChips story={story} nav={nav} />
      </header>

      <Glance story={story} />

      <CascadeButton data={data} nav={nav} />

      {story.actions.length > 0 && (
        <section aria-labelledby={`${headingId}-actions`} className="flex flex-col gap-2">
          <SectionHeader as="h3" id={`${headingId}-actions`} title="What you could do" icon={ListChecks} />
          <ul className="flex flex-col gap-2">
            {story.actions.slice(0, 3).map((action) => (
              <li
                key={action}
                className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 text-body text-fg"
              >
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                {action}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CrowdSection data={data} nav={nav} />
      <CausesEffects story={story} nav={nav} />
      <WhoAndWhere story={story} nav={nav} />
      <SourcesSection story={story} />
    </article>
  );
}

function StoryChips({ story, nav }: { story: Story; nav: Nav }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {story.sectors.map((sector) => (
        <SectorChip key={sector} sector={sector} size="sm" />
      ))}
      {story.region && (
        <EntityChip
          size="sm"
          entity={{ id: story.region.id, type: "region", name: story.region.name }}
          onClick={() => nav.openRegion(story.region!.id)}
        />
      )}
      {story.horizon && <HorizonChip horizon={story.horizon} />}
      {story.confidence !== null && <ConfidenceMeter confidence={story.confidence} className="ml-1" />}
    </div>
  );
}

/** Size, sources and timing, at a glance. */
function Glance({ story }: { story: Story }) {
  const tiles: { label: string; value: ReactNode }[] = [];
  if (story.magnitude !== null) {
    tiles.push({
      label: "Size",
      value: (
        <span className="flex items-center gap-2">
          <span role="img" aria-label={`${story.magnitude} out of 5`} className="flex items-center gap-[3px]">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                aria-hidden
                className={cn("h-2.5 w-1.5 rounded-[2px]", i <= story.magnitude! ? "bg-fg-muted" : "bg-line-strong")}
              />
            ))}
          </span>
          {MAGNITUDE_WORDS[story.magnitude] ?? ""}
        </span>
      ),
    });
  }
  tiles.push({
    label: "Sources",
    value: (
      <span className="tabular-nums">
        {formatCompact(story.source_count)} {story.source_count === 1 ? "source" : "sources"}
        {story.mention_count > story.source_count && (
          <span className="text-fg-muted"> · {formatCompact(story.mention_count)} mentions</span>
        )}
      </span>
    ),
  });
  if (story.first_seen) tiles.push({ label: "First seen", value: <TimeAgo value={story.first_seen} /> });
  if (story.last_seen) tiles.push({ label: "Last seen", value: <TimeAgo value={story.last_seen} /> });

  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={cn(
            "flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2",
            // An odd count: the first tile takes the full row, so the grid stays even.
            i === 0 && tiles.length % 2 === 1 && "col-span-2",
          )}
        >
          <dt className="text-label text-fg-muted">{tile.label}</dt>
          <dd className="truncate text-body font-medium text-fg">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CascadeButton({ data, nav, quiet = false }: { data: StoryResponse; nav: Nav; quiet?: boolean }) {
  const counts =
    data.causes + data.effects === 0
      ? "No links yet"
      : `${data.causes} ${data.causes === 1 ? "cause" : "causes"} · ${data.effects} ${data.effects === 1 ? "effect" : "effects"}`;
  return (
    <Button
      size="lg"
      variant={quiet ? "outline" : "default"}
      onClick={() => nav.openCascade(data.story.id)}
      className="w-full justify-between px-4"
      aria-label={`See the cascade: ${counts}`}
    >
      <span className="flex items-center gap-2">
        <Workflow aria-hidden />
        See the cascade
      </span>
      <span className="flex items-center gap-2 text-label font-normal tabular-nums opacity-80">
        {counts}
        <ArrowRight aria-hidden />
      </span>
    </Button>
  );
}

function CrowdSection({ data, nav }: { data: StoryResponse; nav: Nav }) {
  const id = useId();
  if (data.forecasts.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionHeader
        as="h3"
        id={id}
        title="What the crowd expects next"
        icon={Users}
        description="Crowd forecasts, not facts. For information only."
      />
      <div className="-mx-3 flex flex-col">
        {data.forecasts.slice(0, 3).map((forecast) => (
          <ForecastRow key={forecast.id} forecast={forecast} short onOpen={(f) => nav.openForecast(f.id)} />
        ))}
      </div>
    </section>
  );
}

/** One step either side: what led to this story and what it leads to. */
function CausesEffects({ story, nav }: { story: Story; nav: Nav }) {
  const id = useId();
  const query = useRpc("cascade", { id: story.id, depth: DEFAULT_CASCADE_DEPTH });

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-3 py-1" aria-busy="true" aria-label="Loading causes and effects">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-start gap-3 p-2">
            <Skeleton className="size-9 rounded-lg" />
            <SkeletonText lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    );
  } else if (query.isError) {
    body = <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    const { causes, effects } = directLinks(query.data);
    if (causes.length === 0 && effects.length === 0) {
      body = (
        <EmptyState
          compact
          icon={GitFork}
          title="No linked stories yet"
          description="Links appear as related news is analysed. The cascade can project possible next effects."
        />
      );
    } else {
      body = (
        <div className="flex flex-col gap-4">
          {causes.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-label font-medium text-fg-muted">What led to it</h4>
              <ul className="-mx-2 flex flex-col">
                {causes.map((c) => (
                  <LinkedStoryRow key={c.link.id} story={c.story} link={c.link} branch={c.branch} onOpen={nav.openStory} />
                ))}
              </ul>
            </div>
          )}
          {effects.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-label font-medium text-fg-muted">What it leads to</h4>
              <ul className="-mx-2 flex flex-col">
                {effects.map((e) => (
                  <LinkedStoryRow key={e.link.id} story={e.story} link={e.link} branch={e.branch} onOpen={nav.openStory} />
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionHeader
        as="h3"
        id={id}
        title="Causes and effects"
        icon={GitFork}
        description="Each link shows how we know it and how sure we are."
      />
      {body}
    </section>
  );
}

function WhoAndWhere({ story, nav }: { story: Story; nav: Nav }) {
  const id = useId();
  if (story.entities.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title="Who and where" icon={Shapes} count={story.entities.length} />
      <div className="flex flex-wrap gap-2">
        {story.entities.map((entity) => (
          <EntityChip key={entity.id} entity={entity} onClick={() => nav.openEntity(entity)} />
        ))}
      </div>
    </section>
  );
}

function SourcesSection({ story, title = "Sources" }: { story: Story; title?: string }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const limit = 5;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionHeader
        as="h3"
        id={id}
        title={title}
        icon={Newspaper}
        count={story.sources.length}
        action={
          story.sources.length > limit ? (
            <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? "Show fewer" : "Show all"}
            </Button>
          ) : undefined
        }
      />
      <SourcesList items={story.sources} sample={story.is_sample} limit={all ? undefined : limit} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Draft (not analysed yet)
// ---------------------------------------------------------------------------

function DraftStory({ data, nav }: { data: StoryResponse; nav: Nav }) {
  const { story } = data;
  const headingId = useId();
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;
  const linked = data.causes + data.effects > 0;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 p-4 pb-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DraftLabel />
          <span className="inline-flex items-center gap-1 text-label text-fg-muted">
            <EventIcon aria-hidden className="size-3.5" />
            {eventTypeLabel(story.event_type)}
          </span>
          {story.is_sample && <SampleBadge className="ml-auto" />}
        </div>
        <h2 id={headingId} className="text-figure font-semibold tracking-tight text-fg">
          {story.headline}
        </h2>
        <p className="text-label text-fg-muted">
          The headline as the source wrote it. Why it matters and what to do appear once it has been analysed.
        </p>
        {story.region && (
          <div className="flex flex-wrap items-center gap-1.5">
            <EntityChip
              size="sm"
              entity={{ id: story.region.id, type: "region", name: story.region.name }}
              onClick={() => nav.openRegion(story.region!.id)}
            />
          </div>
        )}
      </header>

      <SourcesSection story={story} title="Reported by" />
      <Glance story={story} />
      {linked && <CascadeButton data={data} nav={nav} quiet />}
      <CrowdSection data={data} nav={nav} />
      {linked && <CausesEffects story={story} nav={nav} />}
      <WhoAndWhere story={story} nav={nav} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function StorySkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4" aria-busy="true" aria-label="Loading story">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <Skeleton className="h-7 w-11/12" />
        <Skeleton className="h-7 w-2/3" />
        <SkeletonText lines={2} />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-11 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
