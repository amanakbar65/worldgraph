import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __testing,
  ARTIFACT_MODEL_LABEL,
  analysisStatusText,
  BATCH_SIZE,
  compact,
  MAX_BATCHES,
  runAnalysis,
  useAnalysisStatus,
  validateBatch,
  waitForIdle,
  type RunnerDeps,
} from "./analysis-runner";
import { AiError } from "./engine";
import type { PendingAnalysisResponse, StorySummary } from "@/api/contract";

type Pending = PendingAnalysisResponse["items"][number];

const candidate = (id: string): StorySummary => ({
  id,
  kind: "event",
  headline: "Shipping lines avoid the Red Sea",
  so_what: "Longer routes raise freight costs.",
  event_type: "disruption",
  impact: "risk",
  direction: "up",
  magnitude: 3,
  horizon: "weeks",
  confidence: 0.7,
  importance: 60,
  sectors: ["logistics-trade"],
  first_seen: "2026-10-01T00:00:00Z",
  region: { id: "region:ye", name: "Yemen", subtype: "country", country_id: null },
  lon: 45,
  lat: 15,
  source_count: 3,
  analysed: true,
  is_sample: false,
});

const pending = (n: number): Pending => ({
  id: `story:p${n}`,
  titles: Array.from({ length: 10 }, (_, i) => `Title ${n}.${i}`),
  snippets: Array.from({ length: 7 }, (_, i) => `Snippet ${i}.`),
  sources: ["Reuters", "AP"],
  first_seen: "2026-10-08T06:00:00Z",
  region: { id: "region:in", name: "India", subtype: "country", country_id: null },
  event_type: "policy",
  sectors: ["energy"],
  entities: [{ id: "commodity:crude-oil", type: "commodity", subtype: null, name: "Crude oil" }],
  candidates: [candidate("story:c1")],
});

const analysed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  headline: "India cuts fuel tax to ease prices",
  so_what: "Lower pump prices help transport and consumer businesses.",
  event_type: "policy-decision",
  impact: "opportunity",
  direction: "down",
  magnitude: 3,
  horizon: "weeks",
  confidence: 0.7,
  sectors: ["energy"],
  actions: ["Review fuel surcharges with carriers"],
  entities: ["commodity:crude-oil"],
  links: [
    {
      from: "story:c1",
      link_type: "inferred",
      mechanism: "higher crude prices",
      direction: "up",
      confidence: 0.5,
      evidence: "Crude rose after the shipping disruption.",
    },
  ],
  ...extra,
});

/** A database with `total` waiting stories; saving removes them from the queue. */
function fakeDeps(total: number, analyse: RunnerDeps["analyse"]) {
  let queue = Array.from({ length: total }, (_, i) => pending(i + 1));
  const deps = {
    pending: vi.fn(async (limit: number) => ({ items: queue.slice(0, limit), total_pending: queue.length })),
    analyse: vi.fn(analyse),
    save: vi.fn(async (args: Parameters<RunnerDeps["save"]>[0]) => {
      const done = new Set([...args.items.map((i) => i.id), ...(args.skipped ?? []).map((s) => s.id)]);
      queue = queue.filter((q) => !done.has(q.id));
      return { saved: args.items.length, skipped: args.skipped?.length ?? 0, rejected: [], links_saved: 0 };
    }),
    refresh: vi.fn(async () => {}),
    today: () => "2026-10-08",
  };
  return deps;
}

/** Analyse every item in the batch correctly. */
const analyseAll: RunnerDeps["analyse"] = async (input) => ({
  items: input.items.map((i) => analysed(i.id)),
  skipped: [],
});

beforeEach(() => __testing.reset());

describe("compact", () => {
  it("keeps only what the model needs, like the pipeline", () => {
    const c = compact(pending(1));
    expect(c.titles).toHaveLength(8);
    expect(c.snippets).toHaveLength(5);
    expect(c.region).toBe("India");
    expect(c.guess).toEqual({ event_type: "policy", sectors: ["energy"] });
    expect(c.entities).toEqual([{ id: "commodity:crude-oil", name: "Crude oil" }]);
    expect(c.candidates[0]).toEqual({
      id: "story:c1",
      headline: "Shipping lines avoid the Red Sea",
      so_what: "Longer routes raise freight costs.",
      region: "Yemen",
      first_seen: "2026-10-01T00:00:00Z",
    });
  });
});

describe("validateBatch", () => {
  const batch = [pending(1), pending(2), pending(3)];

  it("drops invalid items, foreign ids and duplicates", () => {
    const result = validateBatch(
      {
        items: [
          analysed("story:p1"),
          analysed("story:p2", {
            headline: "This headline is far too long to be a WorldGraph headline at all ok",
          }),
          analysed("story:zz"), // not in this batch
          analysed("story:p1"), // duplicate
          { id: "story:p3" }, // incomplete
        ],
        skipped: [],
      },
      batch,
    );
    expect(result.items.map((i) => i.id)).toEqual(["story:p1"]);
    expect(result.dropped).toBe(4);
  });

  it("keeps entity ids and causes only from what the batch offered", () => {
    const result = validateBatch(
      {
        items: [
          analysed("story:p1", {
            entities: ["commodity:crude-oil", "organization:made-up"],
            links: [
              {
                from: "story:c1",
                link_type: "reported",
                mechanism: "higher crude prices",
                direction: "up",
                confidence: 0.6,
                evidence: "Said so.",
              },
              {
                from: "story:nope",
                link_type: "inferred",
                mechanism: "made up link",
                direction: "up",
                confidence: 0.4,
                evidence: "No.",
              },
            ],
          }),
        ],
        skipped: [],
      },
      batch,
    );
    expect(result.items[0].entities).toEqual(["commodity:crude-oil"]);
    expect(result.items[0].links.map((l) => l.from)).toEqual(["story:c1"]);
  });

  it("keeps skips for this batch only, with short reasons", () => {
    const result = validateBatch(
      {
        items: [analysed("story:p1")],
        skipped: [
          { id: "story:p1", reason: "also analysed" },
          { id: "story:p2", reason: "  " },
          { id: "story:p3", reason: "x".repeat(150) },
          { id: "story:other", reason: "sport" },
        ],
      },
      batch,
    );
    expect(result.skipped).toEqual([
      { id: "story:p2", reason: "not business news" },
      { id: "story:p3", reason: "x".repeat(120) },
    ]);
  });
});

describe("runAnalysis", () => {
  it("analyses batches of 6, saves them and refreshes the screens", async () => {
    const deps = fakeDeps(10, analyseAll);
    const status = await runAnalysis(deps);
    expect(status).toEqual({ phase: "done", analysed: 10, skipped: 0 });
    expect(deps.analyse).toHaveBeenCalledTimes(2);
    const firstInput = deps.analyse.mock.calls[0][0];
    expect(firstInput.today).toBe("2026-10-08");
    expect(firstInput.items).toHaveLength(BATCH_SIZE);
    expect(deps.save.mock.calls[0][0]).toMatchObject({ engine: "artifact", model: ARTIFACT_MODEL_LABEL });
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    expect(useAnalysisStatus.getState().status).toEqual(status);
  });

  it("stops after three batches per visit and runs once per visit", async () => {
    const deps = fakeDeps(40, analyseAll);
    const status = await runAnalysis(deps);
    expect(deps.analyse).toHaveBeenCalledTimes(MAX_BATCHES);
    expect(status).toEqual({ phase: "done", analysed: 18, skipped: 0 });
    await runAnalysis(deps);
    expect(deps.analyse).toHaveBeenCalledTimes(MAX_BATCHES);
  });

  it("does nothing visible when no stories are waiting", async () => {
    const deps = fakeDeps(0, analyseAll);
    const status = await runAnalysis(deps);
    expect(deps.analyse).not.toHaveBeenCalled();
    expect(analysisStatusText(status)).toBeNull();
  });

  it("saves only valid items and moves on past answers it couldn't use", async () => {
    const deps = fakeDeps(8, async (input) => ({
      items: input.items.map((i, n) => (n === 0 ? { id: i.id, headline: "" } : analysed(i.id))),
      skipped: [],
    }));
    const status = await runAnalysis(deps);
    const saved = deps.save.mock.calls[0][0];
    expect(saved.items).toHaveLength(5);
    expect(saved.items.every((i) => i.id !== "story:p1")).toBe(true);
    // The dropped story stays pending; the next batch asks for more and skips it.
    expect(deps.pending.mock.calls[1][0]).toBeGreaterThan(BATCH_SIZE);
    expect(deps.analyse.mock.calls[1][0].items.map((i) => i.id)).toEqual(["story:p7", "story:p8"]);
    expect(status).toMatchObject({ phase: "done", analysed: 6 }); // the first of each batch is unusable
  });

  it("stops on any AI error and saves nothing more", async () => {
    const deps = fakeDeps(20, async () => {
      throw new AiError("rate_limited", "busy");
    });
    const status = await runAnalysis(deps);
    expect(status).toEqual({ phase: "error", message: "Claude is busy", analysed: 0 });
    expect(deps.analyse).toHaveBeenCalledTimes(1);
    expect(deps.save).not.toHaveBeenCalled();
    expect(analysisStatusText(status)?.long).toBe("Analysis paused: Claude is busy");
  });

  it("remembers a declined answer for the visit", async () => {
    const deps = fakeDeps(20, async () => {
      throw new AiError("declined", "no");
    });
    expect(await runAnalysis(deps)).toEqual({ phase: "declined" });
    expect(analysisStatusText({ phase: "declined" })).toBeNull();
    await runAnalysis(deps);
    expect(deps.analyse).toHaveBeenCalledTimes(1);
  });

  it("stops when the viewer taps Stop", async () => {
    const deps = fakeDeps(20, (_input, signal) => {
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new AiError("cancelled", "Stopped."))),
      );
    });
    const run = runAnalysis(deps);
    await vi.waitFor(() => expect(useAnalysisStatus.getState().status.phase).toBe("running"));
    expect(analysisStatusText(useAnalysisStatus.getState().status)).toEqual({
      long: "Analysing 6 new stories with your Claude account…",
      short: "Analysing 6 new stories…",
    });
    useAnalysisStatus.getState().stop();
    expect(await run).toEqual({ phase: "stopped", analysed: 0 });
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("reports a database failure without retrying", async () => {
    const deps = fakeDeps(6, analyseAll);
    deps.save.mockRejectedValueOnce(new Error("offline"));
    const status = await runAnalysis(deps);
    expect(status).toMatchObject({ phase: "error", analysed: 0 });
    expect(deps.save).toHaveBeenCalledTimes(1);
  });
});

describe("analysisStatusText", () => {
  it("says how many stories were analysed", () => {
    expect(analysisStatusText({ phase: "done", analysed: 12, skipped: 1 })?.long).toBe("12 stories analysed");
    expect(analysisStatusText({ phase: "done", analysed: 1, skipped: 0 })?.long).toBe("1 story analysed");
    expect(analysisStatusText({ phase: "done", analysed: 0, skipped: 3 })?.long).toBe("New stories checked");
    expect(analysisStatusText({ phase: "idle" })).toBeNull();
  });
});

describe("waitForIdle", () => {
  afterEach(() => vi.useRealTimers());

  it("waits until nobody has touched the page for a while", async () => {
    vi.useFakeTimers();
    let done = false;
    void waitForIdle(4000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3000);
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const wait = waitForIdle(4000, controller.signal);
    controller.abort();
    await expect(wait).rejects.toMatchObject({ name: "AbortError" });
  });
});
