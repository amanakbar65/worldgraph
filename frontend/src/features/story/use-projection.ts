/**
 * "Project next effects": asks the AI for up to three possible next effects
 * of the story. Runs only when the viewer taps the button (in the test link
 * it uses their own Claude account), never retries on its own, and saves
 * nothing: the projections live in this panel until it closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { RegionRef } from "@/api/contract";
import { AiError, getAiEngine, runAi, type AiEngine } from "@/ai/engine";
import { ProjectionResult, type ProjectedEffect } from "@/ai/schemas";

export type ProjectionStatus =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; effects: ProjectedEffect[]; regions: RegionRef[] }
  | { phase: "error"; kind: AiError["kind"]; message: string };

export interface EngineInfo {
  kind: AiEngine["kind"];
  label: string;
  /** Why AI can't run here, when it can't. */
  reason: string | null;
}

export function useProjection() {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [status, setStatus] = useState<ProjectionStatus>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    // Only finds out which engine this copy of the app has; costs nothing.
    void getAiEngine().then((e) => {
      if (live) setEngine({ kind: e.kind, label: e.label, reason: e.kind === "none" ? "AI isn't available here." : null });
    });
    return () => {
      live = false;
      controller.current?.abort();
    };
  }, []);

  const run = useCallback(async (input: unknown, regions: RegionRef[]) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStatus({ phase: "running" });
    try {
      const result = await runAi("projection", input, ProjectionResult, { signal: current.signal });
      if (current.signal.aborted) return;
      setStatus({ phase: "done", effects: result.effects.slice(0, 3), regions });
    } catch (error) {
      if (current.signal.aborted) return;
      const e = error instanceof AiError ? error : new AiError("failed", "The AI didn't answer. Try again later.");
      if (e.kind === "cancelled") {
        setStatus({ phase: "idle" });
        return;
      }
      if (e.kind === "unavailable") {
        setEngine((prev) => ({ kind: "none", label: prev?.label ?? "AI", reason: e.message }));
      }
      setStatus({ phase: "error", kind: e.kind, message: e.message });
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setStatus({ phase: "idle" });
  }, []);

  const clear = useCallback(() => setStatus({ phase: "idle" }), []);

  return { engine, status, run, stop, clear };
}
