import {
  Briefcase,
  Check,
  CircleAlert,
  Copy,
  Database,
  Globe2,
  Lightbulb,
  Network,
  Newspaper,
  Settings2,
  Sparkles,
  Users,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useRpc } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SampleBadge } from "@/components/SampleBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { ENTITY_TYPE_TONES, FORECAST_TONE, IMPACT_TONES } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import { useUserValue } from "@/platform/storage";
import { currentPanel, useNav } from "@/state/nav";
import { sampleArg, useSettings } from "@/state/settings";

import {
  BRIEF_ORDER,
  briefAsText,
  briefDate,
  cardsByKind,
  isBriefEmpty,
  isCardEmpty,
  sampleShare,
  usableProfile,
} from "./brief-data";
import {
  BriefCardFrame,
  BriefSkeleton,
  CascadeFooter,
  CascadePreview,
  EmptyCard,
  ForecastList,
  SpotlightFooter,
  SpotlightHeader,
  StoryList,
} from "./brief-parts";
import { copyText } from "./copy-text";

/**
 * The daily brief: six calm cards built from stored data (top risks, top
 * opportunities, the most reported stories, crowd forecasts that moved,
 * one cascade to watch and one region in the spotlight). Every item opens
 * its panel. It leans towards the viewer's business when a profile is saved.
 */
export default function BriefView() {
  const sample = sampleArg(useSettings((s) => s.sample));
  const top = useNav(currentPanel);
  const open = useNav((s) => s.open);
  const flyTo = useNav((s) => s.flyTo);
  const setView = useNav((s) => s.setView);
  const sidePanel = top !== null && top.kind !== "cascade" && top.kind !== "compare";

  // The business profile (My Business) tunes the order; read only here.
  const stored = useUserValue<unknown>("profile", null);
  const profile = useMemo(() => usableProfile(stored.value), [stored.value]);
  const args = useMemo(() => (profile ? { profile, sample } : { sample }), [profile, sample]);
  const query = useRpc("brief", args);
  const brief = query.data;

  const openStory = (id: string) => open({ kind: "story", id });
  const openForecast = (id: string) => open({ kind: "forecast", id });
  const openRegion = (id: string) => {
    open({ kind: "region", id });
    flyTo({ regionId: id });
  };
  const toGlobe = { label: "Open the globe", icon: Globe2, onClick: () => setView("globe") };

  const cards = brief ? cardsByKind(brief) : null;
  const share = brief ? sampleShare(brief) : "none";
  const showSample = share !== "all";

  return (
    <div
      className={cn(
        "h-full overflow-y-auto overscroll-contain transition-[padding] duration-200",
        sidePanel && "lg:pr-[456px]",
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-5 pb-24 sm:px-6 sm:pt-8">
        <header className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line pb-5">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <div className="min-h-4 text-label font-medium tracking-wide text-fg-subtle uppercase">
              {brief ? briefDate(brief.generated_at) : <Skeleton className="h-4 w-36" />}
            </div>
            <h1 className="text-figure font-semibold tracking-tight text-fg">Daily brief</h1>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-fg-muted">
              <Database aria-hidden className="size-4 shrink-0" />
              <span>Generated from stored data</span>
              {brief && (
                <>
                  <span aria-hidden>·</span>
                  <TimeAgo value={brief.generated_at} prefix="updated" />
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile && (
              <Chip size="md" title="Your business profile from My Business moves related stories up">
                <Briefcase aria-hidden />
                Tuned to your business
              </Chip>
            )}
            {share === "all" && <SampleBadge />}
            {brief && !isBriefEmpty(brief) && <CopyButton text={() => briefAsText(brief, { profileUsed: !!profile })} />}
          </div>
        </header>

        {!brief && query.isError && (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
        {!brief && !query.isError && (
          <div aria-busy="true" aria-label="Loading the brief">
            <BriefSkeleton />
          </div>
        )}

        {brief && isBriefEmpty(brief) && (
          <EmptyState
            icon={Newspaper}
            title="Nothing to brief on yet"
            description="New stories arrive through the day. Sample data in Settings lets you explore in the meantime."
            action={{ label: "Open Settings", icon: Settings2, onClick: () => open({ kind: "settings" }) }}
            secondaryAction={toGlobe}
          />
        )}

        {brief && cards && !isBriefEmpty(brief) && (
          <div className="grid gap-4 md:grid-cols-2">
            {BRIEF_ORDER.map((kind) => {
              switch (kind) {
                case "top_risks": {
                  const card = cards.top_risks;
                  return (
                    <BriefCardFrame key={kind} kind={kind} icon={CircleAlert} tone={IMPACT_TONES.risk}>
                      {card && !isCardEmpty(card) ? (
                        <StoryList stories={card.stories} showSample={showSample} onOpen={openStory} />
                      ) : (
                        <EmptyCard kind={kind} action={toGlobe} />
                      )}
                    </BriefCardFrame>
                  );
                }
                case "top_opportunities": {
                  const card = cards.top_opportunities;
                  return (
                    <BriefCardFrame key={kind} kind={kind} icon={Sparkles} tone={IMPACT_TONES.opportunity}>
                      {card && !isCardEmpty(card) ? (
                        <StoryList stories={card.stories} showSample={showSample} onOpen={openStory} />
                      ) : (
                        <EmptyCard
                          kind={kind}
                          action={{ label: "See Opportunities", icon: Lightbulb, onClick: () => setView("opportunities") }}
                        />
                      )}
                    </BriefCardFrame>
                  );
                }
                case "biggest_movers": {
                  const card = cards.biggest_movers;
                  return (
                    <BriefCardFrame key={kind} kind={kind} icon={Newspaper} tone={IMPACT_TONES.neutral}>
                      {card && !isCardEmpty(card) ? (
                        <StoryList stories={card.stories} showSample={showSample} onOpen={openStory} />
                      ) : (
                        <EmptyCard kind={kind} action={toGlobe} />
                      )}
                    </BriefCardFrame>
                  );
                }
                case "odds_moved": {
                  const card = cards.odds_moved;
                  return (
                    <BriefCardFrame key={kind} kind={kind} icon={Users} tone={FORECAST_TONE}>
                      {card && !isCardEmpty(card) ? (
                        <ForecastList forecasts={card.forecasts} showSample={showSample} onOpen={openForecast} />
                      ) : (
                        <EmptyCard
                          kind={kind}
                          action={{ label: "See all forecasts", icon: Users, onClick: () => setView("forecasts") }}
                        />
                      )}
                    </BriefCardFrame>
                  );
                }
                case "cascade_to_watch": {
                  const card = cards.cascade_to_watch;
                  const focus = card?.focus ?? null;
                  return (
                    <BriefCardFrame
                      key={kind}
                      kind={kind}
                      icon={Waypoints}
                      tone={IMPACT_TONES.neutral}
                      footer={
                        focus && card ? (
                          <CascadeFooter
                            effects={card.effects}
                            onOpen={() => open({ kind: "cascade", id: focus.id })}
                          />
                        ) : undefined
                      }
                    >
                      {focus ? (
                        <>
                          <StoryList stories={[focus]} ranked={false} showSample={showSample} onOpen={openStory} />
                          <CascadePreview focusId={focus.id} showSample={showSample} onOpenStory={openStory} />
                        </>
                      ) : (
                        <EmptyCard
                          kind={kind}
                          action={{ label: "Open the graph", icon: Network, onClick: () => setView("graph") }}
                        />
                      )}
                    </BriefCardFrame>
                  );
                }
                case "region_spotlight": {
                  const card = cards.region_spotlight;
                  const region = card?.region ?? null;
                  return (
                    <BriefCardFrame
                      key={kind}
                      kind={kind}
                      icon={Globe2}
                      tone={ENTITY_TYPE_TONES.region}
                      footer={region ? <SpotlightFooter region={region} onOpen={openRegion} /> : undefined}
                    >
                      {region && card ? (
                        <>
                          <SpotlightHeader region={region} score={card.score} onOpen={openRegion} />
                          <StoryList stories={card.stories} ranked={false} showSample={showSample} onOpen={openStory} />
                        </>
                      ) : (
                        <EmptyCard kind={kind} action={toGlobe} />
                      )}
                    </BriefCardFrame>
                  );
                }
              }
            })}
          </div>
        )}

        {brief && share === "some" && (
          <p className="flex items-center gap-2 text-label text-fg-muted">
            <SampleBadge compact /> Items marked with the flask are illustrative sample data, not real events.
          </p>
        )}
      </div>
    </div>
  );
}

/** "Copy as text", then "Copied" (or why it didn't work) for a few seconds. */
function CopyButton({ text }: { text: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(text());
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  };
  return (
    <>
      <Button variant="outline" onClick={() => void onClick()}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === "copied" ? "Copied" : "Copy as text"}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? "The brief is copied as text." : state === "failed" ? "Copying isn't allowed here." : ""}
      </span>
      {state === "failed" && <span className="text-label text-fg-muted">Copying isn't allowed in this view.</span>}
    </>
  );
}
