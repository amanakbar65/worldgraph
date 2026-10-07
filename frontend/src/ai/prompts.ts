/**
 * The shared AI instructions (repo-root prompts/), bundled as text. The same
 * files drive the website's Claude API calls, so both engines behave alike.
 */
import analysis from "../../../prompts/analysis.md?raw";
import ask from "../../../prompts/ask.md?raw";
import projection from "../../../prompts/projection.md?raw";

import type { AiTask } from "./engine";

export const PROMPTS: Record<AiTask, string> = { analysis, ask, projection };
