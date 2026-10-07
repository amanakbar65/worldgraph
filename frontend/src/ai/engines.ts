/**
 * Engine selection. Placeholder: the AI build step replaces this with the
 * artifact (`sample`) and website (/api/ai) engines.
 */
import { AiError, type AiEngine } from "./engine";

export async function resolveEngine(): Promise<AiEngine> {
  return {
    kind: "none",
    label: "AI unavailable",
    complete: () => Promise.reject(new AiError("unavailable", "AI isn't available here.")),
  };
}
