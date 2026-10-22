import {
  Bot,
  Cloud,
  Database,
  ExternalLink,
  HardDrive,
  Hourglass,
  Info,
  LockKeyhole,
  Map as MapIcon,
  Monitor,
  Moon,
  Palette,
  Settings2,
  Sparkles,
  Sun,
  SunMoon,
  X,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from "react";

import type { MetaResponse } from "@/api/contract";
import { useRpc } from "@/api/client";
import type { AiEngine } from "@/ai/engine";
import { ErrorState } from "@/components/ErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useAiEngine } from "@/features/ask/use-ai-engine";
import { safeHttpUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import { browserLooksIndian } from "@/platform/runtime";
import { getUserStore, type UserStore } from "@/platform/storage";
import type { Panel } from "@/state/nav";
import { prefersReducedMotion, useSettings, type Settings } from "@/state/settings";

import {
  ABOUT_TEXT,
  BORDER_CHOICES,
  SAMPLE_CHOICES,
  THEME_CHOICES,
  aiRow,
  bordersExplanation,
  dataSummary,
  ingestLine,
  sampleExplanation,
  sampleNow,
  storeCopy,
} from "./settings-data";

// Development only: in production builds this branch is dropped, and the preview's chunk with it.
const DesignPreview = import.meta.env.DEV ? lazy(() => import("./DesignPreview")) : () => null;

const THEME_ICONS: Record<Settings["theme"], LucideIcon> = { dark: Moon, light: Sun, system: Monitor };
const STORE_ICONS: Record<UserStore["kind"], LucideIcon> = { cloud: Cloud, browser: HardDrive, memory: Hourglass };

/**
 * Settings: theme, sample data, map borders and calm motion (saved in this
 * browser, applied at once), then what the AI uses, where personal data is
 * kept, the data sources with their attribution, and a short About.
 */
export default function SettingsPanel(_props: { panel: Extract<Panel, { kind: "settings" }> }) {
  return (
    <div className="flex flex-col gap-7 p-4 pb-8">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface-2"
        >
          <Settings2 className="size-5 text-fg" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-body font-semibold text-fg">Settings</h2>
          <p className="text-label text-fg-muted">Changes apply at once and are saved in this browser.</p>
        </div>
      </header>

      <Appearance />
      <DataAndMaps />
      <AiStatus />
      <SavedData />
      <Sources />
      <About />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function Section({ title, icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeader as="h3" id={id} title={title} icon={icon} className="min-h-0" />
      {children}
    </section>
  );
}

/** A group of rows on one card, with hairlines between them. */
function Rows({ children }: { children: ReactNode }) {
  return <Card className="flex flex-col divide-y divide-line">{children}</Card>;
}

/** A setting with a segmented control: its name, the control, then one line on what the choice does. */
function ChoiceRow({ label, control, note }: { label: string; control: ReactNode; note: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-body font-medium text-fg">{label}</p>
      {control}
      <div className="text-label text-fg-muted">{note}</div>
    </div>
  );
}

/** An icon tile, a title and a line or two under it. */
function InfoRow({ icon: Icon, title, children }: { icon: LucideIcon; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2/60"
      >
        <Icon className="size-4 text-fg-muted" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body font-medium text-fg">{title}</p>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function Appearance() {
  const theme = useSettings((s) => s.theme);
  const calm = useSettings((s) => s.calm);
  const update = useSettings((s) => s.update);
  const deviceCalm = prefersReducedMotion();
  return (
    <Section title="Appearance" icon={SunMoon}>
      <Rows>
        <ChoiceRow
          label="Theme"
          control={
            <Segmented
              aria-label="Theme"
              fill
              value={theme}
              onValueChange={(value) => update({ theme: value })}
              options={THEME_CHOICES.map((c) => ({ ...c, icon: THEME_ICONS[c.value] }))}
            />
          }
          note="Dark is the default. System follows your device or claude.ai."
        />
        <SwitchField
          label="Calm motion"
          description={
            deviceCalm
              ? "Your device already asks for less motion, so pulses and animations are off."
              : "Stops pulses, glows and animations."
          }
          checked={calm || deviceCalm}
          disabled={deviceCalm}
          onCheckedChange={(checked) => update({ calm: checked })}
          className="p-3"
        />
      </Rows>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Data and maps
// ---------------------------------------------------------------------------

function DataAndMaps() {
  const sample = useSettings((s) => s.sample);
  const borders = useSettings((s) => s.borders);
  const update = useSettings((s) => s.update);
  const meta = useRpc("meta", {});
  const looksIndian = browserLooksIndian();
  const now = sample === "auto" && !meta.isPlaceholderData ? sampleNow(meta.data?.data) : null;
  return (
    <Section title="Data and maps" icon={MapIcon}>
      <Rows>
        <ChoiceRow
          label="Sample data"
          control={
            <Segmented
              aria-label="Sample data"
              fill
              value={sample}
              onValueChange={(value) => update({ sample: value })}
              options={SAMPLE_CHOICES}
            />
          }
          note={
            <>
              <p>{sampleExplanation(sample)}</p>
              {now && <p className="text-fg-subtle">{now}</p>}
            </>
          }
        />
        <ChoiceRow
          label="Map borders"
          control={
            <Segmented
              aria-label="Map borders"
              fill
              value={borders}
              onValueChange={(value) => update({ borders: value })}
              options={BORDER_CHOICES}
            />
          }
          note={bordersExplanation(borders, looksIndian)}
        />
      </Rows>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

function AiStatus() {
  const engine = useAiEngine();
  return (
    <Section title="AI" icon={Sparkles}>
      <Rows>
        {engine ? <EngineRow engine={engine} /> : <RowSkeleton />}
      </Rows>
    </Section>
  );
}

function EngineRow({ engine }: { engine: AiEngine }) {
  const row = aiRow(engine);
  return (
    <InfoRow icon={engine.kind === "none" ? Bot : Sparkles} title={row.title}>
      <p className="text-label text-fg-muted">{row.cost}</p>
      <p className="text-label text-fg-subtle">{row.detail}</p>
    </InfoRow>
  );
}

// ---------------------------------------------------------------------------
// Where personal data is kept
// ---------------------------------------------------------------------------

function useStoreKind(): UserStore["kind"] | null {
  const [kind, setKind] = useState<UserStore["kind"] | null>(null);
  useEffect(() => {
    let alive = true;
    void getUserStore().then((store) => {
      if (alive) setKind(store.kind);
    });
    return () => {
      alive = false;
    };
  }, []);
  return kind;
}

function SavedData() {
  const kind = useStoreKind();
  const copy = kind ? storeCopy(kind) : null;
  return (
    <Section title="Your saved data" icon={LockKeyhole}>
      <Rows>
        {kind && copy ? (
          <InfoRow icon={STORE_ICONS[kind]} title={copy.title}>
            <p className="text-label text-fg-muted">{copy.description}</p>
          </InfoRow>
        ) : (
          <RowSkeleton />
        )}
      </Rows>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

function Sources() {
  const meta = useRpc("meta", {});
  const data = meta.data;
  return (
    <Section title="Data sources" icon={Database}>
      {data && (
        <p className="text-label text-fg-muted tabular-nums">
          {dataSummary(data.data)}. {ingestLine(data.data)}
        </p>
      )}
      <Rows>
        {data ? (
          data.sources.length > 0 ? (
            data.sources.map((source) => <SourceRow key={source.id} source={source} />)
          ) : (
            <p className="p-3 text-body text-fg-muted">No sources are listed yet.</p>
          )
        ) : meta.isError ? (
          <ErrorState compact error={meta.error} onRetry={() => void meta.refetch()} />
        ) : (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
      </Rows>
      <p className="text-label text-fg-subtle">
        WorldGraph stores only headlines, links and one-line snippets, never full articles. Crowd forecasts are
        information only.
      </p>
    </Section>
  );
}

type Source = MetaResponse["sources"][number];

function SourceRow({ source }: { source: Source }) {
  const url = safeHttpUrl(source.homepage);
  return (
    <div className="flex items-center gap-3 py-1 pr-1 pl-3">
      <div className="flex min-w-0 flex-1 flex-col py-1.5">
        <p className="text-body font-medium text-fg">{source.name}</p>
        <p className="text-label text-fg-muted">{source.attribution}</p>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${source.name} website (new tab)`}
          className="flex size-10 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function About() {
  return (
    <Section title="About WorldGraph" icon={Info}>
      <p className="text-body text-fg-muted">{ABOUT_TEXT}</p>
      {/* A tool for building the app: its invented examples never reach the test link or the website. */}
      {import.meta.env.DEV && <DesignPreviewButton />}
    </Section>
  );
}

/** Development only: every UI kit component with example data. */
function DesignPreviewButton() {
  const [preview, setPreview] = useState(false);
  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setPreview(true)}>
          <Palette aria-hidden />
          Design preview
        </Button>
      </div>
      <Dialog open={preview} onOpenChange={setPreview}>
        {preview && (
          <DialogContent
            hideClose
            aria-describedby={undefined}
            className="h-[calc(100dvh-24px)] max-h-none w-[min(76rem,calc(100vw-24px))] gap-0 overflow-hidden p-0"
          >
            <DialogTitle className="sr-only">Design preview</DialogTitle>
            <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="sticky top-0 z-10 flex justify-end p-2">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setPreview(false)}
                  aria-label="Close the design preview"
                  className="shadow-panel"
                >
                  <X aria-hidden />
                </Button>
              </div>
              <div className="-mt-14">
                <Suspense fallback={<PreviewSkeleton />}>
                  <DesignPreview />
                </Suspense>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3" aria-hidden>
      <Skeleton className="size-9 rounded-lg" />
      <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className={cn("flex flex-col gap-4 p-6")} aria-busy="true" aria-label="Loading the design preview">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
