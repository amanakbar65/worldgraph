import {
  BriefcaseBusiness,
  Gauge,
  Hourglass,
  Info,
  Link2,
  MapPin,
  MessageCircleQuestion,
  Network,
  Newspaper,
  NotebookPen,
  Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import type { EntityResponse, EntityType, ForecastSummary, HistoryPoint, Kpi, StorySummary } from "@/api/contract";
import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { KpiTile } from "@/components/KpiTile";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { Sparkline } from "@/components/Sparkline";
import { StoryCard } from "@/components/StoryCard";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Chip, ChipButton } from "@/components/ui/chip";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { WeakMark } from "@/components/WeakMark";
import { useFlag } from "@/lib/flags";
import { formatProbability } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import {
  DEFAULT_EVENT_ICON,
  DEFAULT_RELATION_ICON,
  ENTITY_TYPE_ICONS,
  EVENT_TYPE_ICONS,
  IMPACT_ICONS,
  PROPERTY_KEY_ICONS,
  PROPERTY_KIND_ICONS,
  RELATION_ICONS,
  eventTypeKey,
} from "@/lib/icons";
import { entityTypeTone, impactTone, isWeak, WEAK_LINK_LABEL } from "@/lib/meaning";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useUserValue } from "@/platform/storage";
import { useNav, type Panel } from "@/state/nav";

import {
  countImpacts,
  factsBeyondProperties,
  groupBacklinks,
  indicatorSubject,
  kindLine,
  profileRoles,
  propertyChips,
  readProfile,
  redirectFor,
  shapeConnections,
  shapeFacts,
  type ConnectionItem,
  type FactLink,
  type PropertyChip,
  type ShapedConnections,
  type ShapedFact,
} from "./entity-data";
import { EntityLocalGraph } from "./EntityLocalGraph";
import { EntityNotes } from "./EntityNotes";
import { useGraphNav, type GraphNav } from "./use-graph-nav";

type Data = EntityResponse;

const TIMELINE_LIMIT = 5;
const FORECAST_LIMIT = 3;
const GROUP_LIMIT = 8;
/** Phones show fewer chips per relation before "more". */
const PHONE_GROUP_LIMIT = 4;

/**
 * An entity's page, like a note in a knowledge base: what it is, its key
 * facts and numbers, the news that mentions it, the crowd's forecasts about
 * it, what links to it, its neighbourhood in the graph, and your own note.
 * Places, stories and forecasts have their own panels and hand over to them.
 */
export default function EntityPanel({ panel }: { panel: Extract<Panel, { kind: "entity" }> }) {
  const id = panel.id;
  const below = useNav((s) => (s.panels.length > 1 ? s.panels[s.panels.length - 2] : null));
  const replace = useNav((s) => s.replace);
  const early = redirectFor(id, below);
  const query = useRpc(
    "entity",
    { id },
    {
      enabled: !early,
      // Keep this entity on screen while it refreshes; never show another one.
      placeholderData: (previous) => (previous && previous.entity.id === id ? previous : undefined),
    },
  );
  const data = query.data && query.data.entity.id === id ? query.data : undefined;
  const target = early ?? (data ? redirectFor(id, below, data.entity.type) : null);
  const targetKey = target ? JSON.stringify(target) : null;
  const nav = useGraphNav();

  useEffect(() => {
    if (targetKey) replace(JSON.parse(targetKey) as Panel);
  }, [targetKey, replace]);

  if (target || (query.isPending && !data)) return <EntitySkeleton />;
  if (!data) {
    return (
      <div className="p-4">
        <ErrorState error={query.error ?? new Error("Not found")} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  // Keyed by entity: moving to the next page starts fresh (expanded lists, the note box).
  return <EntityBody key={data.entity.id} data={data} nav={nav} />;
}

function EntityBody({ data, nav }: { data: Data; nav: GraphNav }) {
  const headingId = useId();
  const { entity, graph } = data;
  const propertiesOn = useFlag("kg.properties");
  const relationsOn = useFlag("kg.relations");
  const subject = useMemo(() => indicatorSubject(entity, graph), [entity, graph]);
  // Typed properties (kg.properties) as chips; the older facts only for what they don't say.
  const chips = useMemo(() => (propertiesOn ? propertyChips(data.properties) : []), [propertiesOn, data.properties]);
  const facts = useMemo(() => {
    const shaped = shapeFacts(
      chips.length ? factsBeyondProperties(entity.facts, data.properties) : entity.facts,
      graph,
      entity.id,
    );
    return subject ? [{ label: "Measures", value: subject.name, links: [subject] }, ...shaped] : shaped;
  }, [entity, graph, subject, chips.length, data.properties]);

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6 p-4 pb-8">
      <EntityHeader data={data} nav={nav} headingId={headingId} />
      <ImpactOnYou data={data} nav={nav} />
      <FactsSection facts={facts} chips={chips} nav={nav} />
      <NumbersSection data={data} subject={subject} nav={nav} />
      <TimelineSection data={data} nav={nav} />
      <ForecastsSection data={data} nav={nav} />
      <Section icon={Network} title="Connections" description="Its neighbourhood in the knowledge graph. Tap a dot to open it.">
        <EntityLocalGraph
          entity={entity}
          graph={graph}
          onOpen={nav.openNode}
          onShowInGraph={(depth) => nav.showInGraph(entity, depth)}
        />
      </Section>
      {relationsOn ? <ConnectionsSection data={data} nav={nav} /> : <LinkedFromSection data={data} nav={nav} />}
      <Section icon={NotebookPen} title="Your note">
        <EntityNotes id={entity.id} name={entity.name} onOpen={nav.openNode} />
      </Section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function EntityHeader({ data, nav, headingId }: { data: Data; nav: GraphNav; headingId: string }) {
  const { entity } = data;
  const tone = entityTypeTone(entity.type);
  const Icon = (ENTITY_TYPE_ICONS[entity.type] ?? ENTITY_TYPE_ICONS.story).icon;
  const sample = entity.is_sample || data.timeline.some((s) => s.is_sample) || data.forecasts.some((f) => f.is_sample);
  const onMap = entity.lon !== null && entity.lat !== null;
  const aliases = entity.aliases.filter((a) => a.trim() && a.toLowerCase() !== entity.name.toLowerCase());
  const action = "h-14 flex-col gap-1 px-2 text-label";

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl border", tone.border, tone.tint)}
        >
          <Icon className={cn("size-5", tone.text)} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={headingId} className="text-figure font-semibold tracking-tight text-fg">
            {entity.name}
          </h2>
          <p className="text-label text-fg-muted">{kindLine(entity.type, entity.subtype)}</p>
        </div>
        {sample && <SampleBadge className="mt-2" />}
      </div>

      {(entity.summary || aliases.length > 0) && (
        <div className="flex flex-col gap-1">
          {entity.summary && <p className="text-body text-fg-muted">{entity.summary}</p>}
          {aliases.length > 0 && (
            <p className="text-label text-fg-subtle">Also called {aliases.slice(0, 5).join(", ")}</p>
          )}
        </div>
      )}

      <div className={cn("grid gap-2", onMap ? "grid-cols-3" : "grid-cols-2")}>
        <Button
          variant="secondary"
          className={action}
          onClick={() => nav.showInGraph(entity, 2)}
          aria-label={`Show ${entity.name} in the knowledge graph`}
        >
          <Network aria-hidden />
          Graph
        </Button>
        <Button
          variant="secondary"
          className={action}
          onClick={() => nav.ask(entity.id)}
          aria-label={`Ask about ${entity.name}`}
        >
          <MessageCircleQuestion aria-hidden />
          Ask
        </Button>
        {onMap && (
          <Button
            variant="secondary"
            className={action}
            onClick={() => nav.showOnMap(entity.lon!, entity.lat!)}
            aria-label={`Show ${entity.name} on the map`}
          >
            <MapPin aria-hidden />
            Map
          </Button>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  description,
  action,
  count,
  children,
}: {
  icon: Parameters<typeof SectionHeader>[0]["icon"];
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title={title} icon={icon} description={description} action={action} count={count} />
      {children}
    </section>
  );
}

function ShowAll({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle: () => void; noun?: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
      {open ? "Show fewer" : `Show all ${total}${noun ? ` ${noun}` : ""}`}
    </Button>
  );
}

// Impact on you ---------------------------------------------------------------

function ImpactOnYou({ data, nav }: { data: Data; nav: GraphNav }) {
  const stored = useUserValue<unknown>("profile", null);
  const roles = useMemo(() => profileRoles(readProfile(stored.value), data.entity.id), [stored.value, data.entity.id]);
  if (roles.length === 0) return null;
  const counts = countImpacts(data.timeline);
  const analysed = counts.risk + counts.opportunity + counts.neutral;
  return (
    <section
      aria-label="Impact on you"
      className="flex flex-col gap-2 rounded-xl border border-type-user/40 bg-type-user/6 p-3"
    >
      <p className="flex items-center gap-2 text-body font-semibold text-fg">
        <BriefcaseBusiness aria-hidden className="size-4 text-type-user" />
        Impact on you
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="In your business profile">
        {roles.map((role) => (
          <li key={role}>
            <Chip size="md" className="border-type-user/40">
              {role}
            </Chip>
          </li>
        ))}
      </ul>
      {analysed > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-fg-muted">
          In its latest news:
          <ImpactCount impact="risk" n={counts.risk} />
          <ImpactCount impact="opportunity" n={counts.opportunity} />
          <ImpactCount impact="neutral" n={counts.neutral} />
        </p>
      )}
      <Button variant="ghost" size="sm" className="self-start px-2" onClick={nav.openBusiness}>
        See what affects your business
      </Button>
    </section>
  );
}

function ImpactCount({ impact, n }: { impact: "risk" | "opportunity" | "neutral"; n: number }) {
  if (n === 0) return null;
  const tone = impactTone(impact);
  const Icon = IMPACT_ICONS[impact].icon;
  const word = impact === "opportunity" ? (n === 1 ? "opportunity" : "opportunities") : impact === "risk" ? (n === 1 ? "risk" : "risks") : "neutral";
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium tabular-nums", tone.text)}>
      <Icon aria-hidden className="size-3.5" />
      {n} {word}
    </span>
  );
}

// Facts --------------------------------------------------------------------

function FactsSection({ facts, chips, nav }: { facts: ShapedFact[]; chips: PropertyChip[]; nav: GraphNav }) {
  if (facts.length === 0 && chips.length === 0) return null;
  return (
    <Section icon={Info} title="Key facts">
      {chips.length > 0 && (
        <ul aria-label="Properties" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <PropertyChipView key={chip.key} chip={chip} nav={nav} />
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] items-baseline gap-x-4 gap-y-2.5 rounded-xl border border-line p-3">
          {facts.map((fact) => (
            <FactRow key={fact.label} fact={fact} onOpen={nav.openNode} />
          ))}
        </dl>
      )}
    </Section>
  );
}

/**
 * One key fact as a chip: icon, label and value. A place opens the map
 * (flown there, with its panel); an entity opens its page. Several places
 * or entities: the label once, then a chip for each.
 */
function PropertyChipView({ chip, nav }: { chip: PropertyChip; nav: GraphNav }) {
  const Icon = PROPERTY_KEY_ICONS[chip.key] ?? PROPERTY_KIND_ICONS[chip.kind].icon;
  const look = "border-line bg-surface-2/70";
  if (!chip.targets) {
    return (
      <li className="max-w-full">
        <Chip size="md" className={look} title={`${chip.label}: ${chip.display}`}>
          <Icon aria-hidden className="text-fg-muted" />
          <span className="shrink-0 font-normal text-fg-muted">{chip.label}</span>
          <span className="truncate text-fg">{chip.display}</span>
        </Chip>
      </li>
    );
  }
  const open = (target: { id: string; type: EntityType }) =>
    chip.opens === "map" ? nav.showPlaceOnMap(target.id) : nav.openNode(target);
  const many = chip.targets.length > 1;
  return (
    <li className="flex max-w-full flex-wrap items-center gap-1.5">
      {many && (
        <span className="inline-flex items-center gap-1 px-1 text-label text-fg-muted">
          <Icon aria-hidden className="size-3.5" />
          {chip.label}
        </span>
      )}
      {chip.targets.map((target) => {
        const tone = entityTypeTone(target.type);
        const TargetIcon = (ENTITY_TYPE_ICONS[target.type] ?? ENTITY_TYPE_ICONS.story).icon;
        return (
          <ChipButton
            key={target.id}
            size="md"
            onClick={() => open(target)}
            aria-label={`${chip.label}: ${target.name}. ${chip.opens === "map" ? "Show on the map" : `Open ${tone.label.toLowerCase()}`}`}
            className={cn(look, tone.border, "hover:bg-surface-2")}
          >
            <TargetIcon aria-hidden className={tone.text} />
            {!many && <span className="shrink-0 font-normal text-fg-muted">{chip.label}</span>}
            <span className="truncate text-fg">{target.name}</span>
          </ChipButton>
        );
      })}
    </li>
  );
}

function FactRow({ fact, onOpen }: { fact: ShapedFact; onOpen: (node: FactLink) => void }) {
  return (
    <>
      <dt className="text-label text-fg-muted">{fact.label}</dt>
      <dd className="min-w-0 text-body text-fg">
        {fact.links ? (
          <span className="-my-1 flex flex-wrap gap-1.5">
            {fact.links.map((link) => (
              <EntityChip key={link.id} size="sm" entity={link} onClick={() => onOpen(link)} />
            ))}
          </span>
        ) : (
          fact.value
        )}
      </dd>
    </>
  );
}

// Key numbers ----------------------------------------------------------------

function NumbersSection({ data, subject, nav }: { data: Data; subject: FactLink | null; nav: GraphNav }) {
  if (data.entity.type === "indicator") return <OwnFigure id={data.entity.id} subject={subject} />;
  if (data.indicators.length === 0) return null;
  return (
    <Section icon={Gauge} title="Key numbers" count={data.indicators.length > 4 ? data.indicators.length : undefined}>
      <div className="grid grid-cols-2 gap-2">
        {data.indicators.slice(0, 6).map((kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} onClick={(k) => nav.openEntity(k.id)} />
        ))}
      </div>
    </Section>
  );
}

/** An indicator's own latest figure, read from what it measures. */
function OwnFigure({ id, subject }: { id: string; subject: FactLink | null }) {
  const query = useRpc("entity", { id: subject?.id ?? "" }, { enabled: !!subject && subject.type !== "story" });
  const kpi: Kpi | undefined = query.data?.indicators.find((k) => k.id === id);
  if (!subject || (!query.isPending && !kpi)) return null;
  return (
    <Section icon={Gauge} title="Latest figure">
      {kpi ? (
        <div className="flex flex-col gap-1.5">
          <KpiTile kpi={kpi} />
          {/* The tile tells screen readers the source and date already. */}
          <p aria-hidden className="text-label text-fg-muted">
            Source: {kpi.source_name} · as of {formatDate(kpi.as_of)}
          </p>
        </div>
      ) : (
        <Skeleton className="h-24 rounded-lg" />
      )}
    </Section>
  );
}

// Timeline ---------------------------------------------------------------------

function TimelineSection({ data, nav }: { data: Data; nav: GraphNav }) {
  const [all, setAll] = useState(false);
  const { timeline } = data;
  const shown = all ? timeline : timeline.slice(0, TIMELINE_LIMIT);
  return (
    <Section
      icon={Newspaper}
      title="In the news"
      count={timeline.length || undefined}
      description={timeline.length ? "Stories that mention it, newest first." : undefined}
      action={
        timeline.length > TIMELINE_LIMIT ? (
          <ShowAll total={timeline.length} open={all} onToggle={() => setAll((v) => !v)} />
        ) : undefined
      }
    >
      {timeline.length > 0 ? (
        <ol className="-mx-2 flex flex-col">
          {shown.map((story) => (
            <li key={story.id}>
              <TimelineRow story={story} onOpen={nav.openStory} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          compact
          icon={Newspaper}
          title="No stories yet"
          description="News that mentions it appears here as it is analysed."
          action={{ label: "Ask about it", onClick: () => nav.ask(data.entity.id) }}
        />
      )}
    </Section>
  );
}

/** A story on the timeline: the compact card, or the source headline for a draft not yet analysed. */
function TimelineRow({ story, onOpen }: { story: StorySummary; onOpen: (id: string) => void }) {
  if (story.analysed) {
    return <StoryCard story={story} variant="compact" onOpen={() => onOpen(story.id)} />;
  }
  const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(story.id)}
      aria-label={`${story.headline}. Draft, awaiting analysis.`}
      className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-2/70"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong"
      >
        <EventIcon className="size-4 text-fg-muted" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-fg-muted">
          <Chip tone="outline" title="Straight from the news feed; the summary and actions come after analysis">
            <Hourglass aria-hidden />
            Draft · awaiting analysis
          </Chip>
          {story.first_seen && <TimeAgo value={story.first_seen} />}
          {story.is_sample && <SampleBadge iconOnly />}
        </span>
      </span>
    </button>
  );
}

// Forecasts ----------------------------------------------------------------------

function ForecastsSection({ data, nav }: { data: Data; nav: GraphNav }) {
  const [all, setAll] = useState(false);
  const { forecasts } = data;
  const shown = all ? forecasts : forecasts.slice(0, FORECAST_LIMIT);
  return (
    <Section
      icon={Users}
      title="Crowd forecasts"
      count={forecasts.length || undefined}
      description="What forecasters expect. Not facts; for information only."
      action={
        forecasts.length > FORECAST_LIMIT ? (
          <ShowAll total={forecasts.length} open={all} onToggle={() => setAll((v) => !v)} />
        ) : undefined
      }
    >
      {forecasts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shown.map((forecast) => (
            <li key={forecast.id}>
              <EntityForecast forecast={forecast} onOpen={nav.openForecast} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Users}
          title="No crowd forecasts about it"
          description="Questions about elections, rates or prices appear here when forecasters cover it."
          action={{ label: "Browse forecasts", onClick: nav.openForecasts }}
        />
      )}
    </Section>
  );
}

/** A crowd forecast with how its probability has moved. */
function EntityForecast({
  forecast,
  onOpen,
}: {
  forecast: ForecastSummary & { history: HistoryPoint[] };
  onOpen: (id: string) => void;
}) {
  const history = useMemo(
    () => [...forecast.history].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
    [forecast.history],
  );
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <div className={cn("rounded-xl border border-forecast/25 bg-forecast/4", forecast.thin && "opacity-80")}>
      <ForecastRow forecast={forecast} short onOpen={(f) => onOpen(f.id)} />
      {history.length > 1 && first && last && (
        <div className="flex items-center gap-3 px-3 pb-3">
          <Sparkline
            values={history.map((h) => h.p)}
            tone="forecast"
            domain={[0, 1]}
            label={`Crowd forecast history: ${formatProbability(first.p)} on ${formatDate(first.ts)}, ${formatProbability(last.p)} now.`}
            className="h-8 min-w-0 flex-1"
          />
          <span aria-hidden className="shrink-0 text-right text-label text-fg-muted tabular-nums">
            Since {formatDate(first.ts)}
          </span>
        </div>
      )}
    </div>
  );
}

// Links, grouped by relation (kg.relations) -------------------------------------------

/**
 * Every link, one compact group per relation, read from this page's side
 * ("Owned by", "Supplies", "Competes with"). What the page shows elsewhere
 * (its forecasts, key numbers and news) is left out.
 */
function ConnectionsSection({ data, nav }: { data: Data; nav: GraphNav }) {
  const shownElsewhere = useMemo(
    () =>
      new Set([
        ...data.forecasts.map((f) => f.id),
        ...data.indicators.map((k) => k.id),
        ...data.timeline.map((s) => s.id),
      ]),
    [data.forecasts, data.indicators, data.timeline],
  );
  const groups = useMemo(() => shapeConnections(data.connections, shownElsewhere), [data.connections, shownElsewhere]);
  if (groups.length === 0) return null;
  return (
    <Section icon={Link2} title="Links">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <ConnectionGroupRow
            key={`${group.relation}:${group.direction}`}
            group={group}
            entity={data.entity}
            nav={nav}
          />
        ))}
      </div>
    </Section>
  );
}

function ConnectionGroupRow({
  group,
  entity,
  nav,
}: {
  group: ShapedConnections;
  entity: Data["entity"];
  nav: GraphNav;
}) {
  const [all, setAll] = useState(false);
  const id = useId();
  const limit = useIsDesktop() ? GROUP_LIMIT : PHONE_GROUP_LIMIT;
  const Icon = (RELATION_ICONS[group.relation] ?? DEFAULT_RELATION_ICON).icon;
  const shown = all ? group.items : group.items.slice(0, limit);
  const quiet =
    "relative inline-flex h-6 cursor-pointer items-center rounded-full px-2 text-label font-medium text-fg-muted underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-[''] hover:text-fg hover:underline";
  return (
    <div className="flex flex-col gap-1.5">
      <h4 id={id} className="flex items-center gap-1.5 text-label text-fg-muted">
        <Icon aria-hidden className="size-3.5" />
        <span className="font-medium text-fg">{group.label}</span>
        <span className="tabular-nums">{group.count}</span>
      </h4>
      <ul aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <ConnectionChip
            key={item.id}
            item={item}
            // Sample items are marked where the page itself isn't sample data.
            markSample={item.is_sample && !entity.is_sample}
            weak={group.causal && isWeak(item.confidence)}
            onOpen={() => nav.openNode(item)}
          />
        ))}
        {group.items.length > limit && (
          <li>
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={quiet}>
              {all ? "Show fewer" : `${group.items.length - limit} more`}
            </button>
          </li>
        )}
        {group.beyond > 0 && (all || group.items.length <= limit) && (
          <li>
            <button
              type="button"
              onClick={() =>
                nav.showRelationInGraph(entity, group.relation, group.direction === "both" ? "both" : group.direction)
              }
              className={quiet}
            >
              See all {group.count} in the graph
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function ConnectionChip({
  item,
  markSample,
  weak,
  onOpen,
}: {
  item: ConnectionItem;
  markSample: boolean;
  weak: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex max-w-full items-center gap-1">
      <EntityChip size="sm" entity={item} onClick={onOpen} />
      {weak && <WeakMark label={WEAK_LINK_LABEL} />}
      {markSample && <SampleBadge iconOnly />}
    </li>
  );
}

// Linked from ---------------------------------------------------------------------

function LinkedFromSection({ data, nav }: { data: Data; nav: GraphNav }) {
  const shownElsewhere = useMemo(
    () => new Set([...data.forecasts.map((f) => f.id), ...data.indicators.map((k) => k.id)]),
    [data.forecasts, data.indicators],
  );
  const groups = useMemo(() => groupBacklinks(data.backlinks, shownElsewhere), [data.backlinks, shownElsewhere]);
  if (groups.length === 0) return null;
  return (
    <Section icon={Link2} title="Linked from" description="Pages that point here, by kind.">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <BacklinkGroupRow key={group.type} type={group.type} title={group.title} relation={group.relation} items={group.items} nav={nav} />
        ))}
      </div>
    </Section>
  );
}

function BacklinkGroupRow({
  type,
  title,
  relation,
  items,
  nav,
}: {
  type: EntityType;
  title: string;
  relation: string;
  items: Data["backlinks"];
  nav: GraphNav;
}) {
  const [all, setAll] = useState(false);
  const id = useId();
  const tone = entityTypeTone(type);
  const Icon = (ENTITY_TYPE_ICONS[type] ?? ENTITY_TYPE_ICONS.story).icon;
  const shown = all ? items : items.slice(0, GROUP_LIMIT);
  return (
    <div className="flex flex-col gap-1.5">
      <h4 id={id} className="flex items-center gap-1.5 text-label text-fg-muted">
        <Icon aria-hidden className={cn("size-3.5", tone.text)} />
        <span className="font-medium text-fg">{title}</span>
        <span className="tabular-nums">{items.length}</span>
        {relation && <span>· {relation}</span>}
      </h4>
      <ul aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <li key={item.id} className="max-w-full">
            <EntityChip size="sm" entity={item} onClick={() => nav.openNode(item)} />
          </li>
        ))}
        {items.length > GROUP_LIMIT && (
          <li>
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="relative inline-flex h-6 cursor-pointer items-center rounded-full px-2 text-label font-medium text-fg-muted underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-10 before:-translate-y-1/2 before:content-[''] hover:text-fg hover:underline"
            >
              {all ? "Show fewer" : `${items.length - GROUP_LIMIT} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function EntitySkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
        <SkeletonText lines={2} />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <SkeletonText lines={2} className="flex-1" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
