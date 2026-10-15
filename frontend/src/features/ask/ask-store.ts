/**
 * This visit's questions and how each one is going. Lives in memory only:
 * a reload starts afresh. Each question goes searching (api.ask_context,
 * fetched by the panel through useRpc) → thinking (one AI call) → done,
 * or stops (the viewer pressed Stop) or fails. The AI runs only on an
 * explicit ask: a submit, a suggestion, a follow-up or "Try again".
 */
import { create } from "zustand";

import type { AskContextResponse } from "@/api/contract";
import { AiError, runAi } from "@/ai/engine";
import { AskAnswer } from "@/ai/schemas";

import { compactContext, isEmptyContext, notEnoughEvidence, shapeAnswer, type ShapedAnswer } from "./ask-data";

export type AskPhase = "searching" | "thinking" | "done" | "stopped" | "failed";

export type AskFailure =
  | { source: "data"; error: Error }
  | { source: "ai"; kind: AiError["kind"]; message: string };

export interface AskEntry {
  id: number;
  question: string;
  /** The sample setting when it was asked (api.ask_context's `sample`). */
  sample: boolean | undefined;
  askedAt: number;
  phase: AskPhase;
  context: AskContextResponse | null;
  answer: ShapedAnswer | null;
  failure: AskFailure | null;
}

/** How many questions this visit keeps. */
export const MAX_HISTORY = 8;

interface AskState {
  /** Oldest first. */
  entries: AskEntry[];
  /** Which entry each opening of the panel shows (keyed by its q and scope). */
  shown: Record<string, number | null>;
  submit: (question: string, sample: boolean | undefined, panelKey: string) => number;
  show: (panelKey: string, id: number | null) => void;
  receiveContext: (id: number, context: AskContextResponse) => void;
  failContext: (id: number, error: Error) => void;
  stop: (id: number) => void;
  retry: (id: number) => void;
}

const controllers = new Map<number, AbortController>();
let nextId = 1;

export const useAsk = create<AskState>((set, get) => {
  const patch = (id: number, change: Partial<AskEntry>) =>
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...change } : e)) }));
  const find = (id: number) => get().entries.find((e) => e.id === id);

  return {
    entries: [],
    shown: {},

    submit: (question, sample, panelKey) => {
      // One question at a time: a new one stops any that is still running.
      for (const e of get().entries) if (e.phase === "searching" || e.phase === "thinking") get().stop(e.id);
      const id = nextId++;
      const entry: AskEntry = {
        id,
        question,
        sample,
        askedAt: Date.now(),
        phase: "searching",
        context: null,
        answer: null,
        failure: null,
      };
      set((s) => {
        const entries = [...s.entries, entry].slice(-MAX_HISTORY);
        return { entries, shown: { ...s.shown, [panelKey]: id } };
      });
      return id;
    },

    show: (panelKey, id) => set((s) => ({ shown: { ...s.shown, [panelKey]: id } })),

    receiveContext: (id, context) => {
      const entry = find(id);
      if (!entry || entry.phase !== "searching") return;
      if (isEmptyContext(context)) {
        patch(id, { phase: "done", context, answer: notEnoughEvidence() });
        return;
      }
      patch(id, { phase: "thinking", context });
      const controller = new AbortController();
      controllers.set(id, controller);
      runAi("ask", { question: entry.question, context: compactContext(context) }, AskAnswer, {
        signal: controller.signal,
      })
        .then((raw) => {
          if (find(id)?.phase !== "thinking" || controller.signal.aborted) return;
          patch(id, { phase: "done", answer: shapeAnswer(raw, context, entry.question) });
        })
        .catch((error: unknown) => {
          if (find(id)?.phase !== "thinking") return;
          const ai = error instanceof AiError ? error : new AiError("failed", "The answer didn't arrive. Try again.");
          if (ai.kind === "cancelled") patch(id, { phase: "stopped" });
          else patch(id, { phase: "failed", failure: { source: "ai", kind: ai.kind, message: ai.message } });
        })
        .finally(() => {
          if (controllers.get(id) === controller) controllers.delete(id);
        });
    },

    failContext: (id, error) => {
      if (find(id)?.phase !== "searching") return;
      patch(id, { phase: "failed", failure: { source: "data", error } });
    },

    stop: (id) => {
      const entry = find(id);
      if (!entry || (entry.phase !== "searching" && entry.phase !== "thinking")) return;
      patch(id, { phase: "stopped" });
      controllers.get(id)?.abort();
      controllers.delete(id);
    },

    retry: (id) => {
      const entry = find(id);
      if (!entry || entry.phase === "searching" || entry.phase === "thinking") return;
      // A stored context is reused (it's cached); the AI is asked again.
      patch(id, { phase: "searching", answer: null, failure: null, askedAt: Date.now() });
      if (entry.context && entry.failure?.source !== "data") get().receiveContext(id, entry.context);
    },
  };
});

/** The key that tells openings of the Ask panel apart. */
export function panelKeyOf(q: string | undefined, scope: string | undefined): string {
  return `${q ?? ""}|${scope ?? ""}`;
}

export const __testing = {
  reset: () => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    nextId = 1;
    useAsk.setState({ entries: [], shown: {} });
  },
};
