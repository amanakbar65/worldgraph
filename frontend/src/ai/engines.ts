/**
 * The two real AI engines, picked once per copy of the app:
 *
 * - Test link (claude.ai Artifact): the viewer's own Claude account through
 *   the `sample` capability. One user turn: the shared prompt, then the data.
 * - Website: POST /api/ai, a Netlify function that calls the Claude API with
 *   a daily spending cap (frontend/netlify/functions/ai.mts).
 *
 * Neither retries: a failed call rejects once with an AiError and the caller
 * decides (usually: tell the viewer and keep the control).
 */
import { AiError, type AiEngine, type AiOptions, type AiTask } from "./engine";
import { PROMPTS } from "./prompts";
import { capability, TARGET } from "@/platform/runtime";

/**
 * Which Claude answers each task on the viewer's account. All three need
 * careful reasoning over the data (word limits, causal links, citations),
 * so they use the balanced model rather than the quick one.
 */
export const MODEL_TIER: Record<AiTask, Claude.sample.ModelTier> = {
  analysis: "default",
  ask: "default",
  projection: "default",
};

/** The platform's input cap for one `sample` call (256 KiB of text). */
const MAX_PROMPT_BYTES = 262_144;

/** The one user turn the artifact engine sends: instructions, then the data. */
export function buildPrompt(task: AiTask, input: unknown): string {
  return `${PROMPTS[task]}\n\n## Data\n\n${JSON.stringify(input)}`;
}

function isSampleError(error: unknown): error is Claude.sample.SampleError {
  return (
    typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
  );
}

/** Turn the `sample` capability's error codes into the app's AiError kinds. */
export function sampleErrorToAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (!isSampleError(error)) return new AiError("failed", "Claude didn't answer. Try again later.");
  switch (error.code) {
    case "cancelled":
      return new AiError("cancelled", "Stopped.");
    case "not_granted":
      return new AiError("declined", "Claude isn't allowed for this page.");
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
    case "images_unavailable":
    case "tools_unavailable":
      return new AiError("unavailable", "Claude isn't available here.");
    case "session_expired":
      return new AiError("unavailable", "Sign in to Claude again to use AI.");
    case "rate_limited":
      return new AiError("rate_limited", "Claude is busy or your usage limit is reached. Try again later.");
    case "invalid_json":
    case "empty_completion":
      return new AiError("invalid", "Claude's answer couldn't be read.");
    case "refused":
      return new AiError("failed", "Claude declined this request.");
    case "prompt_too_large":
      return new AiError("failed", "Too much data for one request.");
    case "invalid_request":
    case "transform_error":
    case "queue_overflow":
    case "image_rejected":
      return new AiError("failed", "The request couldn't be sent.");
    default:
      return new AiError("failed", "Claude didn't answer. Try again later.");
  }
}

/** The test link's engine: Claude on the viewer's own account. */
export function artifactEngine(sample: typeof Claude.sample): AiEngine {
  return {
    kind: "artifact",
    label: "Your Claude account",
    async complete(task: AiTask, input: unknown, options: AiOptions = {}) {
      const prompt = buildPrompt(task, input);
      if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES) {
        throw new AiError("failed", "Too much data for one request.");
      }
      try {
        return await sample.json(prompt, { modelTier: MODEL_TIER[task], signal: options.signal });
      } catch (error) {
        throw sampleErrorToAiError(error);
      }
    },
  };
}

/** What POST /api/ai answers. */
interface AiHttpBody {
  data?: unknown;
  error?: string;
}

/** The website's engine: the WorldGraph AI function (Claude API, daily cap). */
export function httpEngine(endpoint = "/api/ai", fetchImpl: typeof fetch = (...a) => fetch(...a)): AiEngine {
  return {
    kind: "api",
    label: "WorldGraph AI",
    async complete(task: AiTask, input: unknown, options: AiOptions = {}) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, input }),
          signal: options.signal,
        });
      } catch (error) {
        if ((error as Error | undefined)?.name === "AbortError") throw new AiError("cancelled", "Stopped.");
        throw new AiError("unavailable", "Couldn't reach WorldGraph AI. Check your connection.");
      }
      const body = (await response.json().catch(() => null)) as AiHttpBody | null;
      if (response.ok && body && body.data !== undefined && !body.error) return body.data;
      throw httpStatusToAiError(response.status, body?.error);
    },
  };
}

export function httpStatusToAiError(status: number, message?: string): AiError {
  if (status === 402)
    return new AiError("budget", "Today's AI allowance is used up. It resets at midnight UTC.");
  if (status === 429) return new AiError("rate_limited", "WorldGraph AI is busy. Try again in a minute.");
  if (status === 503 || status === 404 || status === 403) {
    return new AiError("unavailable", message ?? "WorldGraph AI isn't available right now.");
  }
  if (status === 422) return new AiError("invalid", message ?? "The AI answer couldn't be read.");
  return new AiError("failed", message ?? "WorldGraph AI didn't answer. Try again later.");
}

const NONE: AiEngine = {
  kind: "none",
  label: "AI unavailable",
  complete: () => Promise.reject(new AiError("unavailable", "AI isn't available here.")),
};

/** Pick the engine for this copy of the app. Never throws. */
export async function resolveEngine(target: "web" | "artifact" = TARGET): Promise<AiEngine> {
  if (target === "artifact") {
    const sample = await capability("sample");
    return sample ? artifactEngine(sample) : NONE;
  }
  if (target === "web") return httpEngine();
  return NONE;
}
