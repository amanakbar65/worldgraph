import { ArrowUp, MessageCircleQuestion, SquarePen, Sparkles, Square, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Profile, type SectorId } from "@/api/contract";
import { useRpc } from "@/api/client";
import type { AiEngine } from "@/ai/engine";
import { EntityChip } from "@/components/EntityChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/lib/hooks";
import { useUserValue } from "@/platform/storage";
import { useNav, type Panel } from "@/state/nav";
import { sampleArg, useCalm, useSettings } from "@/state/settings";

import {
  aboutFrom,
  CONTEXT_LIMIT,
  MAX_QUESTION,
  cleanQuestion,
  isAskable,
  mainTopic,
  suggestionsFor,
  type AskScope,
} from "./ask-data";
import { AnswerSection, QuestionList } from "./ask-parts";
import { runningTurn, useAsk, type AskTurn } from "./ask-store";
import { AboutDivider, TurnView } from "./ask-thread";
import { useAiEngine } from "./use-ai-engine";

type AskPanelProps = { panel: Extract<Panel, { kind: "ask" }> };

/**
 * Ask, as a conversation: the viewer's questions and WorldGraph's answers in
 * one scrolling thread, with the message box fixed at the bottom. Answers
 * come only from what WorldGraph has stored (api.ask_context), with sources;
 * a follow-up carries the last few turns so "what about India?" reads
 * against the question before it. The thread stays while the app is open
 * (closing the panel keeps it); "New chat" clears it. Opened about a region
 * or story, the thread keeps that subject, shown as a chip at the top. The
 * AI runs only when the viewer sends (it uses their Claude account in the
 * test link). A deep link with a question only fills the box.
 */
export default function AskPanel({ panel }: AskPanelProps) {
  return (
    <AskChat key={`${panel.q ?? ""}|${panel.scope ?? ""}`} q={panel.q} openedScope={panel.scope ?? null} />
  );
}

function AskChat({ q, openedScope }: { q?: string; openedScope: string | null }) {
  const sample = sampleArg(useSettings((s) => s.sample));
  const turns = useAsk((s) => s.turns);
  const scope = useAsk((s) => s.scope);
  const draft = useAsk((s) => s.draft);
  const running = useAsk(runningTurn);
  const { submit, stop, setDraft, setScope, newChat } = useAsk.getState();
  const engine = useAiEngine();
  const isDesktop = useIsDesktop();
  const calm = useCalm();

  // Opened about something: the conversation is about it from now on. A
  // question in the link only fills the box.
  useEffect(() => {
    if (openedScope && useAsk.getState().scope !== openedScope) useAsk.getState().setScope(openedScope);
    if (q) useAsk.getState().setDraft(q.slice(0, MAX_QUESTION));
  }, [openedScope, q]);

  const scopeInfo = useScopeInfo(scope);
  const about = useMemo(() => (scopeInfo.info ? aboutFrom(scopeInfo.info) : null), [scopeInfo.info]);

  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visibleHeight = useVisibleHeight(rootRef, !isDesktop);

  // --- Keeping the newest message in view -----------------------------------
  const sent = useRef<number | null>(null);
  const last = turns.at(-1);
  const lastKey = last ? `${last.id}:${last.phase}` : "";
  // Reopened: the latest messages show, as in any chat.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, []);
  useEffect(() => {
    const log = logRef.current;
    if (!log || !last) return;
    const behavior: ScrollBehavior = calm ? "auto" : "smooth";
    if (sent.current === last.id && last.phase === "searching") {
      // Just sent: the question and its "Searching…" line show at the bottom.
      sent.current = null;
      scrollLog(log, log.scrollHeight, behavior);
      return;
    }
    if (last.phase === "searching" || last.phase === "thinking") return;
    // The answer arrived: bring its start into view, unless the viewer has scrolled up to read.
    const el = log.querySelector<HTMLElement>(`[data-turn="${last.id}"]`);
    if (!el) return;
    const logBox = log.getBoundingClientRect();
    const top = el.getBoundingClientRect().top - logBox.top;
    if (top < logBox.height - 48) scrollLog(log, log.scrollTop + top - 12, behavior);
    // Only the newest turn's change matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  // --- Sending ---------------------------------------------------------------
  const ask = useCallback(
    (text: string) => {
      const question = cleanQuestion(text);
      if (!isAskable(question) || runningTurn(useAsk.getState())) return;
      sent.current = submit(question, sample, about);
      setDraft("");
      // Desktop: ready for the next question. Phones: no keyboard popping up for a tapped suggestion.
      if (isDesktop) inputRef.current?.focus();
    },
    [submit, setDraft, sample, about, isDesktop],
  );

  const startOver = () => {
    newChat(openedScope);
    if (isDesktop) inputRef.current?.focus();
    else headingRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col"
      style={visibleHeight ? { height: visibleHeight } : undefined}
    >
      {/* Searching runs here, so it carries on while the thread scrolls. */}
      {turns
        .filter((t) => t.phase === "searching")
        .map((t) => (
          <ContextFetcher key={t.id} turn={t} />
        ))}

      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 pt-3 pb-2.5">
        <div className="flex min-h-10 items-center gap-3">
          <span
            aria-hidden
            className="hidden size-9 shrink-0 md:flex items-center justify-center rounded-xl border border-line-strong bg-surface-2"
          >
            <MessageCircleQuestion className="size-4.5 text-fg" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 ref={headingRef} tabIndex={-1} className="text-body font-semibold text-fg outline-none">
              Ask WorldGraph
            </h2>
            <p className="hidden text-label text-fg-muted md:block">Answers only from stored stories, with sources.</p>
          </div>
          {turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={startOver} className="h-10 shrink-0">
              <SquarePen aria-hidden />
              New chat
            </Button>
          )}
        </div>
        {scope && (
          <ScopeChip
            id={scope}
            info={scopeInfo.info}
            loading={scopeInfo.loading}
            onClear={() => setScope(null)}
          />
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {turns.length === 0 ? (
          <Suggestions scope={scopeInfo.info} loading={scopeInfo.loading} onAsk={ask} />
        ) : (
          turns.map((turn, i) => (
            <div key={turn.id} className="flex flex-col gap-4">
              {changedSubject(turns[i - 1], turn) && <AboutDivider about={turn.about} />}
              <TurnView
                turn={turn}
                latest={i === turns.length - 1}
                busy={running !== null}
                engine={engine}
                onAsk={ask}
              />
            </div>
          ))
        )}
      </div>

      <Composer
        inputRef={inputRef}
        draft={draft}
        onDraft={setDraft}
        onSend={() => ask(draft)}
        onStop={running ? () => stop(running.id) : null}
        followUp={turns.length > 0}
        engine={engine}
        autoFocus={isDesktop}
      />
    </div>
  );
}

function scrollLog(log: HTMLElement, top: number, behavior: ScrollBehavior) {
  if (typeof log.scrollTo === "function") log.scrollTo({ top, behavior });
  else log.scrollTop = top;
}

/** A divider goes where the subject changes (and above a first question about something). */
function changedSubject(prev: AskTurn | undefined, turn: AskTurn): boolean {
  if (!prev) return turn.about !== null;
  return (prev.about?.id ?? null) !== (turn.about?.id ?? null);
}

// ---------------------------------------------------------------------------
// The message box
// ---------------------------------------------------------------------------

function Composer({
  inputRef,
  draft,
  onDraft,
  onSend,
  onStop,
  followUp,
  engine,
  autoFocus,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  /** Set while an answer is being written: the send button becomes Stop. */
  onStop: (() => void) | null;
  followUp: boolean;
  engine: AiEngine | null;
  autoFocus: boolean;
}) {
  const inputId = useId();
  const noteId = useId();

  // Grow with the text, up to about five lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, inputRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line; Enter that confirms an IME composition is left alone.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!onStop) onSend();
  };

  return (
    <form
      className="shrink-0 border-t border-line px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom,0px),0.625rem)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!onStop) onSend();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Your question
      </label>
      <div className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-bg-sunken/70 py-1 pr-1 pl-3.5 transition-colors hover:border-fg-subtle/60 has-[textarea:focus]:outline-2 has-[textarea:focus]:outline-offset-2 has-[textarea:focus]:outline-ring">
        <textarea
          ref={inputRef}
          id={inputId}
          rows={1}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_QUESTION}
          placeholder={followUp ? "Ask a follow-up…" : "How does X affect Y?"}
          autoComplete="off"
          enterKeyHint="send"
          // Desktop: ready to type (or to send a question passed in, with one Enter).
          // Phones: no keyboard popping up over the sheet.
          autoFocus={autoFocus}
          aria-describedby={noteId}
          className="max-h-[140px] min-h-10 flex-1 resize-none bg-transparent py-2 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-none"
        />
        {onStop ? (
          <Button type="button" size="icon" aria-label="Stop the answer" onClick={onStop}>
            <Square aria-hidden className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send" disabled={!isAskable(draft)}>
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>
      <p id={noteId} className="mt-1.5 min-h-4 px-1 text-label text-fg-subtle">
        {engineNote(engine)}
        <span className="sr-only"> Enter sends; Shift+Enter adds a new line.</span>
      </p>
    </form>
  );
}

/** One line under the box: what asking uses. */
function engineNote(engine: AiEngine | null): string {
  if (!engine) return "";
  switch (engine.kind) {
    case "artifact":
      return "Uses your Claude account. Nothing is sent until you ask.";
    case "api":
      return "Uses WorldGraph AI, which has a daily limit.";
    default:
      return "AI answers aren't available in this view; you'll still see what WorldGraph has stored.";
  }
}

// ---------------------------------------------------------------------------
// Phones: the sheet's lower part can be off screen
// ---------------------------------------------------------------------------

/**
 * On phones the panel is a sheet that can rest at half height, with its
 * lower part below the screen. This is the height of the part that shows,
 * so the message box sits at the visible bottom; null on desktop, or when
 * the whole sheet shows.
 */
function useVisibleHeight(ref: React.RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    // The panel's scroll area keeps its size; only how much of it is on screen changes.
    const area = el?.parentElement;
    if (!enabled || !el || !area || typeof IntersectionObserver === "undefined") {
      setHeight(null);
      return;
    }
    let raf = 0;
    let frames = 0;
    let lastValue = -1;
    const measure = () => {
      const box = area.getBoundingClientRect();
      const shown = Math.round(Math.min(window.innerHeight, box.bottom) - Math.max(0, box.top));
      const next = shown >= box.height - 2 || shown < 160 ? null : shown;
      setHeight(next);
      return shown;
    };
    // The sheet moves with an animation: measure each frame until it settles.
    const settle = () => {
      cancelAnimationFrame(raf);
      frames = 0;
      const tick = () => {
        const shown = measure();
        frames = shown === lastValue ? frames + 1 : 0;
        lastValue = shown;
        if (frames < 8) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(settle, {
      threshold: Array.from({ length: 21 }, (_, i) => i / 20),
    });
    observer.observe(area);
    window.addEventListener("resize", settle);
    window.visualViewport?.addEventListener("resize", settle);
    settle();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", settle);
      window.visualViewport?.removeEventListener("resize", settle);
    };
  }, [ref, enabled]);
  return height;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/** Fetches api.ask_context for a turn that is searching, and hands the result to the store. */
function ContextFetcher({ turn }: { turn: AskTurn }) {
  const query = useRpc(
    "ask_context",
    { q: turn.search, limit: CONTEXT_LIMIT, sample: turn.sample },
    { staleTime: Infinity, refetchInterval: false },
  );
  const { data, isPlaceholderData, isError, isFetching, error } = query;
  useEffect(() => {
    if (data && !isPlaceholderData) useAsk.getState().receiveContext(turn.id, data);
  }, [data, isPlaceholderData, turn.id]);
  useEffect(() => {
    if (isError && !isFetching && error) useAsk.getState().failContext(turn.id, error);
  }, [isError, isFetching, error, turn.id]);
  return null;
}

// ---------------------------------------------------------------------------
// What the conversation is about, and suggestions
// ---------------------------------------------------------------------------

const kindOf = (id: string) => id.slice(0, id.indexOf(":"));

/** The region, story, forecast or entity a conversation is about (usually cached from its panel). */
function useScopeInfo(scope: string | null): { info: AskScope | null; loading: boolean } {
  const kind = scope ? kindOf(scope) : null;
  const window = useNav((s) => s.window);
  const sample = sampleArg(useSettings((s) => s.sample));
  const id = scope ?? "";
  const isEntity = kind !== null && kind !== "region" && kind !== "story" && kind !== "forecast";
  // The same arguments as the region panel, so it is usually cached already.
  const region = useRpc("region", { id, window, sample }, { enabled: kind === "region" });
  const story = useRpc("story", { id }, { enabled: kind === "story" });
  const forecast = useRpc("forecast", { id }, { enabled: kind === "forecast" });
  const entity = useRpc("entity", { id }, { enabled: isEntity });

  return useMemo(() => {
    if (!scope) return { info: null, loading: false };
    if (kind === "region") {
      const r = region.data?.region;
      const busiest = region.data?.sector_pulse.reduce<{ sector: AskScope["sector"]; count: number }>(
        (best, p) => (p.count > best.count ? { sector: p.sector, count: p.count } : best),
        { sector: null, count: 0 },
      );
      return {
        info: r ? { id: scope, type: "region", name: r.name, sector: busiest?.sector ?? null } : null,
        loading: region.isPending,
      };
    }
    if (kind === "story") {
      const s = story.data?.story;
      return {
        info: s
          ? {
              id: scope,
              type: "story",
              name: s.headline,
              place: s.region?.name ?? null,
              topic: mainTopic(s.entities),
            }
          : null,
        loading: story.isPending,
      };
    }
    if (kind === "forecast") {
      const f = forecast.data?.forecast;
      return {
        info: f
          ? {
              id: scope,
              type: "forecast",
              name: f.short_title,
              place: f.region?.name ?? null,
              topic: mainTopic(f.entities),
            }
          : null,
        loading: forecast.isPending,
      };
    }
    const e = entity.data?.entity;
    return { info: e ? { id: scope, type: e.type, name: e.name } : null, loading: entity.isPending };
  }, [
    scope,
    kind,
    region.data,
    region.isPending,
    story.data,
    story.isPending,
    forecast.data,
    forecast.isPending,
    entity.data,
    entity.isPending,
  ]);
}

/** "About [Gujarat] ×": what the conversation is about, kept for every question in it. */
function ScopeChip({
  id,
  info,
  loading,
  onClear,
}: {
  id: string;
  info: AskScope | null;
  loading: boolean;
  onClear: () => void;
}) {
  const name = info?.name ?? null;
  return (
    <div role="group" aria-label="Conversation subject" className="flex min-w-0 items-center gap-2 text-label text-fg-muted">
      <span className="shrink-0">About</span>
      {name && info ? (
        <EntityChip size="sm" entity={{ id, type: info.type, name }} className="min-w-0" />
      ) : loading ? (
        <Skeleton className="h-6 w-32 rounded-full" />
      ) : (
        <span className="truncate">this {kindOf(id)}</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClear}
        aria-label={name ? `Stop asking about ${name}` : "Stop asking about this"}
        className="-my-1 size-8 shrink-0"
      >
        <X aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

function useProfileSectors() {
  const stored = useUserValue<unknown>("profile", null);
  return useMemo(() => {
    const parsed = Profile.safeParse(stored.value);
    return parsed.success ? parsed.data.sectors : [];
  }, [stored.value]);
}

function Suggestions({
  scope,
  loading,
  onAsk,
}: {
  scope: AskScope | null;
  loading: boolean;
  onAsk: (q: string) => void;
}) {
  const sectors: readonly SectorId[] = useProfileSectors();
  if (loading) {
    return (
      <div role="status" className="flex flex-col gap-2" aria-busy="true" aria-label="Loading suggestions">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-fg-muted">
        Ask how world events affect a place, a sector or your business. Answers cite the stories they come
        from, and you can ask follow-ups here.
      </p>
      <AnswerSection title="Try asking" icon={Sparkles}>
        <QuestionList questions={suggestionsFor(scope, scope ? [] : sectors)} onAsk={onAsk} />
      </AnswerSection>
    </div>
  );
}
