/**
 * Design preview: every UI-kit component with realistic example data, for
 * visual QA in both themes. Linked from Settings; also served on its own by
 * /preview.html in development.
 */
import { Info, ListFilter, Moon, Newspaper, Search, Sun, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  ENTITY_TYPES,
  SECTOR_IDS,
  type EntityType,
  type ForecastSummary,
  type HistoryPoint,
  type Kpi,
  type LinkType,
  type RegionRef,
  type SectorId,
  type SourceRef,
  type StorySummary,
  type TimeWindow,
} from "@/api/contract";
import { DataError } from "@/api/source";
import { ConfidenceMeter, LinkTypeLabel } from "@/components/ConfidenceMeter";
import { EmptyState } from "@/components/EmptyState";
import { EntityChip } from "@/components/EntityChip";
import { ErrorState } from "@/components/ErrorState";
import { ForecastRow } from "@/components/ForecastRow";
import { HorizonChip } from "@/components/HorizonChip";
import { ImpactBadge } from "@/components/ImpactBadge";
import { KpiTile } from "@/components/KpiTile";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ProbabilityHistoryChart } from "@/components/ProbabilityHistoryChart";
import { ProbabilityRing } from "@/components/ProbabilityRing";
import { SampleBadge } from "@/components/SampleBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { SectorChip } from "@/components/SectorChip";
import { SourcesList } from "@/components/SourcesList";
import { Sparkline } from "@/components/Sparkline";
import { StoryCard } from "@/components/StoryCard";
import { TimeAgo } from "@/components/TimeAgo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip, ChipButton } from "@/components/ui/chip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd, KbdCombo } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { ENTITY_TYPE_ICONS, EVENT_TYPE_ICONS, IMPACT_ICONS, eventTypeLabel } from "@/lib/icons";
import { ENTITY_TYPE_TONES, FORECAST_TONE, IMPACT_TONES, LINK_TYPES, type Tone } from "@/lib/meaning";
import { TIME_WINDOWS, WINDOW_LABELS } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings";

// ---------------------------------------------------------------------------
// Example data (fixed at load so the page is stable while you look at it)
// ---------------------------------------------------------------------------

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (offset: number) => new Date(NOW + offset).toISOString();

/** A deterministic wobble, so charts look real but never change between renders. */
function wave(n: number, start: number, end: number, amp: number, seed = 1): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    const noise = Math.sin(i * 1.7 + seed) * 0.6 + Math.sin(i * 0.53 + seed * 2) * 0.4;
    return start + (end - start) * t + noise * amp * (1 - t * 0.5);
  });
}

const GUJARAT: RegionRef = { id: "region:in-gj", name: "Gujarat", subtype: "state", country_id: "region:in" };
const KERALA: RegionRef = { id: "region:in-kl", name: "Kerala", subtype: "state", country_id: "region:in" };
const EGYPT: RegionRef = { id: "region:eg", name: "Egypt", subtype: "country", country_id: "region:eg" };
const CHILE: RegionRef = { id: "region:cl", name: "Chile", subtype: "country", country_id: "region:cl" };
const INDIA: RegionRef = { id: "region:in", name: "India", subtype: "country", country_id: "region:in" };

type ExampleStory = StorySummary & { actions?: string[] };

function story(partial: Partial<ExampleStory> & Pick<StorySummary, "id" | "headline" | "impact">): ExampleStory {
  return {
    kind: "event",
    so_what: null,
    event_type: "market-shift",
    direction: null,
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.7,
    importance: 70,
    sectors: [],
    first_seen: iso(-3 * HOUR),
    region: null,
    lon: null,
    lat: null,
    source_count: 4,
    analysed: true,
    is_sample: true,
    ...partial,
  };
}

const STORIES: ExampleStory[] = [
  story({
    id: "story:red-sea-detours",
    headline: "Red Sea detours push Asia–Europe container rates higher",
    so_what: "Longer routes add ten to fourteen days and raise landed costs for importers.",
    event_type: "trade-flow",
    impact: "risk",
    direction: "up",
    horizon: "weeks",
    confidence: 0.82,
    sectors: ["logistics-trade", "consumer"],
    region: EGYPT,
    first_seen: iso(-12 * MIN),
    actions: [
      "Check freight clauses in supplier contracts",
      "Hold two extra weeks of stock",
      "Ask forwarders about Cape route surcharges",
    ],
  }),
  story({
    id: "story:kerala-monsoon-early",
    headline: "Monsoon arrives early over Kerala, lifting the sowing outlook",
    so_what: "Earlier rain supports rice and pulse planting and eases food-price pressure.",
    event_type: "crop-conditions",
    impact: "opportunity",
    direction: "up",
    horizon: "months",
    confidence: 0.66,
    sectors: ["agri-food"],
    region: KERALA,
    first_seen: iso(-3 * HOUR),
  }),
  story({
    id: "story:policy-rate-steady",
    headline: "Central bank holds its policy rate for a third meeting",
    so_what: "Borrowing costs stay where they are; the next move depends on food prices.",
    event_type: "policy-decision",
    impact: "neutral",
    horizon: "months",
    confidence: 0.9,
    sectors: ["finance"],
    region: INDIA,
    first_seen: iso(-2 * DAY),
  }),
  story({
    id: "story:copper-smelter-outage",
    headline: "Copper smelter outage tightens cathode supply",
    so_what: "Wire and cable makers may face higher input costs into next quarter.",
    event_type: "disruption",
    impact: "risk",
    direction: "up",
    horizon: "now",
    confidence: 0.58,
    sectors: ["manufacturing", "energy"],
    region: CHILE,
    first_seen: iso(-40 * MIN),
  }),
  story({
    id: "story:gujarat-solar-tender",
    headline: "Gujarat opens a tender for a new solar park",
    so_what: "Module, cabling and EPC suppliers get a fresh pipeline of orders.",
    event_type: "tender",
    impact: "opportunity",
    direction: "up",
    horizon: "months",
    confidence: 0.74,
    sectors: ["energy", "real-estate"],
    region: GUJARAT,
    first_seen: iso(-6 * HOUR),
    is_sample: false,
  }),
];

const PROJECTED = story({
  id: "story:retail-prices-spring",
  kind: "projected",
  headline: "Higher freight costs may lift shelf prices by spring",
  so_what: "Importers usually pass on freight costs within two to three months.",
  event_type: "projected-impact",
  impact: "risk",
  direction: "up",
  horizon: "months",
  confidence: 0.45,
  sectors: ["consumer"],
  region: null,
  first_seen: null,
});

function forecast(partial: Partial<ForecastSummary> & Pick<ForecastSummary, "id" | "short_title" | "question">) {
  const base: ForecastSummary = {
    category: "commodities",
    probability: 0.5,
    change_24h: 0,
    volume: 12_400,
    volume_unit: "MANA",
    liquidity: 2_000,
    thin: false,
    end_date: iso(5 * DAY + 2 * HOUR),
    updated_at: iso(-12 * MIN),
    provider: "manifold",
    provider_name: "Manifold",
    url: null,
    region: null,
    lon: null,
    lat: null,
    sparkline: [],
    is_sample: false,
    ...partial,
  };
  return base;
}

const FORECASTS: ForecastSummary[] = [
  forecast({
    id: "forecast:brent-above-90",
    short_title: "Brent above $90 by year end",
    question: "Will Brent crude settle above $90 a barrel on 31 December?",
    probability: 0.62,
    change_24h: 0.08,
    url: "https://manifold.markets",
    sparkline: wave(30, 0.48, 0.62, 0.03, 2),
  }),
  forecast({
    id: "forecast:suez-transits-recover",
    short_title: "Suez transits recover by March",
    question: "Will weekly Suez Canal transits return to their 2023 average by March?",
    category: "trade",
    probability: 0.31,
    change_24h: -0.03,
    volume: 640,
    thin: true,
    end_date: iso(140 * DAY),
    updated_at: iso(-3 * HOUR),
    sparkline: wave(30, 0.36, 0.31, 0.02, 5),
  }),
  forecast({
    id: "forecast:monsoon-above-normal",
    short_title: "Monsoon finishes above normal",
    question: "Will this year's monsoon rainfall finish above the long-period average?",
    category: "economy",
    probability: 0.71,
    change_24h: 0,
    volume: null,
    volume_unit: null,
    provider: "sample",
    provider_name: "Sample",
    end_date: iso(24 * DAY),
    updated_at: iso(-50 * MIN),
    is_sample: true,
    sparkline: wave(30, 0.6, 0.71, 0.02, 9),
  }),
];

const HISTORY: HistoryPoint[] = wave(60, 0.44, 0.62, 0.035, 3).map((p, i) => ({
  ts: iso(-(59 - i) * 12 * HOUR),
  p: Math.min(0.99, Math.max(0.01, p)),
}));

function kpi(partial: Partial<Kpi> & Pick<Kpi, "id" | "name" | "unit" | "latest" | "higher_is">, series: number[]): Kpi {
  const previous = series[series.length - 2] ?? null;
  return {
    previous,
    change: previous === null ? null : Number((partial.latest - previous).toFixed(2)),
    as_of: new Date(NOW - 2 * DAY).toISOString().slice(0, 10),
    series: series.map((v, i) => ({ d: new Date(NOW - (series.length - i) * 7 * DAY).toISOString().slice(0, 10), v })),
    source_name: "Sample statistics office",
    is_sample: true,
    ...partial,
  };
}

const CPI = wave(24, 3.9, 4.3, 0.12, 1);
CPI.push(4.6);
const DIESEL = wave(24, 95.1, 93, 0.5, 4);
DIESEL.push(92.4);
const PMI = wave(24, 54.8, 56.1, 0.6, 7);
PMI.push(57.2);
const POWER = wave(24, 218, 235, 4, 2);
POWER.push(241);

const KPIS: Kpi[] = [
  kpi({ id: "indicator:in-cpi", name: "Inflation", unit: "%", latest: 4.6, higher_is: "worse" }, CPI),
  kpi({ id: "indicator:in-diesel", name: "Diesel price", unit: "INR/litre", latest: 92.4, higher_is: "worse" }, DIESEL),
  kpi(
    { id: "indicator:in-pmi", name: "Manufacturing PMI", unit: "index", latest: 57.2, higher_is: "better", is_sample: false },
    PMI,
  ),
  kpi({ id: "indicator:in-power", name: "Peak power demand", unit: "GW", latest: 241, higher_is: "neutral" }, POWER),
];

const SOURCES: SourceRef[] = [
  {
    source_name: "Example Shipping News",
    title: "Carriers extend Cape of Good Hope routings into next quarter",
    url: "https://example.com/shipping/cape-routings",
    published_at: iso(-25 * MIN),
  },
  {
    source_name: "Example Business Daily",
    title: "Importers report longer lead times on Europe-bound cargo",
    url: "https://example.com/business/lead-times",
    published_at: iso(-4 * HOUR),
  },
  { source_name: "Example Wire", title: "Freight index rises for a sixth week", url: null, published_at: iso(-1 * DAY) },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <SectionHeader title={title} icon={icon} />
      {children}
    </section>
  );
}

function Swatch({ tone, icon: Icon }: { tone: Tone; icon?: LucideIcon }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", tone.tint, tone.border)}>
        {Icon ? <Icon className={cn("size-4", tone.text)} /> : <span className={cn("size-3 rounded-full", tone.bg)} />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-body text-fg">{tone.label}</p>
        <p className="truncate font-mono text-label text-fg-subtle">{tone.cssVar}</p>
      </div>
    </div>
  );
}

const TYPE_SWATCHES: EntityType[] = ENTITY_TYPES.filter((t) => t !== "story" && t !== "forecast");

const ERROR_EXAMPLES: { label: string; error: Error }[] = [
  { label: "Connector missing", error: new DataError("connector_missing", "Supabase connector not found") },
  { label: "Not allowed", error: new DataError("not_allowed", "The viewer declined the connector") },
  { label: "Unavailable", error: new DataError("unavailable", "Connection timed out", true) },
  { label: "Not found", error: new DataError("server_error", "Not found: story:abc") },
];

/** Every UI-kit component on one page, with realistic example data. */
export default function DesignPreview() {
  const theme = useSettings((s) => s.theme);
  const calm = useSettings((s) => s.calm);
  const update = useSettings((s) => s.update);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [lenses, setLenses] = useState<SectorId[]>(["energy", "logistics-trade"]);
  const [linkType, setLinkType] = useState<LinkType>("inferred");
  const [alerts, setAlerts] = useState(true);
  const [retries, setRetries] = useState(0);
  const resolvedTheme = theme === "system" ? "dark" : theme;

  const toggleLens = (sector: SectorId) =>
    setLenses((current) => (current.includes(sector) ? current.filter((s) => s !== sector) : [...current, sector]));

  return (
    <div className="min-h-full bg-bg text-fg">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-figure font-semibold tracking-tight">Design preview</h1>
            <p className="text-body text-fg-muted">Every component, with example data, in the current theme.</p>
          </div>
          <Segmented
            aria-label="Theme"
            value={resolvedTheme}
            onValueChange={(value) => update({ theme: value })}
            options={[
              { value: "dark", label: "Dark", icon: Moon },
              { value: "light", label: "Light", icon: Sun },
            ]}
          />
        </header>

        {/* Foundations */}
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-2">
            <Section title="Meaning colours" icon={Info}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Swatch tone={IMPACT_TONES.risk} icon={IMPACT_ICONS.risk.icon} />
                <Swatch tone={IMPACT_TONES.opportunity} icon={IMPACT_ICONS.opportunity.icon} />
                <Swatch tone={IMPACT_TONES.neutral} icon={IMPACT_ICONS.neutral.icon} />
                <Swatch tone={FORECAST_TONE} icon={Users} />
              </div>
              <SectionHeader title="Entity types" as="h3" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {TYPE_SWATCHES.map((type) => (
                  <Swatch key={type} tone={ENTITY_TYPE_TONES[type]} icon={ENTITY_TYPE_ICONS[type].icon} />
                ))}
              </div>
            </Section>
          </Card>
          <Card className="p-4">
            <Section title="Type scale">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-figure font-semibold tabular-nums">62%</p>
                  <p className="font-mono text-label text-fg-subtle">text-figure · 26 px</p>
                </div>
                <div>
                  <p className="text-body">Red Sea detours push container rates higher</p>
                  <p className="font-mono text-label text-fg-subtle">text-body · 14 px</p>
                </div>
                <div>
                  <p className="text-label text-fg-muted">Logistics · Egypt · 12 min ago</p>
                  <p className="font-mono text-label text-fg-subtle">text-label · 12 px</p>
                </div>
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <p className="text-body text-fg">Text</p>
                  <p className="text-body text-fg-muted">Muted text</p>
                  <p className="text-body text-fg-subtle">Subtle text</p>
                </div>
              </div>
            </Section>
          </Card>
        </div>

        {/* Icons */}
        <Card className="p-4">
          <Section title="Icons" icon={ListFilter}>
            <div className="flex flex-wrap gap-1.5">
              {SECTOR_IDS.map((sector) => (
                <SectorChip key={sector} sector={sector} size="sm" />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ENTITY_TYPES.map((type) => (
                <EntityChip key={type} size="sm" entity={{ type, name: ENTITY_TYPE_TONES[type].label }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {Object.entries(EVENT_TYPE_ICONS).map(([key, info]) => (
                <span key={key} className="flex items-center gap-2 text-label text-fg-muted">
                  <info.icon aria-hidden className="size-4 shrink-0 text-fg" />
                  <span className="truncate">{eventTypeLabel(key)}</span>
                </span>
              ))}
            </div>
          </Section>
        </Card>

        {/* Controls */}
        <div className="grid gap-6 [&>*]:min-w-0 md:grid-cols-2 xl:grid-cols-3">
          <Card className="p-4">
            <Section title="Chips">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip>Static</Chip>
                <Chip tone="outline">Outline</Chip>
                <Chip tone="forecast">
                  <Users aria-hidden />
                  Crowd
                </Chip>
                <SampleBadge />
              </div>
              <p className="text-label text-fg-muted">Sector lens (toggle)</p>
              <div className="flex flex-wrap gap-1.5">
                {SECTOR_IDS.slice(0, 5).map((sector) => (
                  <SectorChip key={sector} sector={sector} selected={lenses.includes(sector)} onClick={toggleLens} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ChipButton selected={false}>Unselected</ChipButton>
                <ChipButton selected>Selected</ChipButton>
                <ChipButton disabled>Disabled</ChipButton>
              </div>
            </Section>
          </Card>

          <Card className="p-4">
            <Section title="Segmented and switch">
              <Segmented
                aria-label="Time window"
                value={timeWindow}
                onValueChange={setTimeWindow}
                options={TIME_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w].short, ariaLabel: WINDOW_LABELS[w].long }))}
              />
              <Segmented
                size="sm"
                fill
                aria-label="Link type"
                value={linkType}
                onValueChange={setLinkType}
                options={(Object.keys(LINK_TYPES) as LinkType[]).map((t) => ({ value: t, label: LINK_TYPES[t].label }))}
              />
              <div className="flex flex-col divide-y divide-line">
                <SwitchField
                  label="Forecast alerts"
                  description="Tell me when watched odds move 10 points"
                  checked={alerts}
                  onCheckedChange={setAlerts}
                />
                <SwitchField
                  label="Calm motion"
                  description="Stops pulses and glows everywhere"
                  checked={calm}
                  onCheckedChange={(value) => update({ calm: value })}
                />
              </div>
            </Section>
          </Card>

          <Card className="p-4">
            <Section title="Overlays">
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip content="Inferred: our analysis links these; no source states it">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong px-3 text-body hover:bg-surface-2"
                  >
                    <Info aria-hidden className="size-4" />
                    Tooltip
                  </button>
                </Tooltip>
                <Popover>
                  <PopoverTrigger className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 text-body hover:bg-surface-2">
                    <Newspaper aria-hidden className="size-4" />
                    Evidence
                  </PopoverTrigger>
                  <PopoverContent>
                    <p className="mb-1 text-label font-medium text-fg-muted">Why we think so</p>
                    <SourcesList items={SOURCES.slice(0, 2)} />
                  </PopoverContent>
                </Popover>
                <Dialog>
                  <DialogTrigger className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-fg px-3 text-body font-medium text-bg hover:bg-fg/85">
                    Dialog
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Watch this forecast?</DialogTitle>
                      <DialogDescription>We'll show it in your watchlist and flag big moves.</DialogDescription>
                    </DialogHeader>
                    <ForecastRow forecast={FORECASTS[0]} short className="px-0" />
                    <DialogFooter>
                      <DialogClose className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-line-strong px-4 text-body hover:bg-surface-2">
                        Not now
                      </DialogClose>
                      <DialogClose className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-fg px-4 text-body font-medium text-bg hover:bg-fg/85">
                        Watch
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <p className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
                <Search aria-hidden className="size-3.5" /> Search anywhere <KbdCombo keys={["Ctrl", "K"]} /> · close
                <Kbd>Esc</Kbd>
              </p>
              <ScrollArea label="Scroll area example" className="h-32 rounded-lg border border-line">
                <ul className="divide-y divide-line">
                  {STORIES.concat(STORIES).map((s, i) => (
                    <li key={`${s.id}-${i}`} className="truncate px-3 py-2 text-body text-fg-muted">
                      {s.headline}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </Section>
          </Card>
        </div>

        {/* Badges */}
        <div className="grid gap-6 [&>*]:min-w-0 md:grid-cols-2">
          <Card className="p-4">
            <Section title="Impact, horizon, confidence">
              <div className="flex flex-wrap items-center gap-2">
                <ImpactBadge impact="risk" direction="up" />
                <ImpactBadge impact="opportunity" direction="up" />
                <ImpactBadge impact="neutral" />
                <ImpactBadge impact="risk" direction="down" iconOnly />
                <ImpactBadge impact="opportunity" size="md" label="Opportunity for you" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <HorizonChip horizon="now" />
                <HorizonChip horizon="weeks" />
                <HorizonChip horizon="months" />
                <ConfidenceMeter confidence={0.82} />
                <ConfidenceMeter confidence={0.35} />
              </div>
              <div className="flex flex-col gap-2">
                {(Object.keys(LINK_TYPES) as LinkType[]).map((t, i) => (
                  <ConfidenceMeter key={t} confidence={[0.9, 0.65, 0.4, 0.55][i]} linkType={t} />
                ))}
              </div>
              <p className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
                <TimeAgo value={iso(-12 * MIN)} />
                <TimeAgo value={iso(-3 * HOUR)} />
                <TimeAgo value={iso(-2 * DAY)} />
                <TimeAgo value={iso(5 * DAY + HOUR)} />
                <TimeAgo value={iso(-90 * DAY)} prefix="Updated" />
              </p>
            </Section>
          </Card>
          <Card className="p-4">
            <Section title="Entities">
              <div className="flex flex-wrap gap-1.5">
                <EntityChip entity={{ type: "region", name: "Gujarat" }} onClick={() => undefined} />
                <EntityChip entity={{ type: "commodity", name: "Crude oil" }} onClick={() => undefined} />
                <EntityChip entity={{ type: "infrastructure", name: "Mundra Port" }} onClick={() => undefined} />
                <EntityChip entity={{ type: "organization", name: "Port operator" }} onClick={() => undefined} />
                <EntityChip entity={{ type: "policy", name: "Solar PLI scheme" }} onClick={() => undefined} selected />
                <EntityChip entity={{ type: "indicator", name: "Freight index" }} />
                <EntityChip entity={{ type: "person", name: "Trade minister" }} />
                <EntityChip entity={{ type: "user_entity", name: "Your Surat plant" }} />
              </div>
              <div className="flex flex-col gap-1">
                <LinkTypeLabel linkType="reported" />
                <LinkTypeLabel linkType="inferred" />
                <LinkTypeLabel linkType="projected" />
              </div>
            </Section>
          </Card>
        </div>

        {/* Forecasts */}
        <Card className="p-4">
          <Section title="Crowd forecasts" icon={Users}>
            <div className="flex flex-wrap items-end gap-6">
              <ProbabilityRing probability={0.62} change24h={0.08} size="lg" glow label="Brent above $90 by year end" />
              <ProbabilityRing probability={0.62} change24h={0.08} size="md" />
              <ProbabilityRing probability={0.31} change24h={-0.03} size="md" thin />
              <ProbabilityRing probability={0.71} change24h={0} size="sm" />
              <ProbabilityRing probability={0.08} size="sm" />
              <ProbabilityRing probability={0.97} change24h={0.12} size="sm" glow />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProbabilityBar probability={0.62} change24h={0.08} />
              <ProbabilityBar probability={0.31} change24h={-0.03} thin />
              <ProbabilityBar probability={0.71} change24h={0} size="sm" />
              <ProbabilityBar probability={0.04} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-label text-fg-muted">History (hover, or focus and use ← →)</p>
                <ProbabilityHistoryChart points={HISTORY} label="Brent above $90 by year end" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-label text-fg-muted">Step variant, thin market</p>
                <ProbabilityHistoryChart points={HISTORY.slice(20)} label="Suez transits recover" variant="step" thin />
              </div>
            </div>
            <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {FORECASTS.map((f) => (
                <ForecastRow key={f.id} forecast={f} onOpen={() => undefined} />
              ))}
            </div>
          </Section>
        </Card>

        {/* KPIs and sparklines */}
        <Card className="p-4">
          <Section title="KPI tiles" icon={TrendingUp}>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {KPIS.map((k) => (
                <KpiTile key={k.id} kpi={k} onClick={k.id.endsWith("pmi") ? () => undefined : undefined} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Sparkline values={CPI} tone="risk" label="Inflation rising over 24 weeks" className="h-10" />
              <Sparkline values={PMI} tone="opportunity" baseline={PMI[0]} className="h-10" />
              <Sparkline values={FORECASTS[0].sparkline} tone="forecast" domain={[0, 1]} baseline={0.5} className="h-10" />
              <Sparkline values={POWER} className="h-10" />
            </div>
          </Section>
        </Card>

        {/* Stories */}
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div
            className="rounded-2xl p-3"
            style={{
              background:
                "radial-gradient(circle at 70% 30%, var(--globe-land-active) 0 18%, var(--globe-land) 18% 34%, var(--globe-ocean) 34% 100%)",
            }}
          >
            <Card variant="glass" className="flex flex-col gap-1 p-2">
              <div className="px-2 pt-1">
                <SectionHeader
                  title="Top 5 now"
                  as="h3"
                  action={
                    <Segmented
                      size="sm"
                      aria-label="Time window"
                      value={timeWindow}
                      onValueChange={setTimeWindow}
                      options={TIME_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w].short, ariaLabel: WINDOW_LABELS[w].long }))}
                    />
                  }
                />
              </div>
              {STORIES.map((s, i) => (
                <StoryCard key={s.id} story={s} variant="compact" rank={i + 1} onOpen={() => undefined} />
              ))}
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            <StoryCard
              story={STORIES[0]}
              forecast={FORECASTS[0]}
              onOpen={() => undefined}
              onEntityClick={() => undefined}
              onSectorClick={() => undefined}
              onForecastClick={() => undefined}
            />
            <StoryCard story={PROJECTED} />
            <StoryCard story={{ ...STORIES[4], so_what: null, confidence: null }} />
          </div>
        </div>

        {/* Sources and states */}
        <div className="grid gap-6 [&>*]:min-w-0 md:grid-cols-2 xl:grid-cols-3">
          <Card className="p-4">
            <Section title="Sources" icon={Newspaper}>
              <SourcesList items={SOURCES} />
              <SourcesList
                sample
                items={[{ source_name: "Sample feed", title: "Freight rates climb for a sixth week", url: null, published_at: iso(-5 * HOUR) }]}
              />
            </Section>
          </Card>
          <Card className="p-4">
            <Section title="Empty and loading">
              <EmptyState
                compact
                icon={Search}
                title="Nothing in the last 24 hours"
                description="Try a longer window."
                action={{ label: "Show 7 days", onClick: () => setTimeWindow("7d") }}
              />
              <div aria-busy="true" aria-label="Loading example" className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-lg" />
                  <SkeletonText lines={2} className="flex-1" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-20 rounded-lg" />
                  <Skeleton className="h-20 rounded-lg" />
                </div>
              </div>
            </Section>
          </Card>
          <Card className="p-4">
            <Section title="Errors">
              <ScrollArea label="Error examples" className="h-[26rem]">
                <div className="flex flex-col divide-y divide-line">
                  {ERROR_EXAMPLES.map(({ label, error }) => (
                    <div key={label}>
                      <p className="pt-2 text-label text-fg-subtle">{label}</p>
                      <ErrorState compact error={error} onRetry={() => setRetries((n) => n + 1)} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-label text-fg-muted tabular-nums" aria-live="polite">
                Retries pressed: {retries}
              </p>
            </Section>
          </Card>
        </div>

        <Card variant="sunken">
          <CardHeader>
            <CardTitle>Card parts</CardTitle>
          </CardHeader>
          <CardContent className="text-body text-fg-muted">
            Cards come in surface, glass, sunken and plain. Colour is used only for meaning.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
