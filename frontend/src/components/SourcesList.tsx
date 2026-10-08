import { ExternalLink, FlaskConical, Newspaper } from "lucide-react";

import type { Evidence, SourceRef } from "@/api/contract";
import { TimeAgo } from "@/components/TimeAgo";
import { safeHttpUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

/** A story source (SourceRef) or a piece of evidence for a causal link. */
export type SourceItem = Pick<SourceRef, "source_name" | "url" | "published_at"> & {
  title?: string | null;
  snippet?: string | null;
  is_sample?: boolean;
};

export interface SourcesListProps {
  /** Sources (`api.story`) or evidence (`api.cascade`), newest first. */
  items: readonly (SourceItem | SourceRef | Evidence)[];
  /** Everything in the list is sample data (e.g. the story is a sample). */
  sample?: boolean;
  /** Show at most this many (the rest are counted). */
  limit?: number;
  className?: string;
}

/**
 * Where a story comes from: source name, title, time, and a link that opens
 * the original in a new tab when there is one. Sample sources say "Sample
 * source" and never link.
 */
export function SourcesList({ items, sample = false, limit, className }: SourcesListProps) {
  const shown = limit ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  if (items.length === 0) {
    return <p className={cn("text-body text-fg-muted", className)}>No sources yet.</p>;
  }
  return (
    <div className={className}>
      <ul className="divide-y divide-line">
        {shown.map((raw, i) => {
          const item = raw as SourceItem;
          const isSample = sample || item.is_sample === true;
          const url = isSample ? null : safeHttpUrl(item.url);
          const text = item.title || item.snippet || "";
          const name = isSample ? "Sample source" : item.source_name;
          const Icon = isSample ? FlaskConical : Newspaper;
          return (
            <li key={`${item.source_name}-${item.published_at ?? ""}-${i}`} className="flex items-start gap-3 py-2.5">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted"
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
                  <span className="font-medium">{name}</span>
                  {item.published_at && (
                    <>
                      <span aria-hidden>·</span>
                      <TimeAgo value={item.published_at} />
                    </>
                  )}
                </p>
                {text && (
                  <p className={cn("line-clamp-2 text-body", item.title ? "text-fg" : "text-fg-muted")}>{text}</p>
                )}
              </div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${text ? `“${text}”` : "the article"} on ${item.source_name} (new tab)`}
                  className="-my-1 flex size-10 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="pt-1 text-label text-fg-muted">and {hidden} more</p>}
    </div>
  );
}
