/**
 * One icon set (lucide) for sectors, entity types, event types, impacts and
 * forecasts. Every colour in the app travels with one of these icons, so
 * meaning never depends on colour alone.
 *
 * In JSX, read `.icon` off the records (`SECTORS[id].icon`): the React lint
 * rejects rendering a component returned by a function call. The helper
 * functions are for non-JSX code (map layers, canvas, tests).
 */
import {
  Activity,
  ArrowLeftRight,
  Briefcase,
  BriefcaseBusiness,
  Building,
  Building2,
  ChartColumn,
  ChartLine,
  CircleAlert,
  CircleDot,
  ClipboardList,
  CloudLightning,
  Coins,
  Construction,
  Container,
  Cpu,
  Factory,
  Gauge,
  Gavel,
  HardHat,
  HeartPulse,
  Landmark,
  Layers,
  MapPin,
  Megaphone,
  Minus,
  Newspaper,
  Package,
  ScrollText,
  ShieldAlert,
  Ship,
  ShoppingBag,
  Sparkles,
  Sprout,
  Telescope,
  Thermometer,
  Truck,
  TrendingUpDown,
  UserRound,
  Users,
  UtilityPole,
  Wheat,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { EntityType, Impact, SectorId } from "@/api/contract";

/** An icon plus its lucide name (kebab case, as stored in the database). */
export interface IconInfo {
  icon: LucideIcon;
  name: string;
}

// ---------------------------------------------------------------------------
// Sectors
// ---------------------------------------------------------------------------

export interface SectorInfo extends IconInfo {
  /** Readable label, e.g. "Agri and food". */
  label: string;
}

/** The nine sectors, in the contract's fixed order. Names match `sectors.yaml`. */
export const SECTORS: Record<SectorId, SectorInfo> = {
  energy: { icon: Zap, name: "zap", label: "Energy" },
  "agri-food": { icon: Wheat, name: "wheat", label: "Agri and food" },
  manufacturing: { icon: Factory, name: "factory", label: "Manufacturing" },
  "logistics-trade": { icon: Ship, name: "ship", label: "Logistics and trade" },
  finance: { icon: Landmark, name: "landmark", label: "Finance" },
  tech: { icon: Cpu, name: "cpu", label: "Tech" },
  health: { icon: HeartPulse, name: "heart-pulse", label: "Health" },
  "real-estate": { icon: Building2, name: "building-2", label: "Real estate" },
  consumer: { icon: ShoppingBag, name: "shopping-bag", label: "Consumer" },
};

export function sectorIcon(id: SectorId): LucideIcon {
  return SECTORS[id]?.icon ?? CircleDot;
}

export function sectorLabel(id: SectorId): string {
  return SECTORS[id]?.label ?? id;
}

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

/** One icon per node type, the same on the globe, in the graph and on chips. */
export const ENTITY_TYPE_ICONS: Record<EntityType, IconInfo> = {
  region: { icon: MapPin, name: "map-pin" },
  organization: { icon: Building, name: "building" },
  person: { icon: UserRound, name: "user-round" },
  commodity: { icon: Package, name: "package" },
  sector: { icon: Layers, name: "layers" },
  infrastructure: { icon: UtilityPole, name: "utility-pole" },
  policy: { icon: ScrollText, name: "scroll-text" },
  indicator: { icon: Gauge, name: "gauge" },
  story: { icon: Newspaper, name: "newspaper" },
  forecast: { icon: Users, name: "users" },
  user_entity: { icon: BriefcaseBusiness, name: "briefcase-business" },
};

export function entityTypeIcon(type: EntityType): LucideIcon {
  return ENTITY_TYPE_ICONS[type]?.icon ?? CircleDot;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Event types used by the pipeline, the sample data and the analysis prompt.
 * Unknown types fall back to {@link DEFAULT_EVENT_ICON}.
 */
export const EVENT_TYPE_ICONS: Record<string, IconInfo> = {
  "price-move": { icon: ChartLine, name: "chart-line" },
  "market-shift": { icon: TrendingUpDown, name: "trending-up-down" },
  "economic-data": { icon: ChartColumn, name: "chart-column" },
  "business-sentiment": { icon: Thermometer, name: "thermometer" },
  policy: { icon: ScrollText, name: "scroll-text" },
  "policy-decision": { icon: Gavel, name: "gavel" },
  "policy-signal": { icon: Megaphone, name: "megaphone" },
  "trade-flow": { icon: ArrowLeftRight, name: "arrow-left-right" },
  "supply-chain": { icon: Container, name: "container" },
  logistics: { icon: Truck, name: "truck" },
  disruption: { icon: Construction, name: "construction" },
  "extreme-weather": { icon: CloudLightning, name: "cloud-lightning" },
  hazard: { icon: Activity, name: "activity" },
  conflict: { icon: ShieldAlert, name: "shield-alert" },
  "company-update": { icon: Briefcase, name: "briefcase" },
  investment: { icon: Coins, name: "coins" },
  labour: { icon: HardHat, name: "hard-hat" },
  tender: { icon: ClipboardList, name: "clipboard-list" },
  "crop-conditions": { icon: Sprout, name: "sprout" },
  "projected-impact": { icon: Telescope, name: "telescope" },
};

export const DEFAULT_EVENT_ICON: IconInfo = { icon: Newspaper, name: "newspaper" };

/** Accepts "price-move", "Price move" or "price_move". */
export function eventTypeIcon(eventType: string | null | undefined): LucideIcon {
  return eventTypeInfo(eventType).icon;
}

export function eventTypeInfo(eventType: string | null | undefined): IconInfo {
  return EVENT_TYPE_ICONS[eventTypeKey(eventType)] ?? DEFAULT_EVENT_ICON;
}

/** The lookup key for an event type: lowercase, words joined by hyphens. */
export function eventTypeKey(eventType: string | null | undefined): string {
  return (eventType ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** "price-move" → "Price move". */
export function eventTypeLabel(eventType: string): string {
  const words = eventType.trim().replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Impact and forecasts
// ---------------------------------------------------------------------------

export const IMPACT_ICONS: Record<Impact, IconInfo> = {
  risk: { icon: CircleAlert, name: "circle-alert" },
  opportunity: { icon: Sparkles, name: "sparkles" },
  neutral: { icon: Minus, name: "minus" },
};

export function impactIcon(impact: Impact): LucideIcon {
  return IMPACT_ICONS[impact]?.icon ?? Minus;
}

/** Forecasts are crowd odds, never facts: they always wear the crowd icon. */
export const FORECAST_ICON: IconInfo = { icon: Users, name: "users" };
export const FORECAST_ICON_LABEL = "crowd";

// ---------------------------------------------------------------------------
// By name (for icons named in the database, e.g. api.meta sectors)
// ---------------------------------------------------------------------------

const BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  [
    ...Object.values(SECTORS),
    ...Object.values(ENTITY_TYPE_ICONS),
    ...Object.values(EVENT_TYPE_ICONS),
    ...Object.values(IMPACT_ICONS),
    FORECAST_ICON,
    DEFAULT_EVENT_ICON,
  ].map((info) => [info.name, info.icon]),
);

/** Look up a lucide icon by its kebab-case name; unknown names get a dot. */
export function iconByName(name: string | null | undefined): LucideIcon {
  return (name && BY_NAME[name]) || CircleDot;
}
