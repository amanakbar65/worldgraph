/**
 * "Why is this here?" (Phase A3, kg.provenance): where a node, a link or a
 * cause-and-effect link comes from. How sure we are and how it is known,
 * the sources to cite (name, link, one-sentence snippet, date), and who
 * added it when, in plain words. Opened from an entity page, a chosen graph
 * link, an entity's connections and globe arc cards; Back returns there.
 */
import { FileSearch } from "lucide-react";
import { useId } from "react";

import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useFlag } from "@/lib/flags";

import { ProvenanceBody } from "./ProvenanceDetails";
import { provenanceArgs, TARGET_WORDS, WHY, type WhyPanelState } from "./provenance-data";

export default function WhyPanel({ panel }: { panel: WhyPanelState }) {
  const on = useFlag("kg.provenance");
  const meta = useRpc("meta", {});
  const query = useRpc("provenance", provenanceArgs(panel), { enabled: on });
  const headingId = useId();

  if (!on) {
    if (meta.isPending) return <WhySkeleton />;
    return (
      <div className="p-4">
        <EmptyState
          icon={FileSearch}
          title="Sources aren't shown here yet"
          description="This data doesn't say where each item comes from."
        />
      </div>
    );
  }
  if (query.isPending) return <WhySkeleton />;
  if (!query.data) {
    return (
      <div className="p-4">
        <ErrorState error={query.error ?? new Error("Not found")} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const data = query.data;
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-5 p-4 pb-8">
      <header className="flex flex-col gap-2">
        <h2 id={headingId} className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-label font-medium text-fg-muted">
            <FileSearch aria-hidden className="size-3.5" />
            {WHY}
          </span>{" "}
          <span className="text-body font-semibold break-words text-fg">{data.title}</span>
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
          <span>{TARGET_WORDS[data.target]}</span>
          {data.is_sample && <SampleBadge />}
        </p>
      </header>
      <ProvenanceBody data={data} />
    </article>
  );
}

function WhySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading where this comes from" className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <SkeletonText lines={4} />
    </div>
  );
}
