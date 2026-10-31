import { CircleDot, Database, ShieldCheck, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { analysisStatusText, useAnalysisStatus } from "@/ai/analysis-runner";
import { useConnection, useRpc } from "@/api/client";
import { approveWaitingCalls, useConnectorApproval } from "@/api/sources/connector";
import { useSnapshot } from "@/api/sources/static";
import { reasonText, snapshotText } from "@/app/snapshot-text";
import { useIsDesktop } from "@/lib/hooks";
import { freshnessText } from "@/lib/status-freshness";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

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
function PillButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
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
 * One quiet line: where the data comes from, how fresh it is, and what the
 * AI is doing. It also carries the one control the connector may need:
 * approving live data.
 *
 * On the globe on wider screens it floats at the bottom left, where the
 * globe's layout leaves room for it. Everywhere else (other screens, and
 * phones) it sits in the header instead (`placement="header"`), where it
 * can't cover a list row on the screens that scroll. Exactly one of the two
 * placements renders.
 */
export function StatusBar({ placement = "float" }: { placement?: "float" | "header" }) {
  const isDesktop = useIsDesktop();
  const onGlobe = useNav((s) => s.view === "globe");
  const floats = isDesktop && onGlobe;
  if ((placement === "float") !== floats) return null;
  return <StatusPill placement={placement} wide={isDesktop} />;
}

function StatusPill({ placement, wide }: { placement: "float" | "header"; wide: boolean }) {
  const state = useConnection((s) => s.state);
  const meta = useRpc("meta", {});
  const waiting = useConnectorApproval((s) => s.waiting.length);
  const asking = useConnectorApproval((s) => s.asking);
  const analysis = useAnalysisStatus((s) => s.status);
  const stop = useAnalysisStatus((s) => s.stop);
  const now = useNow();
  const sample = useSettings((s) => s.sample);
  const sampleOn = sample === "on";
  const snapshotKind = useSnapshot((s) => s.kind);
  const snapshotAsOf = useSnapshot((s) => s.asOf);

  // meta answers for the "auto" setting (it takes no `sample`): with Sample
  // data off, nothing invented is shown even while there is no live news.
  const showingSample = sample !== "off" && (meta.data?.data.showing_sample ?? false);
  const snapshot = snapshotText(snapshotKind, snapshotAsOf, now);
  let data = { long: "Connecting…", short: "Connecting…" };
  if (meta.isPlaceholderData) {
    // The first frame is the bundled snapshot (a sample one only with Sample data on).
    data =
      snapshotKind === "live"
        ? { long: `${snapshot.long} · connecting…`, short: snapshot.short }
        : { long: "Saved sample · connecting to live data…", short: "Connecting…" };
  }
  let tone: "ok" | "warn" | "muted" = "muted";
  if (state.status === "live") {
    data = showingSample
      ? { long: "Sample data", short: "Sample" }
      : sampleOn
        ? // Sample data switched on beside live news: say so, not just "Live".
          { long: "Live data with sample data", short: "Live + sample" }
        : { long: "Live data", short: "Live" };
    tone = showingSample ? "muted" : "ok";
  } else if (state.status === "snapshot") {
    data = { long: `${snapshot.long} · ${reasonText(state.reason)}`, short: snapshot.short };
    tone = "warn";
  } else if (state.status === "disconnected") {
    // Nothing stands in for live data here: say so plainly (each screen offers its retry).
    data = { long: `Live data isn't connected · ${reasonText(state.reason)}`, short: "Not connected" };
    tone = "warn";
  } else if (state.status === "error") {
    data = { long: state.reason.message, short: "Data unavailable" };
    tone = "warn";
  }

  const fresh =
    state.status === "live" && !showingSample ? freshnessText(meta.data?.data.last_ingest_at, now) : null;
  const ai = analysisStatusText(analysis);
  const needsApproval = waiting > 0 || asking;

  // In the phone header: short words only, and while something needs the
  // viewer (approval, or a Stop button) that alone, so it stays readable.
  const compact = placement === "header";
  const showData = !(compact && (needsApproval || analysis.phase === "running"));
  const text = (t: { long: string; short: string }) =>
    compact ? <span className="truncate">{t.short}</span> : <Responsive {...t} />;

  return (
    <div
      className={
        placement === "float"
          ? "pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-24px)]"
          : "flex min-w-0"
      }
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-full border border-line px-2.5 py-1 text-label text-fg-muted",
          placement === "float" ? "bg-glass shadow-panel backdrop-blur" : "bg-surface",
        )}
        title={data.long}
      >
        {showData && (
          <span role="status" className="flex min-w-0 items-center gap-1.5">
            {/* Neutral colours only: teal and amber mean opportunity and risk in this app. */}
            {tone === "warn" ? (
              <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-fg" />
            ) : tone === "ok" ? (
              <CircleDot aria-hidden className="size-3.5 shrink-0 text-fg" />
            ) : (
              <Database aria-hidden className="size-3.5 shrink-0" />
            )}
            {text(data)}
          </span>
        )}

        {fresh && !needsApproval && (
          // With AI news beside it, the freshness note only shows on wider screens. In the
          // desktop header it shares the row with the screen names: only where they leave room.
          <span
            className={cn(
              "shrink-0 items-center gap-2",
              placement === "header" && wide
                ? ai
                  ? "hidden xl:flex"
                  : "hidden lg:flex"
                : ai
                  ? "hidden md:flex"
                  : "flex",
            )}
          >
            <Divider />
            <span className="tabular text-fg-subtle">{text(fresh)}</span>
          </span>
        )}

        {needsApproval && (
          <>
            {showData && <Divider />}
            <span role="status" className="flex min-w-0 items-center gap-1.5 text-fg">
              <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
              {text({
                long: asking ? "Waiting for your answer in Claude…" : "Live data needs your approval",
                short: asking ? "Waiting…" : "Needs approval",
              })}
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
            {showData && <Divider />}
            <span role="status" className="flex min-w-0 items-center gap-1.5">
              <Sparkles
                aria-hidden
                className={cn("size-3.5 shrink-0", analysis.phase === "running" && "animate-pulse text-fg")}
              />
              {text(compact && analysis.phase === "running" ? { long: ai.long, short: "Analysing…" } : ai)}
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
