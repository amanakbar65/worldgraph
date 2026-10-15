import { useEffect, useState } from "react";

import { getAiEngine, type AiEngine } from "@/ai/engine";

/** The AI engine for this copy of the app; null while it is being worked out. */
export function useAiEngine(): AiEngine | null {
  const [engine, setEngine] = useState<AiEngine | null>(null);
  useEffect(() => {
    let alive = true;
    void getAiEngine().then((e) => {
      if (alive) setEngine(e);
    });
    return () => {
      alive = false;
    };
  }, []);
  return engine;
}

/** What using the AI costs the viewer, in one short line. */
export function aiCostText(kind: AiEngine["kind"]): string {
  switch (kind) {
    case "artifact":
      return "Uses your Claude account while the app is open";
    case "api":
      return "WorldGraph AI, daily limit";
    default:
      return "Not available here";
  }
}
