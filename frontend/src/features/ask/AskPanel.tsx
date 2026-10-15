import {
  ArrowUp,
  Clock,
  MessageCircleQuestion,
  RotateCw,
  Search,
  SearchX,
  Sparkles,
  Square,
  Users,
  Waypoints,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { Profile, type SectorId } from "@/api/contract";
import { useRpc } from "@/api/client";
import type { AiEngine } from "@/ai/engine";
import { EmptyState } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUserValue } from "@/platform/storage";
import { useNav, type Panel } from "@/state/nav";
import { sampleArg, useSettings } from "@/state/settings";

import {
  CONTEXT_LIMIT,
  MAX_QUESTION,
  citedStories,
  cleanQuestion,
  isAskable,
  mainTopic,
  suggestionsFor,
  type AskScope,
} from "./ask-data";
import {
  AiProblem,
  AnswerBullets,
  AnswerSection,
  AnswerSkeleton,
  CrowdForecastRow,
  FoundStories,
  MiniCascade,
  QuestionList,
} from "./ask-parts";
import { panelKeyOf, useAsk, type AskEntry } from "./ask-store";
import { useAiEngine } from "./use-ai-engine";

type AskPanelProps = { panel: Extract<Panel, { kind: "ask" }> };

/**
 * Ask: one question box, answered only from what WorldGraph has stored.
 * The question goes to api.ask_context; the AI then writes up to three
 * bullets with citations, a mini cascade and related crowd forecasts. The
 * AI runs only when the viewer asks (it uses their Claude account in the
 * test link). A deep link with a question only fills the box.
 */
export default function AskPanel({ panel }: AskPanelProps) {
  return <AskBody key={panelKeyOf(panel.q, panel.scope)} q={panel.q} scope={panel.scope} />;
}

function AskBody({ q, scope }: { q?: string; scope?: string }) {
  const panelKey = panelKeyOf(q, scope);
  const sample = sampleArg(useSettings((s) => s.sample));
  const entries = useAsk((s) => s.entries);
  const shownId = useAsk((s) => s.shown[panelKey] ?? null);
  const submit = useAsk((s) => s.submit);
  const show = useAsk((s) => s.show);
  const engine = useAiEngine();
  const [draft, setDraft] = useState(q ?? "");
  const inputId = useId();
  const noteId = useId();

  const active = entries.find((e) => e.id === shownId) ?? null;
  const earlier = entries.filter((e) => e.id !== active?.id).reverse().slice(0, 5);

  const ask = (text: string) => {
    const question = cleanQuestion(text);
    if (!isAskable(question)) return;
    submit(question, sample, panelKey);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-5 p-4 pb-8">
      {/* Searching runs here, so it carries on while another question is shown. */}
      {entries
        .filter((e) => e.phase === "searching")
        .map((e) => (
          <ContextFetcher key={e.id} entry={e} />
        ))}

      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface-2"
        >
          <MessageCircleQuestion className="size-5 text-fg" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-body font-semibold text-fg">Ask WorldGraph</h2>
          <p className="text-label text-fg-muted">
            Answers come only from stored stories, cause-and-effect links and crowd forecasts, with sources.
          </p>
        </div>
      </header>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Your question
        </label>
        <div className="relative">
          <input
            id={inputId}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_QUESTION}
            placeholder="How does X affect Y?"
            autoComplete="off"
            enterKeyHint="send"
            aria-describedby={noteId}
            className="h-12 w-full rounded-xl border border-line-strong bg-bg-sunken/70 pr-14 pl-4 text-body text-fg transition-colors placeholder:text-fg-subtle hover:border-fg-subtle/60"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Ask"
            disabled={!isAskable(draft)}
            className="absolute top-1 right-1"
          >
            <ArrowUp aria-hidden />
          </Button>
        </div>
        <p id={noteId} className="min-h-4 text-label text-fg-subtle">
          {engineNote(engine)}
        </p>
      </form>

      {active ? (
        <EntryView entry={active} engine={engine} onAsk={ask} />
      ) : (
        <Suggestions scope={scope} onAsk={ask} />
      )}

      {earlier.length > 0 && (
        <AnswerSection title="Earlier this visit" icon={Clock}>
          <ul className="flex flex-col">
            {earlier.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => show(panelKey, e.id)}
                  className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/70"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{e.question}</span>
                  <span className="shrink-0 text-label text-fg-subtle">
                    {e.phase === "searching" || e.phase === "thinking" ? (
                      "Working…"
                    ) : (
                      <TimeAgo value={new Date(e.askedAt).toISOString()} />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </AnswerSection>
      )}
    </div>
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
// Retrieval
// ---------------------------------------------------------------------------

/** Fetches api.ask_context for a question that is searching, and hands the result to the store. */
function ContextFetcher({ entry }: { entry: AskEntry }) {
  const query = useRpc(
    "ask_context",
    { q: entry.question, limit: CONTEXT_LIMIT, sample: entry.sample },
    { staleTime: Infinity, refetchInterval: false },
  );
  const { data, isPlaceholderData, isError, isFetching, error } = query;
  useEffect(() => {
    if (data && !isPlaceholderData) useAsk.getState().receiveContext(entry.id, data);
  }, [data, isPlaceholderData, entry.id]);
  useEffect(() => {
    if (isError && !isFetching && error) useAsk.getState().failContext(entry.id, error);
  }, [isError, isFetching, error, entry.id]);
  return null;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function useProfileSectors() {
  const stored = useUserValue<unknown>("profile", null);
  return useMemo(() => {
    const parsed = Profile.safeParse(stored.value);
    return parsed.success ? parsed.data.sectors : [];
  }, [stored.value]);
}

function Suggestions({ scope, onAsk }: { scope?: string; onAsk: (q: string) => void }) {
  const kind = scope ? scope.slice(0, scope.indexOf(":")) : null;
  if (scope && kind === "region") return <RegionScope id={scope} onAsk={onAsk} />;
  if (scope && kind === "story") return <StoryScope id={scope} onAsk={onAsk} />;
  if (scope && kind === "forecast") return <ForecastScope id={scope} onAsk={onAsk} />;
  if (scope && kind) return <EntityScope id={scope} onAsk={onAsk} />;
  return <DefaultSuggestions onAsk={onAsk} />;
}

function DefaultSuggestions({ onAsk }: { onAsk: (q: string) => void }) {
  const sectors = useProfileSectors();
  return <SuggestionList scope={null} loading={false} onAsk={onAsk} profileSectors={sectors} />;
}

function RegionScope({ id, onAsk }: { id: string; onAsk: (q: string) => void }) {
  const window = useNav((s) => s.window);
  const sample = sampleArg(useSettings((s) => s.sample));
  // The same arguments as the region panel, so it is usually cached already.
  const query = useRpc("region", { id, window, sample });
  const region = query.data?.region;
  const busiest = query.data?.sector_pulse.reduce<{ sector: AskScope["sector"]; count: number }>(
    (best, p) => (p.count > best.count ? { sector: p.sector, count: p.count } : best),
    { sector: null, count: 0 },
  );
  const info: AskScope | null = region
    ? { id, type: "region", name: region.name, sector: busiest?.sector ?? null }
    : null;
  return <SuggestionList scope={info} loading={query.isPending} onAsk={onAsk} />;
}

function StoryScope({ id, onAsk }: { id: string; onAsk: (q: string) => void }) {
  const query = useRpc("story", { id });
  const story = query.data?.story;
  const info: AskScope | null = story
    ? {
        id,
        type: "story",
        name: story.headline,
        place: story.region?.name ?? null,
        topic: mainTopic(story.entities),
      }
    : null;
  return <SuggestionList scope={info} loading={query.isPending} onAsk={onAsk} />;
}

function ForecastScope({ id, onAsk }: { id: string; onAsk: (q: string) => void }) {
  const query = useRpc("forecast", { id });
  const forecast = query.data?.forecast;
  const info: AskScope | null = forecast
    ? {
        id,
        type: "forecast",
        name: forecast.short_title,
        place: forecast.region?.name ?? null,
        topic: mainTopic(forecast.entities),
      }
    : null;
  return <SuggestionList scope={info} loading={query.isPending} onAsk={onAsk} />;
}

function EntityScope({ id, onAsk }: { id: string; onAsk: (q: string) => void }) {
  const query = useRpc("entity", { id });
  const entity = query.data?.entity;
  const info: AskScope | null = entity ? { id, type: entity.type, name: entity.name } : null;
  return <SuggestionList scope={info} loading={query.isPending} onAsk={onAsk} />;
}

function SuggestionList({
  scope,
  loading,
  onAsk,
  profileSectors = [],
}: {
  scope: AskScope | null;
  loading: boolean;
  onAsk: (q: string) => void;
  profileSectors?: readonly SectorId[];
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading suggestions">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const questions = suggestionsFor(scope, profileSectors);
  // Stories and forecasts have long names: the chip shows what the questions are about instead.
  const about = scope && scope.type !== "story" && scope.type !== "forecast" ? scope : null;
  return (
    <AnswerSection title="Try asking" icon={Sparkles}>
      {about && (
        <div className="flex items-center gap-2 text-label text-fg-muted">
          <span>About</span>
          <EntityChip size="sm" entity={{ id: about.id, type: about.type, name: about.name }} />
        </div>
      )}
      <QuestionList questions={questions} onAsk={onAsk} />
    </AnswerSection>
  );
}

// ---------------------------------------------------------------------------
// One question and its answer
// ---------------------------------------------------------------------------

function StatusLine({ icon: Icon, children, pulse = false }: { icon: typeof Search; children: ReactNode; pulse?: boolean }) {
  return (
    <p role="status" className="flex items-center gap-2 text-body text-fg-muted">
      <Icon aria-hidden className={cn("size-4 shrink-0", pulse && "animate-pulse")} />
      {children}
    </p>
  );
}

function found(entry: AskEntry): string {
  const ctx = entry.context;
  if (!ctx) return "";
  const parts = [`${ctx.stories.length} ${ctx.stories.length === 1 ? "story" : "stories"}`];
  if (ctx.links.length) parts.push(`${ctx.links.length} ${ctx.links.length === 1 ? "link" : "links"}`);
  if (ctx.forecasts.length) {
    parts.push(`${ctx.forecasts.length} crowd ${ctx.forecasts.length === 1 ? "forecast" : "forecasts"}`);
  }
  return `Found ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}

function EntryView({
  entry,
  engine,
  onAsk,
}: {
  entry: AskEntry;
  engine: AiEngine | null;
  onAsk: (q: string) => void;
}) {
  const headingId = useId();
  const open = useNav((s) => s.open);
  const stop = useAsk((s) => s.stop);
  const retry = useAsk((s) => s.retry);
  const openStory = (id: string) => open({ kind: "story", id });
  const openForecast = (id: string) => open({ kind: "forecast", id });
  const running = entry.phase === "searching" || entry.phase === "thinking";

  return (
    <article aria-labelledby={headingId} aria-busy={running} className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 border-l-2 border-line-strong pl-3">
        <p className="text-label text-fg-subtle">You asked</p>
        <h3 id={headingId} className="text-body font-semibold text-fg">
          {entry.question}
        </h3>
      </div>

      {running && (
        <>
          <div className="flex items-start justify-between gap-2">
            {entry.phase === "searching" ? (
              <StatusLine icon={Search} pulse>
                Searching WorldGraph…
              </StatusLine>
            ) : (
              <StatusLine icon={Sparkles} pulse>
                {found(entry)} Writing the answer…
              </StatusLine>
            )}
            <Button variant="outline" size="sm" onClick={() => stop(entry.id)} className="-my-1.5 h-10 shrink-0">
              <Square aria-hidden className="size-3 fill-current" />
              Stop
            </Button>
          </div>
          <AnswerSkeleton />
        </>
      )}

      {entry.phase === "stopped" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 p-3">
            <StatusLine icon={Square}>Stopped. Nothing more was sent.</StatusLine>
            <Button variant="secondary" size="sm" onClick={() => retry(entry.id)} className="h-10">
              <RotateCw aria-hidden />
              Ask again
            </Button>
          </div>
          {entry.context && (
            <FoundStories
              stories={entry.context.stories}
              forecasts={entry.context.forecasts}
              onOpenStory={openStory}
              onOpenForecast={openForecast}
            />
          )}
        </>
      )}

      {entry.phase === "failed" && entry.failure?.source === "data" && (
        <ErrorState
          error={entry.failure.error}
          onRetry={() => retry(entry.id)}
          compact
          className="rounded-xl border border-line bg-surface/60"
        />
      )}

      {entry.phase === "failed" && entry.failure?.source === "ai" && (
        <>
          <AiProblem
            kind={entry.failure.kind}
            message={entry.failure.message}
            engine={engine?.kind ?? null}
            onRetry={() => retry(entry.id)}
          />
          {entry.context && (
            <FoundStories
              stories={entry.context.stories}
              forecasts={entry.context.forecasts}
              onOpenStory={openStory}
              onOpenForecast={openForecast}
            />
          )}
        </>
      )}

      {entry.phase === "done" && entry.answer && (
        <AnswerView
          entry={entry}
          engine={engine}
          onAsk={onAsk}
          onOpenStory={openStory}
          onOpenForecast={openForecast}
        />
      )}
    </article>
  );
}

function AnswerView({
  entry,
  engine,
  onAsk,
  onOpenStory,
  onOpenForecast,
}: {
  entry: AskEntry;
  engine: AiEngine | null;
  onAsk: (q: string) => void;
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}) {
  const answer = entry.answer!;
  if (answer.status === "not_enough_evidence") {
    const followUps = answer.followUps.length > 0 ? answer.followUps : suggestionsFor(null).slice(0, 3);
    return (
      <>
        <div role="status">
          <EmptyState
            compact
            icon={SearchX}
            title="Not enough evidence"
            description="WorldGraph doesn't hold enough stories on this to answer it. It answers only from what it has stored."
            className="rounded-xl border border-line bg-surface/60"
          />
        </div>
        {entry.context && (
          <FoundStories
            stories={entry.context.stories}
            forecasts={entry.context.forecasts}
            onOpenStory={onOpenStory}
            onOpenForecast={onOpenForecast}
          />
        )}
        <AnswerSection title="Try asking instead" icon={Sparkles}>
          <QuestionList questions={followUps} onAsk={onAsk} />
        </AnswerSection>
      </>
    );
  }

  const cited = citedStories(answer);
  const anySample = cited.some((s) => s.is_sample) || answer.forecasts.some((f) => f.is_sample);
  return (
    <>
      <AnswerSection title="Answer" note="AI summary of stored stories">
        <AnswerBullets answer={answer} onOpenStory={onOpenStory} />
        <div className="flex items-start gap-2 rounded-lg bg-surface-2/50 px-3 py-2 text-label text-fg-muted">
          <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <p className="min-w-0 flex-1">
            Written by {engine?.label ?? "the AI"} from {cited.length} cited{" "}
            {cited.length === 1 ? "story" : "stories"}. Check the sources before acting.
          </p>
          {anySample && <SampleBadge compact />}
        </div>
      </AnswerSection>

      {answer.cascade.length > 0 && (
        <AnswerSection title="How it connects" icon={Waypoints} note="stored links">
          <MiniCascade chains={answer.cascade} onOpenStory={onOpenStory} showSample={!anySample} />
        </AnswerSection>
      )}

      {answer.forecasts.length > 0 && (
        <AnswerSection title="What the crowd expects" icon={Users} note="crowd forecasts, not facts">
          <ul className="flex flex-col">
            {answer.forecasts.map((f) => (
              <li key={f.id}>
                <CrowdForecastRow forecast={f} onOpen={onOpenForecast} showSample={!anySample} />
              </li>
            ))}
          </ul>
        </AnswerSection>
      )}

      {answer.followUps.length > 0 && (
        <AnswerSection title="Ask next" icon={MessageCircleQuestion}>
          <QuestionList questions={answer.followUps} onAsk={onAsk} />
        </AnswerSection>
      )}
    </>
  );
}
