import type { UseQueryResult } from "@tanstack/react-query";
import { Bell, Star, Users, X } from "lucide-react";
import { useId, useState } from "react";

import type { EntityResponse, ForecastResponse, ForecastSummary } from "@/api/contract";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { Skeleton } from "@/components/ui/skeleton";
import { formatProbability } from "@/lib/format";
import { entityTypeTone } from "@/lib/meaning";
import { WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import type { AlertRules } from "@/state/profile";

import { ForecastFacts, TypeIcon } from "./business-parts";
import { typeOfId, watchActivity, watchKind } from "./business-data";
import { nameFromId, useEntityName } from "./entity-names";
import { EntityPicker } from "./EntityPicker";
import { forecastSummaryOf, type WatchQueries } from "./use-business";

const ROW_LIMIT = 6;
const SUGGESTED_LIMIT = 3;
const THRESHOLDS = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];

// ---------------------------------------------------------------------------
// Suggested forecasts
// ---------------------------------------------------------------------------

/** A star toggle that adds something to the watchlist or takes it off. */
export function WatchButton({
  watching,
  name,
  onToggle,
  className,
}: {
  watching: boolean;
  name: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={watching}
      aria-label={`Watch ${name}`}
      title={watching ? "On your watchlist" : "Add to your watchlist"}
      onClick={onToggle}
      className={cn(
        "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
        watching && "text-fg",
        className,
      )}
    >
      <Star aria-hidden className={cn("size-4", watching && "fill-current")} />
    </button>
  );
}

/** Crowd forecasts linked to the profile (from api.affects), each with a watch toggle. */
export function SuggestedForecasts({
  forecasts,
  loading,
  watchlist,
  onToggleWatch,
}: {
  forecasts: readonly ForecastSummary[] | undefined;
  loading: boolean;
  watchlist: readonly string[];
  onToggleWatch: (id: string) => void;
}) {
  const open = useNav((s) => s.open);
  const headingId = useId();
  const [all, setAll] = useState(false);
  const list = forecasts ?? [];
  if (!loading && list.length === 0) return null;
  const shown = all ? list : list.slice(0, SUGGESTED_LIMIT);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4"
    >
      <SectionHeader
        id={headingId}
        title="Crowd forecasts for you"
        icon={Users}
        description="About your places and inputs. Crowd forecasts are estimates and can be wrong."
      />
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading crowd forecasts" className="flex flex-col gap-3 py-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="-mx-3 flex flex-col">
          {shown.map((f) => (
            <li key={f.id} className="flex items-start">
              <ForecastRow
                forecast={f}
                short
                onOpen={() => open({ kind: "forecast", id: f.id })}
                className="min-w-0 flex-1"
              />
              <WatchButton
                watching={watchlist.includes(f.id)}
                name={f.short_title}
                onToggle={() => onToggleWatch(f.id)}
                className="mt-1.5"
              />
            </li>
          ))}
        </ul>
      )}
      {list.length > SUGGESTED_LIMIT && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="h-10 cursor-pointer rounded-lg border border-line text-body text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
        >
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchlistProps {
  ids: readonly string[];
  watch: WatchQueries;
  since: string | null;
  rules: AlertRules;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onThreshold: (id: string, threshold: number | null) => void;
}

/**
 * Places, entities and crowd forecasts the viewer follows, with their
 * latest activity. Tapping one opens its panel.
 */
export function Watchlist({ ids, watch, since, rules, onAdd, onRemove, onThreshold }: WatchlistProps) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  // Newest first.
  const ordered = [...ids].reverse();
  const shown = all ? ordered : ordered.slice(0, ROW_LIMIT);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <SectionHeader
        id={headingId}
        title="Watchlist"
        icon={Star}
        count={ids.length || undefined}
        description="Follow places, companies, inputs and crowd forecasts."
      />
      <EntityPicker
        types={["region", "organization", "commodity", "infrastructure", "policy", "forecast"]}
        exclude={ids}
        onPick={(e) => onAdd(e.id)}
        label="Add to your watchlist"
        placeholder="Add a place, company, input or forecast"
      />
      {ids.length === 0 ? (
        <p className="text-body text-fg-muted">
          Nothing here yet. Add something above, or tap Watch on a region, company or forecast anywhere in the
          app.
        </p>
      ) : (
        <>
          <ul className="-mx-2 flex flex-col">
            {shown.map((id) => (
              <li key={id} className="border-t border-line first:border-t-0">
                {watchKind(id) === "forecast" ? (
                  <WatchForecastRow
                    id={id}
                    query={watch.forecasts.get(id)}
                    threshold={rules.thresholds[id] ?? null}
                    onThreshold={(t) => onThreshold(id, t)}
                    onRemove={() => onRemove(id)}
                  />
                ) : (
                  <WatchEntityRow
                    id={id}
                    query={watch.entities.get(id)}
                    since={since}
                    onRemove={() => onRemove(id)}
                  />
                )}
              </li>
            ))}
          </ul>
          {ordered.length > ROW_LIMIT && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="h-10 cursor-pointer rounded-lg border border-line text-body text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {all ? "Show fewer" : `Show all ${ordered.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${name} from your watchlist`}
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}

function WatchEntityRow({
  id,
  query,
  since,
  onRemove,
}: {
  id: string;
  query: UseQueryResult<EntityResponse, Error> | undefined;
  since: string | null;
  onRemove: () => void;
}) {
  const open = useNav((s) => s.open);
  const timeWindow = useNav((s) => s.window);
  const known = useEntityName(id);
  const entity = query?.data?.entity;
  const name = entity?.name ?? known.name;
  const type = entity?.type ?? known.type ?? typeOfId(id) ?? "region";
  const activity = query?.data ? watchActivity(query.data.timeline, timeWindow, since) : null;
  const missing = !!query?.error && /^not found/i.test(query.error.message);
  const windowShort = WINDOW_LABELS[timeWindow].short;
  const countText = activity
    ? activity.inWindow === 0
      ? `No news in ${windowShort}`
      : `${activity.inWindow}${activity.capped ? "+" : ""} ${activity.inWindow === 1 ? "story" : "stories"} in ${windowShort}`
    : missing
      ? "No longer available"
      : query?.isError
        ? "Couldn't load its news"
        : query
          ? null
          : "";
  const openEntity = () => open(type === "region" ? { kind: "region", id } : { kind: "entity", id });

  return (
    <div className="flex items-start gap-1 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={openEntity}
          disabled={missing}
          aria-label={`${name}, ${entityTypeTone(type).label.toLowerCase()}${countText ? `: ${countText}` : ""}${activity?.fresh ? `, ${activity.fresh} new since your last visit` : ""}`}
          className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md text-left disabled:cursor-default"
        >
          <TypeIcon type={type} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("truncate text-body font-medium", missing ? "text-fg-muted" : "text-fg")}>
              {name}
            </span>
            {countText === null ? (
              <Skeleton className="mt-1 h-3 w-24" />
            ) : (
              countText && <span className="text-label text-fg-muted tabular-nums">{countText}</span>
            )}
          </span>
          {activity && activity.fresh > 0 && (
            <span className="shrink-0 rounded-full bg-fg px-1.5 text-label font-semibold text-bg tabular-nums">
              {activity.fresh} new
            </span>
          )}
        </button>
        {activity?.latest && (
          <button
            type="button"
            onClick={() => open({ kind: "story", id: activity.latest!.id })}
            className="ml-6 flex min-h-8 min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-label text-fg-muted hover:text-fg"
          >
            <span className="line-clamp-1 min-w-0">Latest: {activity.latest.headline}</span>
            <TimeAgo value={activity.latest.first_seen} className="shrink-0" />
            {activity.latest.is_sample && <SampleBadge iconOnly className="shrink-0 self-center" />}
          </button>
        )}
      </div>
      <RemoveButton name={name} onRemove={onRemove} />
    </div>
  );
}

function WatchForecastRow({
  id,
  query,
  threshold,
  onThreshold,
  onRemove,
}: {
  id: string;
  query: UseQueryResult<ForecastResponse, Error> | undefined;
  threshold: number | null;
  onThreshold: (t: number | null) => void;
  onRemove: () => void;
}) {
  const open = useNav((s) => s.open);
  const selectId = useId();
  const forecast = forecastSummaryOf(query?.data);
  const fallbackName = nameFromId(id);

  if (!forecast) {
    if (query?.isError) {
      return (
        <div className="flex items-start gap-1 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
          </div>
          <RemoveButton name={fallbackName} onRemove={onRemove} />
        </div>
      );
    }
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className="flex items-center gap-3 px-2 py-2">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1 px-2 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          onClick={() => open({ kind: "forecast", id })}
          className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-md text-left"
        >
          <ProbabilityRing
            size="sm"
            probability={forecast.probability}
            change24h={forecast.change_24h}
            thin={forecast.thin}
            label={forecast.short_title}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <span className="line-clamp-2 text-body font-medium text-fg">{forecast.short_title}</span>
            <ForecastFacts forecast={forecast} />
            {forecast.is_sample && <SampleBadge compact className="self-start" />}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-14">
          <label htmlFor={selectId} className="inline-flex items-center gap-1.5 text-label text-fg-muted">
            <Bell aria-hidden className="size-3.5 shrink-0" />
            Alert when it crosses
          </label>
          <select
            id={selectId}
            value={threshold === null ? "" : String(threshold)}
            onChange={(e) => onThreshold(e.target.value === "" ? null : Number(e.target.value))}
            className="h-10 cursor-pointer rounded-lg border border-line-strong bg-surface px-2 text-label text-fg tabular-nums"
          >
            <option value="">Off</option>
            {THRESHOLDS.map((t) => (
              <option key={t} value={String(t)}>
                {formatProbability(t)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <RemoveButton name={forecast.short_title} onRemove={onRemove} />
    </div>
  );
}
