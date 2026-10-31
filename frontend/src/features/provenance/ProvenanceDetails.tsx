/**
 * Where something comes from (api.provenance): how sure we are and how it is
 * known, the sources to cite, and who added it when, in plain words. The
 * "Why is this here?" sheet is made of these parts, and the cascade's
 * evidence drawer adds the facts at its foot. Facts, inferences and
 * forecasts stay apart: the kind of link is always said.
 */
import { ExternalLink, FileSearch, History } from "lucide-react";
import { useId } from "react";

import type { ProvenanceResponse } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ConfidenceMeter, LinkTypeLabel } from "@/components/ConfidenceMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { SourcesList } from "@/components/SourcesList";
import { Skeleton } from "@/components/ui/skeleton";
import { WeakMark } from "@/components/WeakMark";
import { confidenceWords } from "@/features/story/cascade-style";
import { useFlag } from "@/lib/flags";
import { safeHttpUrl } from "@/lib/links";
import { WEAK_CONFIDENCE } from "@/lib/meaning";
import { formatDate, formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { addedByWho, isLinkKind, KIND_WORDS, originSource, provenanceSources, updatedSinceAdded } from "./provenance-data";

/** At most this many sources are listed (the rest are counted). */
const SOURCE_LIMIT = 6;

/** Why it wears the "?" mark, in one line. */
function weakReason(data: Pick<ProvenanceResponse, "confidence" | "sources">): string {
  if (data.sources.length === 0) return "Nothing to cite yet: read it as a lead, not a fact.";
  if (data.confidence !== null && data.confidence < WEAK_CONFIDENCE) return "Under 50% sure: read it as a lead, not a fact.";
  return "Under 50% sure, or no source: read it as a lead, not a fact.";
}

/** How sure, and how it is known: the confidence, the kind (as the cascade draws it) and the "?" when weak. */
export function ProvenanceTrust({ data }: { data: ProvenanceResponse }) {
  const kind = KIND_WORDS[data.kind];
  return (
    <section aria-label="How sure" className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/30 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {data.confidence !== null ? (
          <span className="inline-flex items-center gap-2">
            <ConfidenceMeter confidence={data.confidence} hideValue />
            <span className="text-label text-fg">{confidenceWords(data.confidence)}</span>
          </span>
        ) : (
          <span className="text-label text-fg-muted">No confidence given</span>
        )}
        <span aria-hidden className="h-3 w-px bg-line-strong" />
        {/* Links are drawn by their kind (solid, dashed, dotted): show that line; items just say it. */}
        {data.target !== "node" && isLinkKind(data.kind) ? (
          <LinkTypeLabel linkType={data.kind} />
        ) : (
          <span className="text-label text-fg-muted">{kind.label}</span>
        )}
      </div>
      <p className="text-body text-fg-muted">{kind.description}</p>
      {data.weak && (
        <p className="flex items-start gap-1.5 text-label text-fg-muted">
          <WeakMark className="mt-px" />
          {weakReason(data)}
        </p>
      )}
    </section>
  );
}

/** The sources to cite: name, a link when there is one, the one-sentence snippet and the date. */
export function ProvenanceSources({ data }: { data: ProvenanceResponse }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionHeader as="h3" id={id} title="Sources" icon={FileSearch} count={data.sources.length} />
      {data.sources.length > 0 ? (
        <SourcesList items={provenanceSources(data)} sample={data.is_sample} limit={SOURCE_LIMIT} />
      ) : (
        <p className="text-body text-fg-muted">
          {data.kind === "projected" || data.kind === "conditional"
            ? "No source yet: this is a possible effect, not something that has happened."
            : "Nothing to cite yet."}
        </p>
      )}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-label text-fg-muted sm:w-24">{term}</dt>
      <dd className="min-w-0 text-label text-fg">{children}</dd>
    </div>
  );
}

function When({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatDate(value)}
    </time>
  );
}

/** Who added it, from which source, and when (and when it last changed). */
export function ProvenanceFacts({ data, className }: { data: ProvenanceResponse; className?: string }) {
  const origin = originSource(data);
  const url = data.is_sample ? null : safeHttpUrl(origin?.url);
  return (
    <dl className={cn("flex flex-col gap-2", className)}>
      <Fact term="Added by">{addedByWho(data.added_by)}</Fact>
      {origin && (
        <Fact term="From">
          <span className="flex flex-col gap-0.5">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
              >
                {origin.name}
                <ExternalLink aria-hidden className="size-3" />
                <span className="sr-only">(new tab)</span>
              </a>
            ) : (
              <span className="font-medium">{origin.name}</span>
            )}
            {origin.attribution && <span className="text-fg-muted">{origin.attribution}</span>}
          </span>
        </Fact>
      )}
      <Fact term="Added">
        <When value={data.created_at} />
      </Fact>
      {updatedSinceAdded(data) && (
        <Fact term="Last changed">
          <When value={data.updated_at} />
        </Fact>
      )}
    </dl>
  );
}

/** The sheet's body: trust, sources, then who added it. */
export function ProvenanceBody({ data }: { data: ProvenanceResponse }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-5">
      <ProvenanceTrust data={data} />
      <ProvenanceSources data={data} />
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <SectionHeader as="h3" id={id} title="Added" icon={History} />
        <ProvenanceFacts data={data} />
      </section>
    </div>
  );
}

/**
 * For the cascade's evidence: who added a saved cause-and-effect link and
 * when (kg.provenance). The evidence above already lists its sources.
 */
export function CausalLinkOrigin({ linkId, className }: { linkId: number; className?: string }) {
  const on = useFlag("kg.provenance");
  const id = useId();
  const query = useRpc("provenance", { target: "link", id: linkId }, { enabled: on });
  if (!on || query.isError) return null;
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <SectionHeader as="h4" id={id} title="Added" icon={History} />
      {query.data ? (
        <ProvenanceFacts data={query.data} />
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading who added it" className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/3" />
        </div>
      )}
    </section>
  );
}
