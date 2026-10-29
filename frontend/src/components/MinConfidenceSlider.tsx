import { useEffect, useId, useRef, useState } from "react";

import { minConfidenceWords } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import { MIN_CONFIDENCE, useNav } from "@/state/nav";


/**
 * The one minimum-confidence setting (useNav), as a slider: the graph, the
 * cascade and the globe all read it. The value is written once the slider
 * rests, so the views reload once, not on every step.
 */
export function MinConfidenceSlider({
  label = "Lowest confidence to show",
  delay = 300,
  className,
}: {
  /** The slider's accessible name. */
  label?: string;
  /** How long the slider must rest before the setting changes (ms). */
  delay?: number;
  className?: string;
}) {
  const value = useNav((s) => s.minConfidence);
  const setMinConfidence = useNav((s) => s.setMinConfidence);
  const [draft, setDraft] = useState(Math.round(value * 100));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (next: number) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMinConfidence(next / 100), delay);
  };

  // Changed elsewhere (another view, a link, Reset): follow it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(Math.round(value * 100));
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        id={id}
        type="range"
        min={Math.round(MIN_CONFIDENCE.min * 100)}
        max={Math.round(MIN_CONFIDENCE.max * 100)}
        step={Math.round(MIN_CONFIDENCE.step * 100)}
        value={draft}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={minConfidenceWords(draft)}
        className="h-10 min-w-0 flex-1 cursor-pointer accent-[var(--ring)]"
      />
      <output htmlFor={id} className="w-28 shrink-0 text-right text-label text-fg-muted tabular-nums">
        {minConfidenceWords(draft)}
      </output>
    </div>
  );
}
