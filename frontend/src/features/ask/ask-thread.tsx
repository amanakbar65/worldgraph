/**
 * One turn of the Ask conversation: the viewer's question as a message, and
 * below it the answer in the usual layout (cited points, how it connects,
 * crowd forecasts kept apart), or how it is going (searching, writing,
 * stopped, failed with a retry for this turn only).
 */
import {
  MessageCircleQuestion,
  RotateCw,
  Search,
  SearchX,
  Sparkles,
  Square,
  Users,
  Waypoints,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import type { AiEngine } from "@/ai/engine";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";

import { citedStories, suggestionsFor, type AskAbout } from "./ask-data";
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
import { useAsk, type AskTurn } from "./ask-store";

function StatusLine({
  icon: Icon,
  children,
  pulse = false,
}: {
  icon: typeof Search;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <p className="flex items-center gap-2 text-body text-fg-muted">
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0", pulse && "animate-pulse motion-reduce:animate-none")}
      />
      {children}
    </p>
  );
}

function found(turn: AskTurn): string {
  const ctx = turn.context;
  if (!ctx) return "";
  const parts = [`${ctx.stories.length} ${ctx.stories.length === 1 ? "story" : "stories"}`];
  if (ctx.links.length) parts.push(`${ctx.links.length} ${ctx.links.length === 1 ? "link" : "links"}`);
  if (ctx.forecasts.length) {
    parts.push(`${ctx.forecasts.length} crowd ${ctx.forecasts.length === 1 ? "forecast" : "forecasts"}`);
  }
  return `Found ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}

/** A thin line where the conversation turns to a new subject. */
export function AboutDivider({ about }: { about: AskAbout | null }) {
  const label = about ? `About ${about.name}` : "General questions";
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 text-label text-fg-subtle">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span className="max-w-[75%] truncate" aria-hidden>
        {label}
      </span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

export function TurnView({
  turn,
  latest,
  busy,
  engine,
  onAsk,
}: {
  turn: AskTurn;
  /** The newest turn: only it offers questions to ask next. */
  latest: boolean;
  /** Another question is running: retries and suggestions wait. */
  busy: boolean;
  engine: AiEngine | null;
  onAsk: (q: string) => void;
}) {
  const headingId = useId();
  const open = useNav((s) => s.open);
  const retry = useAsk((s) => s.retry);
  const openStory = (id: string) => open({ kind: "story", id });
  const openForecast = (id: string) => open({ kind: "forecast", id });
  const running = turn.phase === "searching" || turn.phase === "thinking";
  const readAs =
    turn.phase === "done" && (turn.history.length > 0 || turn.about) ? turn.answer?.readAs : null;

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={running}
      data-turn={turn.id}
      className="flex flex-col gap-3"
    >
      {/* The viewer's message */}
      <div className="flex flex-col items-end gap-1 pl-8">
        <div className="max-w-full rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2">
          <p className="sr-only">You asked</p>
          <h3 id={headingId} className="text-body break-words text-fg">
            {turn.question}
          </h3>
        </div>
        {readAs && <p className="text-label text-fg-subtle">Read as “{readAs}”</p>}
      </div>

      {/* The answer */}
      <div className="flex flex-col gap-4">
        {running && (
          <>
            {turn.phase === "searching" ? (
              <StatusLine icon={Search} pulse>
                Searching WorldGraph…
              </StatusLine>
            ) : (
              <StatusLine icon={Sparkles} pulse>
                {found(turn)} Writing the answer…
              </StatusLine>
            )}
            <AnswerSkeleton />
          </>
        )}

        {turn.phase === "stopped" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 p-3">
              <StatusLine icon={Square}>Stopped. Nothing more was sent.</StatusLine>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => retry(turn.id)}
                disabled={busy}
                className="h-10"
              >
                <RotateCw aria-hidden />
                Ask again
              </Button>
            </div>
            {turn.context && (
              <FoundStories
                stories={turn.context.stories}
                forecasts={turn.context.forecasts}
                onOpenStory={openStory}
                onOpenForecast={openForecast}
              />
            )}
          </>
        )}

        {turn.phase === "failed" && turn.failure?.source === "data" && (
          <ErrorState
            error={turn.failure.error}
            onRetry={busy ? undefined : () => retry(turn.id)}
            compact
            className="rounded-xl border border-line bg-surface/60"
          />
        )}

        {turn.phase === "failed" && turn.failure?.source === "ai" && (
          <>
            <AiProblem
              kind={turn.failure.kind}
              message={turn.failure.message}
              engine={engine?.kind ?? null}
              onRetry={busy ? undefined : () => retry(turn.id)}
            />
            {turn.context && (
              <FoundStories
                stories={turn.context.stories}
                forecasts={turn.context.forecasts}
                onOpenStory={openStory}
                onOpenForecast={openForecast}
              />
            )}
          </>
        )}

        {turn.phase === "done" && turn.answer && (
          <AnswerView
            turn={turn}
            latest={latest}
            busy={busy}
            engine={engine}
            onAsk={onAsk}
            onOpenStory={openStory}
            onOpenForecast={openForecast}
          />
        )}
      </div>
    </article>
  );
}

function AnswerView({
  turn,
  latest,
  busy,
  engine,
  onAsk,
  onOpenStory,
  onOpenForecast,
}: {
  turn: AskTurn;
  latest: boolean;
  busy: boolean;
  engine: AiEngine | null;
  onAsk: (q: string) => void;
  onOpenStory: (id: string) => void;
  onOpenForecast: (id: string) => void;
}) {
  const answer = turn.answer!;
  if (answer.status === "not_enough_evidence") {
    const followUps = answer.followUps.length > 0 ? answer.followUps : suggestionsFor(null).slice(0, 3);
    return (
      <>
        <EmptyState
          compact
          icon={SearchX}
          title="Not enough evidence"
          description="WorldGraph doesn't hold enough stories on this to answer it. It answers only from what it has stored."
          className="rounded-xl border border-line bg-surface/60"
        />
        {latest && (
          <AnswerSection title="Try asking instead" icon={Sparkles}>
            <QuestionList questions={followUps} onAsk={onAsk} disabled={busy} />
          </AnswerSection>
        )}
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

      {latest && answer.followUps.length > 0 && (
        <AnswerSection title="Ask next" icon={MessageCircleQuestion}>
          <QuestionList questions={answer.followUps} onAsk={onAsk} disabled={busy} />
        </AnswerSection>
      )}
    </>
  );
}
