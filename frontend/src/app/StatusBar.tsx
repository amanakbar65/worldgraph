import { CircleDot, Database, ShieldCheck, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { analysisStatusText, useAnalysisStatus } from "@/ai/analysis-runner";
import { useConnection, useRpc } from "@/api/client";
import { approveWaitingCalls, useConnectorApproval } from "@/api/sources/connector";
import { freshnessText } from "@/lib/status-freshness";
import { cn } from "@/lib/utils";

/** Full text on wider screens, a shorter one on phones. */
function Responsive({ long, short }: { long: string; short: string }) {
  if (long === short) return <span className="truncate">{long}</span>;
  return (
    <>
      <span className="truncate sm:hidden">{short}</span>
      <span className="hidden truncate sm:inline">{long}</span>
    </>
  );
}

function Divider() {
  return <span aria-hidden className="h-3.5 w-px shrink-0 bg-line-strong" />;
}

/**
 * A small button inside the status pill. It looks compact but its hit area
 * is at least 40 px tall (the ::before layer), so it's easy to tap.
 */
function PillButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="pointer-events-auto relative -my-0.5 flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-label font-medium text-fg transition-colors before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:bg-surface"
    >
      {children}
    </button>
  );
}

/** Re-render every 30 s so "Updated 4 min ago" stays true. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * One quiet line at the bottom: where the data comes from, how fresh it is,
 * and what the AI is doing. It also carries the one control the connector
 * may need: approving live data.
 */
export function StatusBar() {
  const state = useConnection((s) => s.state);
  const meta = useRpc("meta", {});
  const waiting = useConnectorApproval((s) => s.waiting.length);
  const asking = useConnectorApproval((s) => s.asking);
  const analysis = useAnalysisStatus((s) => s.status);
  const stop = useAnalysisStatus((s) => s.stop);
  const now = useNow();

  const showingSample = meta.data?.data.showing_sample ?? false;
  let data = { long: "Connecting…", short: "Connecting…" };
  let tone: "ok" | "warn" | "muted" = "muted";
  if (state.status === "live") {
    data = showingSample ? { long: "Sample data", short: "Sample" } : { long: "Live data", short: "Live" };
    tone = showingSample ? "muted" : "ok";
  } else if (state.status === "snapshot") {
    data = { long: `Sample snapshot · ${state.reason.message}`, short: "Sample snapshot" };
    tone = "warn";
  } else if (state.status === "error") {
    data = { long: state.reason.message, short: "Data unavailable" };
    tone = "warn";
  }

  const fresh = state.status === "live" && !showingSample ? freshnessText(meta.data?.data.last_ingest_at, now) : null;
  const ai = analysisStatusText(analysis);
  const needsApproval = waiting > 0 || asking;

  return (
    <div className="pointer-events-none absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] left-3 z-10 flex max-w-[calc(100%-24px)] md:bottom-3">
      <div
        className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-glass px-2.5 py-1 text-label text-fg-muted shadow-panel backdrop-blur"
        title={data.long}
      >
        <span role="status" className="flex min-w-0 items-center gap-1.5">
          {tone === "warn" ? (
            <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-risk" />
          ) : tone === "ok" ? (
            <CircleDot aria-hidden className={cn("size-3.5 shrink-0 text-opportunity")} />
          ) : (
            <Database aria-hidden className="size-3.5 shrink-0" />
          )}
          <Responsive {...data} />
        </span>

        {fresh && !ai && !needsApproval && (
          <>
            <Divider />
            <span className="tabular shrink-0 text-fg-subtle">
              <Responsive {...fresh} />
            </span>
          </>
        )}

        {needsApproval && (
          <>
            <Divider />
            <span role="status" className="flex min-w-0 items-center gap-1.5 text-fg">
              <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
              <Responsive
                long={asking ? "Waiting for your answer in Claude…" : "Live data needs your approval"}
                short={asking ? "Waiting…" : "Needs approval"}
              />
            </span>
            {!asking && (
              <PillButton onClick={() => void approveWaitingCalls()} label="Allow live data from Supabase">
                Allow
              </PillButton>
            )}
          </>
        )}

        {ai && !needsApproval && (
          <>
            <Divider />
            <span role="status" className="flex min-w-0 items-center gap-1.5">
              <Sparkles
                aria-hidden
                className={cn("size-3.5 shrink-0", analysis.phase === "running" && "animate-pulse text-fg")}
              />
              <Responsive {...ai} />
            </span>
            {analysis.phase === "running" && (
              <PillButton onClick={stop} label="Stop analysing stories">
                <Square aria-hidden className="size-2.5 fill-current" />
                Stop
              </PillButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
