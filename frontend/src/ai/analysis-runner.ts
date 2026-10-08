/**
 * On-use analysis (test link only): while the owner has the app open, turn
 * waiting news drafts into story cards with their own Claude account, and
 * save the results for everyone.
 *
 * Rules (PLAN.md "AI"):
 * - only inside claude.ai, only for the owner or an editor;
 * - starts after the app has loaded and the viewer has been idle a moment;
 * - batches of 6, at most 3 per visit, one at a time, never from a loop of
 *   retries: any AI error stops the run, and "declined" is remembered for
 *   the visit;
 * - every item is checked against AnalysisItem before it is saved (the
 *   database checks again).
 *
 * The website does the same work in the pipeline (backend/.../analysis.py),
 * so this runner is off there.
 */
import { create } from "zustand";

import { AiError } from "./engine";
import { AnalysisItem, AnalysisResult } from "./schemas";
import type { PendingAnalysisResponse, RpcArgs, SaveAnalysisResponse } from "@/api/contract";

export const BATCH_SIZE = 6;
export const MAX_BATCHES = 3;
export const IDLE_MS = 4_000;
/** How the test link's analyses are labelled in the database. */
export const ARTIFACT_MODEL_LABEL = "claude (your account)";

type PendingItem = PendingAnalysisResponse["items"][number];
type SaveArgs = RpcArgs["save_analysis"];

export type AnalysisStatus =
  | { phase: "idle" }
  | { phase: "running"; count: number; batch: number; analysed: number }
  | { phase: "done"; analysed: number; skipped: number }
  | { phase: "stopped"; analysed: number }
  | { phase: "declined" }
  | { phase: "error"; message: string; analysed: number };

interface RunnerState {
  status: AnalysisStatus;
  /** Stops the run in progress (the Stop button). */
  stop: () => void;
}

export const useAnalysisStatus = create<RunnerState>(() => ({ status: { phase: "idle" }, stop: () => {} }));

/** What the runner needs from the rest of the app (injected, so it can be tested). */
export interface RunnerDeps {
  pending: (limit: number, signal: AbortSignal) => Promise<PendingAnalysisResponse>;
  analyse: (input: { today: string; items: CompactItem[] }, signal: AbortSignal) => Promise<AnalysisResult>;
  save: (args: SaveArgs) => Promise<SaveAnalysisResponse>;
  /** Called after each successful save: drop cached reads so screens refresh. */
  refresh: () => Promise<void> | void;
  today?: () => string;
}

/** Only what the model needs (mirrors compact() in pipeline/analysis.py). */
export interface CompactItem {
  id: string;
  titles: string[];
  snippets: string[];
  sources: string[];
  first_seen: string;
  region: string | null;
  guess: { event_type: string; sectors: string[] };
  entities: { id: string; name: string }[];
  candidates: {
    id: string;
    headline: string;
    so_what: string | null;
    region: string | null;
    first_seen: string | null;
  }[];
}

export function compact(item: PendingItem): CompactItem {
  return {
    id: item.id,
    titles: item.titles.slice(0, 8),
    snippets: item.snippets.slice(0, 5),
    sources: item.sources.slice(0, 8),
    first_seen: item.first_seen,
    region: item.region?.name ?? null,
    guess: { event_type: item.event_type, sectors: item.sectors },
    entities: item.entities.map((e) => ({ id: e.id, name: e.name })),
    candidates: item.candidates.map((c) => ({
      id: c.id,
      headline: c.headline,
      so_what: c.so_what,
      region: c.region?.name ?? null,
      first_seen: c.first_seen,
    })),
  };
}

/**
 * Keep only the answers we can trust: items for stories in this batch that
 * pass AnalysisItem, with entity ids and causes limited to what the batch
 * offered; skips for stories in this batch that weren't also analysed.
 */
export function validateBatch(
  raw: AnalysisResult,
  batch: PendingItem[],
): { items: AnalysisItem[]; skipped: { id: string; reason: string }[]; dropped: number } {
  const byId = new Map(batch.map((b) => [b.id, b]));
  const items: AnalysisItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of raw.items) {
    const parsed = AnalysisItem.safeParse(entry);
    const source = parsed.success ? byId.get(parsed.data.id) : undefined;
    if (!parsed.success || !source || seen.has(parsed.data.id)) {
      dropped += 1;
      continue;
    }
    seen.add(source.id);
    const entityIds = new Set(source.entities.map((e) => e.id));
    const candidateIds = new Set(source.candidates.map((c) => c.id));
    items.push({
      ...parsed.data,
      entities: [...new Set(parsed.data.entities)].filter((id) => entityIds.has(id)),
      links: parsed.data.links.filter((l) => candidateIds.has(l.from)),
    });
  }
  const skipped: { id: string; reason: string }[] = [];
  for (const entry of raw.skipped) {
    if (!byId.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    skipped.push({ id: entry.id, reason: (entry.reason.trim() || "not business news").slice(0, 120) });
  }
  return { items, skipped, dropped };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Visit-wide memory: one run per visit, and a "declined" answer sticks. */
const visit = { started: false, declined: false };

/**
 * Run up to MAX_BATCHES batches, one at a time. Resolves with the final
 * status (also published in useAnalysisStatus). Safe to call more than
 * once: only the first call in a visit does anything.
 */
export async function runAnalysis(deps: RunnerDeps): Promise<AnalysisStatus> {
  if (visit.started || visit.declined) return useAnalysisStatus.getState().status;
  visit.started = true;
  const controller = new AbortController();
  const set = (status: AnalysisStatus) => useAnalysisStatus.setState({ status });
  useAnalysisStatus.setState({ stop: () => controller.abort() });

  const attempted = new Set<string>();
  let analysed = 0;
  let skipped = 0;
  let final: AnalysisStatus | null = null;

  try {
    for (let batch = 1; batch <= MAX_BATCHES && !final; batch++) {
      if (controller.signal.aborted) {
        final = { phase: "stopped", analysed };
        break;
      }
      // Ask for a few more than a batch when earlier ones stayed pending (dropped answers).
      const pending = await deps.pending(Math.min(30, BATCH_SIZE + attempted.size), controller.signal);
      const items = pending.items.filter((i) => !attempted.has(i.id)).slice(0, BATCH_SIZE);
      if (items.length === 0) break;
      items.forEach((i) => attempted.add(i.id));
      set({ phase: "running", count: items.length, batch, analysed });

      let raw: AnalysisResult;
      try {
        raw = await deps.analyse({ today: (deps.today ?? todayUtc)(), items: items.map(compact) }, controller.signal);
      } catch (error) {
        final = aiFailure(error, analysed);
        break;
      }
      if (controller.signal.aborted) {
        final = { phase: "stopped", analysed };
        break;
      }

      const checked = validateBatch(raw, items);
      if (checked.items.length === 0 && checked.skipped.length === 0) continue;
      const result = await deps.save({
        engine: "artifact",
        model: ARTIFACT_MODEL_LABEL,
        items: checked.items,
        skipped: checked.skipped,
      });
      analysed += result.saved;
      skipped += result.skipped;
      await deps.refresh();
    }
    final ??= { phase: "done", analysed, skipped };
  } catch {
    // A database call (pending or save) failed: stop with a short note.
    final = controller.signal.aborted
      ? { phase: "stopped", analysed }
      : { phase: "error", message: "the database didn't answer", analysed };
  }
  if (final.phase === "declined") visit.declined = true;
  set(final);
  useAnalysisStatus.setState({ stop: () => {} });
  return final;
}

/** Short reasons for the status line ("Analysis paused: Claude is busy"). */
const AI_FAILURE: Record<AiError["kind"], string> = {
  unavailable: "Claude isn't available here",
  declined: "Claude wasn't allowed",
  budget: "the AI allowance is used up",
  rate_limited: "Claude is busy",
  invalid: "the answer couldn't be read",
  cancelled: "stopped",
  failed: "Claude didn't answer",
};

function aiFailure(error: unknown, analysed: number): AnalysisStatus {
  if (error instanceof AiError) {
    if (error.kind === "declined") return { phase: "declined" };
    if (error.kind === "cancelled") return { phase: "stopped", analysed };
    return { phase: "error", message: AI_FAILURE[error.kind], analysed };
  }
  return { phase: "error", message: AI_FAILURE.failed, analysed };
}

/**
 * Resolve once the page is visible and nobody has touched it for `ms`.
 * Rejects with an AbortError when `signal` aborts.
 */
export function waitForIdle(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, restart, true));
      document.removeEventListener("visibilitychange", restart);
      signal?.removeEventListener("abort", onAbort);
    };
    const restart = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return onAbort();
    events.forEach((e) => window.addEventListener(e, restart, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", restart);
    signal?.addEventListener("abort", onAbort, { once: true });
    restart();
  });
}

/** The one-line text for the status bar, or null when there's nothing to say. */
export function analysisStatusText(status: AnalysisStatus): { long: string; short: string } | null {
  switch (status.phase) {
    case "running": {
      const n = `${status.count} new ${status.count === 1 ? "story" : "stories"}`;
      return { long: `Analysing ${n} with your Claude account…`, short: `Analysing ${n}…` };
    }
    case "done": {
      if (status.analysed > 0) {
        const t = `${status.analysed} ${status.analysed === 1 ? "story" : "stories"} analysed`;
        return { long: t, short: t };
      }
      if (status.skipped > 0) return { long: "New stories checked", short: "Stories checked" };
      return null;
    }
    case "stopped":
      return status.analysed > 0
        ? { long: `Stopped after ${status.analysed} stories`, short: "Analysis stopped" }
        : { long: "Analysis stopped", short: "Analysis stopped" };
    case "error":
      return { long: `Analysis paused: ${status.message}`, short: "Analysis paused" };
    default:
      return null;
  }
}

export const __testing = {
  reset: () => {
    visit.started = false;
    visit.declined = false;
    useAnalysisStatus.setState({ status: { phase: "idle" }, stop: () => {} });
  },
};
