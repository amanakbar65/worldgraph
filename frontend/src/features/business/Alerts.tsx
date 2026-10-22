import { Bell, BellRing, CheckCheck, CircleCheck, Settings2, Users } from "lucide-react";
import { useId, useState } from "react";

import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SwitchField } from "@/components/ui/switch";
import { formatPointChange, formatProbability } from "@/lib/format";
import { DEFAULT_EVENT_ICON, EVENT_TYPE_ICONS, eventTypeKey, IMPACT_ICONS } from "@/lib/icons";
import { impactTone } from "@/lib/meaning";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import type { Alert, AlertRules } from "@/state/profile";

import { alertKey, volumeText } from "./business-data";
import { useKnownNames } from "./entity-names";

const LIMIT = 4;

/**
 * What's new since the last visit, at the top of My Business: matching
 * stories, news on the watchlist, and big moves in watched crowd forecasts.
 */
export function AlertsCard({
  alerts,
  since,
  ready,
  onMarkSeen,
}: {
  alerts: readonly Alert[];
  since: string | null;
  ready: boolean;
  onMarkSeen: () => void;
}) {
  const [all, setAll] = useState(false);
  const headingId = useId();
  if (!ready) return null;

  if (!since || alerts.length === 0) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-body text-fg-muted"
      >
        {since ? (
          <CircleCheck aria-hidden className="size-4 shrink-0" />
        ) : (
          <Bell aria-hidden className="size-4 shrink-0" />
        )}
        {since
          ? `You're up to date: nothing new since your last visit ${relativeTime(since)}.`
          : "From your next visit, new stories that match your business and watchlist show up here."}
      </p>
    );
  }

  const shown = all ? alerts : alerts.slice(0, LIMIT);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-4"
    >
      <SectionHeader
        id={headingId}
        title={`${alerts.length} new for you`}
        icon={BellRing}
        description={<TimeAgo value={since} prefix="Since your last visit" />}
        action={
          <Button variant="outline" size="sm" onClick={onMarkSeen} className="h-10">
            <CheckCheck aria-hidden />
            Mark all as seen
          </Button>
        }
      />
      <ul className="-mx-2 grid gap-x-4 md:grid-cols-2">
        {shown.map((alert, i) => (
          // Phones show three until "Show all".
          <li key={alertKey(alert)} className={cn(!all && i >= 3 && "hidden md:block")}>
            <AlertRow alert={alert} />
          </li>
        ))}
      </ul>
      {alerts.length > LIMIT && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="h-10 cursor-pointer self-start rounded-lg px-2 text-body text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {all ? "Show fewer" : `Show all ${alerts.length}`}
        </button>
      )}
    </section>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const open = useNav((s) => s.open);
  const names = useKnownNames((s) => s.names);
  const look =
    "flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2/70";

  if (alert.kind === "story") {
    const { story } = alert;
    const EventIcon = (EVENT_TYPE_ICONS[eventTypeKey(story.event_type)] ?? DEFAULT_EVENT_ICON).icon;
    const tone = impactTone(story.impact);
    const ImpactIcon = (IMPACT_ICONS[story.impact] ?? IMPACT_ICONS.neutral).icon;
    const watched = alert.watchIds.map((id) => names[id]?.name).filter(Boolean);
    const reason = alert.profile
      ? watched.length
        ? `Matches your business and your watchlist`
        : "Matches your business"
      : watched.length
        ? `On your watchlist: ${watched.join(", ")}`
        : "On your watchlist";
    return (
      <button type="button" onClick={() => open({ kind: "story", id: story.id })} className={look}>
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border",
            story.analysed ? cn(tone.tint, tone.border) : "border-dashed border-line-strong",
          )}
        >
          <EventIcon className={cn("size-4", story.analysed ? tone.text : "text-fg-muted")} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-body font-medium text-fg">{story.headline}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
            {story.analysed ? (
              <span className={cn("inline-flex items-center gap-1 font-medium", tone.text)}>
                <ImpactIcon aria-hidden className="size-3.5" />
                {tone.label}
              </span>
            ) : (
              <span>Draft · awaiting analysis</span>
            )}
            <span aria-hidden>·</span>
            <span>{reason}</span>
            <span aria-hidden>·</span>
            <TimeAgo value={story.first_seen} />
            {story.is_sample && <SampleBadge iconOnly />}
          </span>
        </span>
      </button>
    );
  }

  const { forecast } = alert;
  const what =
    alert.kind === "forecast-move"
      ? `${formatPointChange(alert.points / 100)} points in a day`
      : `Crossed ${formatProbability(alert.threshold)} ${alert.direction === "up" ? "▲" : "▼"}`;
  return (
    <button type="button" onClick={() => open({ kind: "forecast", id: forecast.id })} className={look}>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-forecast/60"
      >
        <Users className="size-3.5 text-forecast" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body font-medium text-fg">{forecast.short_title}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted tabular-nums">
          <span className="font-medium text-forecast">Crowd forecast</span>
          <span aria-hidden>·</span>
          <span>
            {formatProbability(forecast.probability)} now, {what}
          </span>
          <span aria-hidden>·</span>
          <span>{forecast.provider_name}</span>
          {/* Every probability shows its volume and when it was last updated. */}
          <span aria-hidden>·</span>
          <span>{volumeText(forecast)}</span>
          {forecast.updated_at && (
            <>
              <span aria-hidden>·</span>
              <TimeAgo value={forecast.updated_at} prefix="Updated" />
            </>
          )}
          {forecast.is_sample && <SampleBadge iconOnly />}
        </span>
      </span>
    </button>
  );
}

/** The viewer's alert rules, saved with the profile. */
export function AlertSettings({
  rules,
  onChange,
}: {
  rules: AlertRules;
  onChange: (rules: AlertRules) => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <SectionHeader
        id={headingId}
        title="Alerts"
        icon={Settings2}
        description="In-app only: what to flag at the top of this page when you come back."
      />
      <SwitchField
        label="New stories that match your business"
        checked={rules.profile}
        onCheckedChange={(profile) => onChange({ ...rules, profile })}
      />
      <SwitchField
        label="New stories on your watchlist"
        checked={rules.watchlist}
        onCheckedChange={(watchlist) => onChange({ ...rules, watchlist })}
      />
      <SwitchField
        label="Moves in watched crowd forecasts"
        description="Also when one crosses the level you set on it."
        checked={rules.forecasts}
        onCheckedChange={(forecasts) => onChange({ ...rules, forecasts })}
      />
      {rules.forecasts && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-label text-fg-muted">Flag a daily move of at least</span>
          <Segmented<"5" | "10" | "20">
            aria-label="Smallest daily move to flag, in points"
            size="sm"
            value={String(rules.forecastMove) as "5" | "10" | "20"}
            onValueChange={(v) =>
              onChange({ ...rules, forecastMove: Number(v) as AlertRules["forecastMove"] })
            }
            options={[
              { value: "5", label: "5 pts", ariaLabel: "5 points" },
              { value: "10", label: "10 pts", ariaLabel: "10 points" },
              { value: "20", label: "20 pts", ariaLabel: "20 points" },
            ]}
          />
        </div>
      )}
    </section>
  );
}
