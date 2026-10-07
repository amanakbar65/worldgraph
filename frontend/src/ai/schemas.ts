/**
 * What each AI task must return, checked after every call (the model's reply
 * is untrusted until it passes). Mirrors prompts/*.schema.json plus the word
 * limits from CLAUDE.md. Analysis output is AnalysisItem in api/contract.ts.
 */
import { z } from "zod";

import { AnalysisItem, Direction, Impact, SectorId } from "@/api/contract";

const words = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .refine((s) => {
      const n = s.split(/\s+/).filter(Boolean).length;
      return n >= min && n <= max;
    }, `must be ${min}–${max} words`);

const StoryId = z.string().regex(/^story:[a-z0-9][a-z0-9.-]*$/);

export const AnalysisResult = z.object({
  items: z.array(z.unknown()), // validated one by one with AnalysisItem, so one bad item can't sink the rest
  skipped: z.array(z.object({ id: z.string(), reason: z.string().max(200) })).default([]),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
export { AnalysisItem };

export const AskAnswer = z.object({
  status: z.enum(["answered", "not_enough_evidence"]),
  bullets: z.array(z.object({ text: words(30), cite: z.array(StoryId).min(1).max(6) })).max(3),
  cascade: z.array(z.object({ from: StoryId, to: StoryId, mechanism: words(4, 2) })).max(4),
  forecasts: z.array(z.string().regex(/^forecast:[a-z0-9][a-z0-9.-]*$/)).max(2),
  follow_up: z.array(words(10)).max(3),
});
export type AskAnswer = z.infer<typeof AskAnswer>;

export const ProjectedEffect = z.object({
  headline: words(12),
  so_what: words(20),
  impact: Impact,
  direction: Direction,
  sectors: z.array(SectorId).min(1).max(2),
  region_id: z.string().regex(/^region:[a-z0-9][a-z0-9.-]*$/).nullable(),
  mechanism: words(4, 2),
  lag_days: z.number().int().min(0).max(3650),
  confidence: z.number().min(0).max(0.5),
});
export const ProjectionResult = z.object({ effects: z.array(ProjectedEffect).max(3) });
export type ProjectedEffect = z.infer<typeof ProjectedEffect>;
export type ProjectionResult = z.infer<typeof ProjectionResult>;
