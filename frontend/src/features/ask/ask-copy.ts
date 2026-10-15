/** Words for Ask's states: what to say when the AI can't answer, and forecast volumes. */
import { BotOff, CloudOff, FileWarning, Hourglass, ShieldCheck, type LucideIcon } from "lucide-react";

import type { ForecastSummary } from "@/api/contract";
import type { AiEngine, AiError } from "@/ai/engine";
import { formatCompact } from "@/lib/format";

/** "264K MANA volume", or a plain note when the provider gives none. */
export function volumeText(forecast: Pick<ForecastSummary, "volume" | "volume_unit">, locale?: string): string {
  if (forecast.volume === null) return "Volume not reported";
  const unit = forecast.volume_unit ? ` ${forecast.volume_unit}` : "";
  return `${formatCompact(forecast.volume, locale)}${unit} volume`;
}

export interface ProblemCopy {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Label for the retry button; null when asking again can't help today. */
  retry: string | null;
}

/** What to tell the viewer for each way the AI can fail. */
export function aiProblemCopy(kind: AiError["kind"], engine: AiEngine["kind"] | null, message: string): ProblemCopy {
  switch (kind) {
    case "unavailable":
      return {
        icon: BotOff,
        title: "AI answers aren't available here",
        description:
          engine === "artifact"
            ? `${message} In the test link, Ask uses your Claude account while the app is open.`
            : engine === "api"
              ? `${message} On the website, Ask uses WorldGraph AI; in the test link, it uses your Claude account.`
              : "Ask needs AI: the test link uses your Claude account, and the website uses WorldGraph AI. Neither is available in this view.",
        retry: "Try again",
      };
    case "declined":
      return {
        icon: ShieldCheck,
        title: "Claude isn't allowed for this page",
        description: "Ask uses your Claude account. Allow it when claude.ai asks, then ask again.",
        retry: "Ask again",
      };
    case "budget":
      return {
        icon: Hourglass,
        title: "Today's AI allowance is used up",
        description: "WorldGraph AI has a daily limit. It resets at midnight UTC.",
        retry: null,
      };
    case "rate_limited":
      return {
        icon: Hourglass,
        title: "The AI is busy right now",
        description: message,
        retry: "Try again",
      };
    case "invalid":
      return {
        icon: FileWarning,
        title: "The answer didn't check out",
        description: "The reply couldn't be matched to WorldGraph's data. Asking again usually works.",
        retry: "Try again",
      };
    default:
      return {
        icon: CloudOff,
        title: "The answer didn't arrive",
        description: message,
        retry: "Try again",
      };
  }
}
