import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { IDLE_MS, runAnalysis, waitForIdle, type RunnerDeps } from "./analysis-runner";
import { getAiEngine, runAi } from "./engine";
import { AnalysisResult } from "./schemas";
import { dataSource, useConnection } from "@/api/client";
import { invalidateConnectorCache } from "@/api/sources/connector";
import { capability, TARGET } from "@/platform/runtime";

/** Only the owner (or an editor) spends their Claude usage on shared analysis. */
async function viewerMayAnalyse(): Promise<boolean> {
  const user = await capability("user");
  if (!user) return false;
  const [owner, editor] = await Promise.all([user.isOwner(), user.canEdit()]);
  return owner || editor;
}

/**
 * Starts on-use analysis once per visit in the test link: after live data
 * has loaded and the viewer has been idle for a few seconds. Renders nothing;
 * progress shows in the status bar.
 */
export function AnalysisAutoRun() {
  const queryClient = useQueryClient();
  const live = useConnection((s) => s.state.status === "live");

  useEffect(() => {
    if (TARGET !== "artifact" || !live) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (!(await viewerMayAnalyse())) return;
        const engine = await getAiEngine();
        if (engine.kind !== "artifact" || controller.signal.aborted) return;
        await waitForIdle(IDLE_MS, controller.signal);
      } catch {
        return; // aborted (unmounted) or no viewer: nothing to do
      }
      const deps: RunnerDeps = {
        pending: (limit, signal) => dataSource.call("pending_analysis", { limit }, { signal, fresh: true }),
        analyse: (input, signal) => runAi("analysis", input, AnalysisResult, { signal }),
        save: (args) => dataSource.call("save_analysis", args, { fresh: true }),
        refresh: async () => {
          await invalidateConnectorCache();
          await queryClient.invalidateQueries({ queryKey: ["rpc"] });
        },
      };
      await runAnalysis(deps);
    })();
    return () => controller.abort();
  }, [live, queryClient]);

  return null;
}
