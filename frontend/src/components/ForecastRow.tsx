import { ExternalLink, Users } from "lucide-react";

import type { ForecastSummary } from "@/api/contract";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { SampleBadge } from "@/components/SampleBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { formatCompact } from "@/lib/format";
import { safeHttpUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

export interface ForecastRowProps {
  /** A forecast from api.forecasts, api.story, api.region (decisions) and others. */
  forecast: ForecastSummary;
  /** Opens the forecast detail; makes the whole row tappable. */
  onOpen?: (forecast: ForecastSummary) => void;
  /** Show the short title instead of the full question (for tight spaces). */
  short?: boolean;
  /** Number formatting locale; defaults to the viewer's. */
  locale?: string;
  className?: string;
}

/** "12.4K MANA volume", or a plain note when the provider gives none. */
function volumeText(forecast: ForecastSummary, locale?: string): string {
  if (forecast.volume === null) return "Volume not reported";
  const unit = forecast.volume_unit ? ` ${forecast.volume_unit}` : "";
  return `${formatCompact(forecast.volume, locale)}${unit} volume`;
}

/**
 * One crowd forecast as a row: the question, a probability bar with the
 * 24-hour change, then volume, end date, last update and the provider as
 * plain text. A link to the provider appears only when the API gives a URL
 * (it is null where linking isn't allowed). Information only.
 */
export function ForecastRow({ forecast, onOpen, short = false, locale, className }: ForecastRowProps) {
  const url = safeHttpUrl(forecast.url);
  const title = short ? forecast.short_title : forecast.question;
  const titleContent = (
    <>
      <span className="line-clamp-2">{title}</span>
      <span className="sr-only">, crowd forecast</span>
    </>
  );

  return (
    <article
      className={cn(
        "relative flex flex-col gap-2 rounded-lg p-3",
        onOpen && "transition-colors hover:bg-surface-2/70",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-forecast" />
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(forecast)}
            // The ::after layer stretches the click target over the whole row.
            className="min-w-0 flex-1 cursor-pointer text-left text-body text-fg after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {titleContent}
          </button>
        ) : (
          <p className="min-w-0 flex-1 text-body text-fg">{titleContent}</p>
        )}
        {forecast.is_sample && <SampleBadge compact className="mt-0.5" />}
      </div>

      <ProbabilityBar
        probability={forecast.probability}
        change24h={forecast.change_24h}
        thin={forecast.thin}
        label={forecast.short_title}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-fg-muted">
        {forecast.thin && (
          <span className="rounded-full border border-dashed border-line-strong px-1.5">Thin market</span>
        )}
        <span className="tabular-nums">{volumeText(forecast, locale)}</span>
        {forecast.end_date && (
          <>
            <span aria-hidden>·</span>
            <TimeAgo value={forecast.end_date} prefix="Ends" pastPrefix="Ended" />
          </>
        )}
        {forecast.updated_at && (
          <>
            <span aria-hidden>·</span>
            <TimeAgo value={forecast.updated_at} prefix="Updated" />
          </>
        )}
        <span aria-hidden>·</span>
        <span>Source: {forecast.provider_name}</span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 -my-2 inline-flex h-10 items-center gap-1 rounded-md px-1.5 font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Open on {forecast.provider_name}
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(new tab)</span>
          </a>
        )}
      </div>
    </article>
  );
}
