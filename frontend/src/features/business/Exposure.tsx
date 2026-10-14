import { Target } from "lucide-react";
import { useId } from "react";

import type { Profile } from "@/api/contract";
import { SectionHeader } from "@/components/SectionHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { SECTORS } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { ROLE_INFO } from "@/state/profile";

import { ImpactCountsInline, ImpactSplitBar, TypeIcon } from "./business-parts";
import { describeImpactCounts, exposure, quietCount, sectorOfNode, type AffectsItem } from "./business-data";

const LIMIT = 6;

/**
 * Where the news reaches your business: one row per part of the profile the
 * feed touches, with its risk and opportunity stories. Tapping a row narrows
 * the feed to it.
 */
export function Exposure({
  items,
  profile,
  loading,
  selected,
  onSelect,
}: {
  items: readonly AffectsItem[] | undefined;
  profile: Profile;
  loading: boolean;
  selected: string | null;
  onSelect: (id: string | null, name: string | null) => void;
}) {
  const headingId = useId();
  const rows = exposure(items ?? [], profile);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const quiet = quietCount(rows, profile);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <SectionHeader id={headingId} title="Where it reaches you" icon={Target} description="Tap one to see only its stories." />
      {loading ? (
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3 py-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-body text-fg-muted">No part of your business is in the news right now.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, LIMIT).map((row) => {
            const sector = sectorOfNode(row.entity.id);
            const name = sector ? SECTORS[sector].label : row.entity.name;
            const role = row.roles[0];
            const on = selected === row.entity.id;
            const SectorIcon = sector ? SECTORS[sector].icon : null;
            return (
              <li key={row.entity.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${name}${role ? `, ${ROLE_INFO[role].phrase}` : ""}: ${row.total} ${row.total === 1 ? "story" : "stories"}, ${describeImpactCounts(row)}.`}
                  onClick={() => onSelect(on ? null : row.entity.id, on ? null : name)}
                  className={cn(
                    "-mx-2 flex min-h-12 w-[calc(100%+1rem)] cursor-pointer flex-col justify-center gap-1.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2/70",
                    on && "bg-surface-2 outline-1 outline-line-strong",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {SectorIcon ? (
                      <SectorIcon aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    ) : (
                      <TypeIcon type={row.entity.type} />
                    )}
                    <span className="truncate text-body font-medium text-fg">{name}</span>
                    {role && <span className="shrink-0 text-label text-fg-subtle">{ROLE_INFO[role].short}</span>}
                    <ImpactCountsInline counts={row} className="ml-auto shrink-0" />
                  </span>
                  <ImpactSplitBar counts={row} scale={max > 0 ? row.total / max : 0} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && (rows.length > LIMIT || quiet > 0) && (
        <p className="text-label text-fg-muted">
          {[
            rows.length > LIMIT ? `${rows.length - LIMIT} more in the feed` : null,
            quiet > 0 ? `${quiet} ${quiet === 1 ? "part" : "parts"} of your profile quiet for now` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
