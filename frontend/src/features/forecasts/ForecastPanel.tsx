import { ChartLine, ExternalLink, GitFork, Info, Newspaper, Scale, Shapes, Users } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { ForecastResponse } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { EmptyState } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ErrorState } from "@/components/ErrorState";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ProbabilityHistoryChart } from "@/components/ProbabilityHistoryChart";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";
import { safeHttpUrl } from "@/lib/links";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Panel } from "@/state/nav";

import {
  CATEGORIES,
  branchTitle,
  branchViews,
  changeWords,
  isBigMove,
  moneyKind,
  moneyNote,
  outcomeChances,
  questionAddsDetail,
  type BranchView,
} from "./forecast-data";
import { ChangeFigure, PlayMoneyTag, StoryRow, ThinTag, VolumeFigure } from "./forecast-parts";
import { useForecastNav } from "./use-forecast-nav";

type Detail = ForecastResponse["forecast"];
type Nav = ReturnType<typeof useForecastNav>;

/**
 * One crowd forecast: the question, the crowd's number and how it moved,
 * how it resolves, what could follow each outcome, related stories and the
 * source. Information only.
 */
export default function ForecastPanel({ panel }: { panel: Extract<Panel, { kind: "forecast" }> }) {
  const query = useRpc("forecast", { id: panel.id });
  const nav = useForecastNav();

  if (query.isPending) return <ForecastSkeleton />;
  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  return <ForecastDetail data={query.data} nav={nav} />;
}

function ForecastDetail({ data, nav }: { data: ForecastResponse; nav: Nav }) {
  const f = data.forecast;
  const headingId = useId();
  const category = CATEGORIES[f.category];
  const CategoryIcon = category?.icon;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-7 p-4 pb-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="forecast" size="md">
            <Users aria-hidden />
            Crowd forecast
          </Chip>
          {category && CategoryIcon && (
            <span className="inline-flex items-center gap-1 text-label text-fg-muted">
              <CategoryIcon aria-hidden className="size-3.5" />
              {category.label}
            </span>
          )}
          {moneyKind(f) === "play" && <PlayMoneyTag />}
          {f.is_sample && <SampleBadge className="ml-auto" />}
        </div>
        <h2 id={headingId} className="text-figure font-semibold tracking-tight text-fg">
          {f.short_title}
        </h2>
        {questionAddsDetail(f.short_title, f.question) && <p className="text-body text-fg-muted">{f.question}</p>}
      </header>

      <Now forecast={f} />
      <History forecast={f} />
      <Branches data={data} nav={nav} />
      <Resolution forecast={f} />
      <RelatedStories forecast={f} nav={nav} />
      <WhoAndWhat forecast={f} nav={nav} />
      <Source forecast={f} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// The crowd's number now
// ---------------------------------------------------------------------------

function Now({ forecast: f }: { forecast: Detail }) {
  const id = useId();
  const chances = outcomeChances(f);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="sr-only">
        The crowd's forecast now
      </h3>
      <div className="flex items-center gap-5 rounded-xl border border-forecast/25 bg-forecast/6 p-4">
        <ProbabilityRing
          size="lg"
          probability={f.probability}
          change24h={f.change_24h}
          glow={isBigMove(f.change_24h)}
          thin={f.thin}
          label={`Chance of ${chances.length ? "YES" : f.outcomes[0] ?? "YES"}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {chances.length > 0 ? (
            chances.map((c) => (
              <div key={c.outcome} className="flex flex-col gap-1">
                <span className="text-label font-medium text-fg-muted">{c.outcome}</span>
                <ProbabilityBar
                  size="sm"
                  probability={c.probability}
                  thin={f.thin}
                  label={`${c.outcome}`}
                />
              </div>
            ))
          ) : (
            <OutcomeList outcomes={f.outcomes} />
          )}
          <p className="text-label text-fg-muted">
            {f.change_24h === null ? "No 24-hour change reported." : `YES ${changeWords(f.change_24h)}.`}
          </p>
        </div>
      </div>

      {f.thin && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-body text-fg-muted">
          <ThinTag className="mt-px text-label" />
          Few forecasters and little volume, so this number can swing on a handful of forecasts.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2">
        <Tile label="Volume">
          <VolumeFigure forecast={f} />
        </Tile>
        <Tile label="Liquidity">
          {f.liquidity === null ? (
            <span className="text-fg-muted">Not reported</span>
          ) : (
            <span className="tabular-nums">
              {formatCompact(f.liquidity)}
              {f.volume_unit && <span className="text-label text-fg-muted"> {f.volume_unit}</span>}
            </span>
          )}
        </Tile>
        <Tile label="Ends">
          {f.end_date ? (
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <TimeAgo value={f.end_date} />
              <span className="text-label text-fg-muted">{formatDate(f.end_date)}</span>
            </span>
          ) : (
            <span className="text-fg-muted">No end date</span>
          )}
        </Tile>
        <Tile label="Last update">
          {f.updated_at ? <TimeAgo value={f.updated_at} /> : <span className="text-fg-muted">Not reported</span>}
        </Tile>
      </dl>

      <SourceLine forecast={f} />
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="truncate text-body font-medium text-fg">{children}</dd>
    </div>
  );
}

function OutcomeList({ outcomes }: { outcomes: string[] }) {
  if (outcomes.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {outcomes.map((o) => (
        <li key={o}>
          <Chip tone="outline">{o}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** Where the number comes from, and the provider's page when linking is allowed. */
function SourceLine({ forecast: f }: { forecast: Detail }) {
  // The API sends a URL only where linking to the provider is allowed for this viewer.
  const url = safeHttpUrl(f.url);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
        <span>
          Source: <span className="font-medium text-fg">{f.provider_name}</span>
        </span>
        {moneyKind(f) === "play" && <span>· play money</span>}
        {f.updated_at && (
          <>
            <span aria-hidden>·</span>
            <TimeAgo value={f.updated_at} prefix="Updated" />
          </>
        )}
      </p>
      {url && (
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noreferrer">
            View on {f.provider_name}
            <ExternalLink aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function History({ forecast: f }: { forecast: Detail }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader
        as="h3"
        id={id}
        title="How the forecast has moved"
        icon={ChartLine}
        description="Chance of YES over time. Use the arrow keys on the chart to read each point."
      />
      <ProbabilityHistoryChart points={f.history} label={f.short_title} thin={f.thin} height={176} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// If YES / If NO
// ---------------------------------------------------------------------------

function Branches({ data, nav }: { data: ForecastResponse; nav: Nav }) {
  const id = useId();
  const branches = branchViews(data);
  if (branches.length === 0) return null;
  const any = branches.some((b) => b.effects.length > 0);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader
        as="h3"
        id={id}
        title="If YES / If NO"
        icon={GitFork}
        description="Possible effects of each outcome. Conditional links: they happen only if the question resolves that way."
      />
      {any ? (
        <div className="flex flex-col gap-3">
          {branches.map((b) => (
            <Branch key={b.outcome} branch={b} nav={nav} />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon={GitFork}
          title="No effects linked yet"
          description="Effects appear here when stories are linked to an outcome of this question."
          className="rounded-xl border border-dashed border-line-strong"
        />
      )}
    </section>
  );
}

function Branch({ branch, nav }: { branch: BranchView; nav: Nav }) {
  const title = branchTitle(branch.outcome, branch.probability);
  return (
    <div className="overflow-hidden rounded-xl border border-forecast/25">
      <div className="flex items-center gap-2 border-b border-line bg-forecast/6 px-3 py-2">
        <Chip tone="forecast" size="md">
          <Users aria-hidden />
          <span className="tabular-nums">{title}</span>
          <span className="sr-only"> crowd forecast</span>
        </Chip>
        <span className="ml-auto text-label text-fg-muted">
          {branch.effects.length === 0
            ? "No effects linked"
            : `${branch.effects.length} possible ${branch.effects.length === 1 ? "effect" : "effects"}`}
        </span>
      </div>
      {branch.effects.length > 0 && (
        <ul className="flex flex-col p-1">
          {branch.effects.map((effect) => (
            <StoryRow key={`${effect.id}-${effect.from_story}`} story={effect} onOpen={nav.openStory}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-label font-medium text-fg">{capitalise(effect.mechanism)}</span>
                <ConfidenceMeter confidence={effect.confidence} linkType="conditional" />
              </span>
            </StoryRow>
          ))}
        </ul>
      )}
    </div>
  );
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// ---------------------------------------------------------------------------
// Resolution, related stories, entities, source
// ---------------------------------------------------------------------------

function Resolution({ forecast: f }: { forecast: Detail }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title="How it resolves" icon={Scale} />
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
        <p className="text-body text-fg">{f.resolution_rule ?? "The provider hasn't published a resolution rule."}</p>
        <p className="text-label text-fg-muted">
          {f.outcomes.length > 0 && <>Outcomes: {f.outcomes.join(" or ")}. </>}
          {f.end_date ? <>Closes {formatDate(f.end_date)}.</> : "No end date set."}
        </p>
      </div>
    </section>
  );
}

function RelatedStories({ forecast: f, nav }: { forecast: Detail; nav: Nav }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionHeader as="h3" id={id} title="Related stories" icon={Newspaper} count={f.stories.length || undefined} />
      {f.stories.length === 0 ? (
        <EmptyState
          compact
          icon={Newspaper}
          title="No related stories yet"
          description="Stories about the same places and companies appear here as news comes in."
        />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {f.stories.map((story) => (
            <StoryRow key={story.id} story={story} onOpen={nav.openStory} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WhoAndWhat({ forecast: f, nav }: { forecast: Detail; nav: Nav }) {
  const id = useId();
  if (f.entities.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title="What it's about" icon={Shapes} count={f.entities.length} />
      <div className="flex flex-wrap gap-2">
        {f.entities.map((entity) => (
          <EntityChip key={entity.id} entity={entity} onClick={() => nav.openEntity(entity)} />
        ))}
      </div>
    </section>
  );
}

/** The provider, what kind of source it is, and the information-only note. */
function Source({ forecast: f }: { forecast: Detail }) {
  return (
    <footer className="flex flex-col gap-2 border-t border-line pt-4 text-label text-fg-muted">
      <p className="flex items-start gap-2">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          {moneyNote(f)} Crowd forecasts are estimates and can be wrong. For information only.
        </span>
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function ForecastSkeleton() {
  return (
    <div className="flex flex-col gap-7 p-4" aria-busy="true" aria-label="Loading forecast">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <Skeleton className="h-7 w-11/12" />
        <Skeleton className="h-7 w-2/3" />
        <SkeletonText lines={2} />
      </div>
      <div className="flex items-center gap-5 rounded-xl border border-line p-4">
        <Skeleton className="size-[120px] shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <Skeleton className={cn("h-44 rounded-lg")} />
    </div>
  );
}
