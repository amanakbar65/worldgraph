"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleX, Minus, Sparkles, Users } from "lucide-react";

import { formatCompact, formatPointChange, formatProbability } from "@/lib/format";
import { cn } from "@/lib/utils";

type Health = {
  status: string;
  version: string;
  database: {
    status: "ok" | "not_configured" | "unreachable";
    postgis?: string | null;
    pgvector?: string | null;
    schema?: string;
    counts?: { stories?: number; forecasts?: number; entities?: number; sample_nodes?: number };
    hint?: string;
    detail?: string;
  };
};

async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error(`API answered ${response.status}`);
  return response.json();
}

type RowState = "ok" | "warn" | "error" | "loading";

function StatusIcon({ state }: { state: RowState }) {
  if (state === "loading") {
    return <span className="size-5 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden />;
  }
  const Icon = state === "ok" ? CircleCheck : state === "warn" ? CircleAlert : CircleX;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-5 shrink-0",
        state === "ok" && "text-opportunity",
        state === "warn" && "text-risk",
        state === "error" && "text-risk",
      )}
    />
  );
}

function Row({
  label,
  state,
  children,
}: {
  label: string;
  state: RowState;
  children: React.ReactNode;
}) {
  const stateText = {
    ok: "OK",
    warn: "Needs attention",
    error: "Not working",
    loading: "Checking",
  };
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <StatusIcon state={state} />
      <span className="w-28 shrink-0 font-medium">{label}</span>
      <span className="sr-only">{stateText[state]}:</span>
      <span className="min-w-0 text-sm text-muted-foreground">
        {state === "loading" ? (
          <span className="inline-block h-3 w-40 animate-pulse rounded bg-muted align-middle" />
        ) : (
          children
        )}
      </span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 whitespace-nowrap text-foreground">
      {children}
    </code>
  );
}

export function SetupCheck() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 10_000 });
  const db = health.data?.database;
  const counts = db?.counts ?? {};

  const apiState: RowState = health.isPending ? "loading" : health.isError ? "error" : "ok";
  const dbState: RowState = health.isPending
    ? "loading"
    : !db
      ? "error"
      : db.status === "ok" && db.schema === "ready"
        ? "ok"
        : db.status === "unreachable"
          ? "error"
          : "warn";
  const sampleState: RowState = health.isPending
    ? "loading"
    : (counts.stories ?? 0) > 0
      ? "ok"
      : "warn";

  return (
    <section aria-labelledby="setup-heading" className="w-full max-w-xl">
      <h1 id="setup-heading" className="text-2xl font-semibold tracking-tight">
        Setup check
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Phase 0. The globe arrives here in Phase 1.
      </p>

      <ul className="mt-6 divide-y rounded-xl border bg-card" aria-live="polite">
        <Row label="Web app" state="ok">
          Running
        </Row>
        <Row label="API" state={apiState}>
          {health.isError ? (
            <>
              Not reachable. Start it with <Code>uv run wg api</Code>
            </>
          ) : (
            <>Connected · v{health.data?.version}</>
          )}
        </Row>
        <Row label="Database" state={dbState}>
          {!db ? (
            "Unknown until the API is running"
          ) : db.status === "not_configured" ? (
            <>
              Not connected yet. Add <Code>DATABASE_URL</Code> to <Code>.env</Code>
            </>
          ) : db.status === "unreachable" ? (
            <>Can&apos;t reach it. Check DATABASE_URL, or wake the Supabase project</>
          ) : db.schema !== "ready" ? (
            <>
              Connected. Now run <Code>uv run wg db migrate</Code>
            </>
          ) : (
            <>
              Connected · PostGIS {db.postgis} · pgvector {db.pgvector}
            </>
          )}
        </Row>
        <Row label="Sample data" state={sampleState}>
          {(counts.stories ?? 0) > 0 ? (
            <span className="tabular">
              {formatCompact(counts.stories ?? 0)} stories · {formatCompact(counts.forecasts ?? 0)}{" "}
              forecasts · {formatCompact(counts.entities ?? 0)} entities
            </span>
          ) : (
            <>
              Not loaded yet. Run <Code>uv run wg seed load</Code>
            </>
          )}
        </Row>
      </ul>

      <h2 className="mt-10 text-sm font-medium text-muted-foreground">Design language</h2>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        <li className="flex items-center gap-1.5 rounded-full bg-risk/12 px-3 py-1 text-risk">
          <CircleAlert aria-hidden className="size-4" /> Risk ▲
        </li>
        <li className="flex items-center gap-1.5 rounded-full bg-opportunity/12 px-3 py-1 text-opportunity">
          <Sparkles aria-hidden className="size-4" /> Opportunity ▲
        </li>
        <li className="flex items-center gap-1.5 rounded-full bg-neutral/12 px-3 py-1 text-neutral">
          <Minus aria-hidden className="size-4" /> Neutral
        </li>
        <li className="flex items-center gap-1.5 rounded-full border border-forecast/40 px-3 py-1 text-forecast">
          <Users aria-hidden className="size-4" /> Crowd forecast{" "}
          <span className="tabular font-semibold">{formatProbability(0.62)}</span>
          <span className="tabular">{formatPointChange(0.08)}</span>
        </li>
      </ul>
    </section>
  );
}
