/**
 * AI for the app, behind one small interface.
 *
 * - Test link (claude.ai Artifact): the viewer's own Claude account through
 *   the `sample` capability, only while the app is open.
 * - Website: POST /api/ai (a Netlify function using the Claude API, with a
 *   daily spending cap).
 * - Neither available: kind "none"; features that need AI hide or explain.
 *
 * Every reply is parsed as JSON and validated with a zod schema before use.
 */
import type { z } from "zod";

export type AiTask = "analysis" | "ask" | "projection";

export interface AiOptions {
  signal?: AbortSignal;
}

export interface AiEngine {
  readonly kind: "artifact" | "api" | "none";
  /** Shown to people, e.g. "Your Claude account" or "WorldGraph AI". */
  readonly label: string;
  /** Run one task; resolves with the parsed (not yet validated) JSON reply. */
  complete(task: AiTask, input: unknown, options?: AiOptions): Promise<unknown>;
}

/** Why an AI call didn't produce a usable answer. Branch on `kind`. */
export class AiError extends Error {
  constructor(
    readonly kind: "unavailable" | "declined" | "budget" | "rate_limited" | "invalid" | "cancelled" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const NONE: AiEngine = {
  kind: "none",
  label: "AI unavailable",
  complete: () => Promise.reject(new AiError("unavailable", "AI isn't available here.")),
};

let enginePromise: Promise<AiEngine> | null = null;

/** The engine for this copy of the app (resolved once). */
export function getAiEngine(): Promise<AiEngine> {
  enginePromise ??= import("./engines").then((m) => m.resolveEngine()).catch(() => NONE);
  return enginePromise;
}

/** Run a task and validate the reply; throws AiError("invalid") when it doesn't fit. */
export async function runAi<S extends z.ZodType>(
  task: AiTask,
  input: unknown,
  schema: S,
  options?: AiOptions,
): Promise<z.infer<S>> {
  const engine = await getAiEngine();
  const raw = await engine.complete(task, input, options);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid", "The AI reply didn't have the expected shape.");
  return parsed.data;
}

export const __testing = { NONE, reset: () => (enginePromise = null) };
