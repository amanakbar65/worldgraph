/**
 * The Ask conversation: one thread of questions and answers that lives in
 * memory while the app is open (closing and reopening the panel keeps it; a
 * reload or "New chat" starts afresh).
 *
 * Each turn goes searching (api.ask_context, fetched by the panel through
 * useRpc) → thinking (one AI call) → done, or stops (the viewer pressed
 * Stop) or fails. A follow-up carries the thread's earlier answered turns
 * (the last few, trimmed) so "what about India?" reads against the question
 * before it, and searches with that question's words too. What the thread
 * is about (a region or story Ask was opened from) stays with it and goes
 * with every turn. The AI runs only on an explicit ask: a send, a
 * suggestion, a follow-up or "Try again".
 */
import { create } from "zustand";

import type { AskContextResponse } from "@/api/contract";
import { AiError, runAi } from "@/ai/engine";
import { trimHistory, type AiTurn } from "@/ai/history";
import { AskAnswer } from "@/ai/schemas";

import {
  aboutForAi,
  answerText,
  compactContext,
  isEmptyContext,
  notEnoughEvidence,
  searchText,
  shapeAnswer,
  type AskAbout,
  type ShapedAnswer,
} from "./ask-data";

export type AskPhase = "searching" | "thinking" | "done" | "stopped" | "failed";

export type AskFailure =
  { source: "data"; error: Error } | { source: "ai"; kind: AiError["kind"]; message: string };

export interface AskTurn {
  id: number;
  question: string;
  /** The sample setting when it was asked (api.ask_context's `sample`). */
  sample: boolean | undefined;
  askedAt: number;
  /** What the thread was about when this was asked (null: nothing in particular). */
  about: AskAbout | null;
  /** What api.ask_context searched for: the question, plus what a follow-up leans on and `about`. */
  search: string;
  /** The earlier turns sent to the AI with it (fixed when asked, so "Try again" sends the same). */
  history: AiTurn[];
  phase: AskPhase;
  context: AskContextResponse | null;
  answer: ShapedAnswer | null;
  failure: AskFailure | null;
}

/** The thread keeps this many turns (the oldest go first); the AI sees only the last few. */
export const MAX_TURNS_KEPT = 40;

interface AskState {
  /** The conversation, oldest first. */
  turns: AskTurn[];
  /** What the conversation is about: the node id Ask was last opened about, or null. */
  scope: string | null;
  /** The unsent question, kept while the panel is closed. */
  draft: string;
  setDraft: (draft: string) => void;
  setScope: (scope: string | null) => void;
  /** Ask a question in the thread; returns its turn id. */
  submit: (question: string, sample: boolean | undefined, about: AskAbout | null) => number;
  /** Start again: an empty thread about `scope` (where the panel was opened from). */
  newChat: (scope: string | null) => void;
  receiveContext: (id: number, context: AskContextResponse) => void;
  failContext: (id: number, error: Error) => void;
  stop: (id: number) => void;
  retry: (id: number) => void;
}

const controllers = new Map<number, AbortController>();
let nextId = 1;

const isRunning = (t: AskTurn) => t.phase === "searching" || t.phase === "thinking";

/** The earlier turns a new question carries: answered ones only, the last few, trimmed. */
export function historyFor(turns: readonly AskTurn[]): AiTurn[] {
  return trimHistory(
    turns.flatMap((t) =>
      t.phase === "done" && t.answer ? [{ question: t.question, answer: answerText(t.answer) }] : [],
    ),
  );
}

/** The question a follow-up leans on: the last one asked, as the AI read it when it said. */
function previousQuestion(turns: readonly AskTurn[]): string | null {
  const last = turns.at(-1);
  return last ? (last.answer?.readAs ?? last.question) : null;
}

export const useAsk = create<AskState>((set, get) => {
  const patch = (id: number, change: Partial<AskTurn>) =>
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
  const find = (id: number) => get().turns.find((t) => t.id === id);

  return {
    turns: [],
    scope: null,
    draft: "",

    setDraft: (draft) => set({ draft }),
    setScope: (scope) => set({ scope }),

    submit: (question, sample, about) => {
      // One question at a time: a new one stops any that is still running.
      for (const t of get().turns) if (isRunning(t)) get().stop(t.id);
      const turns = get().turns;
      const id = nextId++;
      const turn: AskTurn = {
        id,
        question,
        sample,
        askedAt: Date.now(),
        about,
        search: searchText(question, previousQuestion(turns), about),
        history: historyFor(turns),
        phase: "searching",
        context: null,
        answer: null,
        failure: null,
      };
      set({ turns: [...turns, turn].slice(-MAX_TURNS_KEPT) });
      return id;
    },

    newChat: (scope) => {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      set({ turns: [], scope, draft: "" });
    },

    receiveContext: (id, context) => {
      const turn = find(id);
      if (!turn || turn.phase !== "searching") return;
      if (isEmptyContext(context)) {
        patch(id, { phase: "done", context, answer: notEnoughEvidence() });
        return;
      }
      patch(id, { phase: "thinking", context });
      const controller = new AbortController();
      controllers.set(id, controller);
      const asked = get()
        .turns.filter((t) => t.id < id)
        .map((t) => t.question);
      const input = {
        question: turn.question,
        about: aboutForAi(turn.about),
        context: compactContext(context),
      };
      runAi("ask", input, AskAnswer, { signal: controller.signal, history: turn.history })
        .then((raw) => {
          if (find(id)?.phase !== "thinking" || controller.signal.aborted) return;
          patch(id, { phase: "done", answer: shapeAnswer(raw, context, turn.question, asked) });
        })
        .catch((error: unknown) => {
          if (find(id)?.phase !== "thinking") return;
          const ai =
            error instanceof AiError ? error : new AiError("failed", "The answer didn't arrive. Try again.");
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
      const turn = find(id);
      if (!turn || !isRunning(turn)) return;
      patch(id, { phase: "stopped" });
      controllers.get(id)?.abort();
      controllers.delete(id);
    },

    retry: (id) => {
      const turn = find(id);
      // One question at a time: no retry while any turn is running.
      if (!turn || get().turns.some(isRunning)) return;
      // Only this turn runs again, with the history it was first asked with.
      // A stored context is reused (it's cached); the AI is asked again.
      patch(id, { phase: "searching", answer: null, failure: null, askedAt: Date.now() });
      if (turn.context && turn.failure?.source !== "data") get().receiveContext(id, turn.context);
    },
  };
});

/** The turn that is searching or thinking, if any. */
export const runningTurn = (s: { turns: AskTurn[] }): AskTurn | null => s.turns.find(isRunning) ?? null;

export const __testing = {
  reset: () => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    nextId = 1;
    useAsk.setState({ turns: [], scope: null, draft: "" });
  },
};
