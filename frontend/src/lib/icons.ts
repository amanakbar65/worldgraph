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
  ArrowRight,
  Briefcase,
  BriefcaseBusiness,
  Building,
  Building2,
  CalendarDays,
  ChartColumn,
  ChartLine,
  CircleAlert,
  CircleDot,
  ClipboardList,
  CloudLightning,
  Cog,
  Coins,
  Construction,
  Container,
  Cpu,
  Factory,
  Gauge,
  Gavel,
  GitFork,
  Globe,
  HardHat,
  Hash,
  HeartPulse,
  KeyRound,
  Landmark,
  Layers,
  Link,
  ListTree,
  MapPin,
  Megaphone,
  Minus,
  Newspaper,
  Package,
  PackageOpen,
  Plug,
  Scale,
  ScrollText,
  ShieldAlert,
  Ship,
  ShoppingBag,
  Sparkles,
  Sprout,
  Swords,
  Tag,
  Target,
  Telescope,
  Thermometer,
  Truck,
  Type,
  TrendingUpDown,
  UserRound,
  Users,
  UtilityPole,
  Wheat,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { EntityType, Impact, PropertyKind, SectorId } from "@/api/contract";

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

/** Forecasts are crowd estimates, never facts: they always wear the crowd icon. */
export const FORECAST_ICON: IconInfo = { icon: Users, name: "users" };
export const FORECAST_ICON_LABEL = "crowd";

// ---------------------------------------------------------------------------
// Relations and properties (the graph schema, Phase A)
// ---------------------------------------------------------------------------

/**
 * One icon per named relation, as `types.yaml` names them (api.schema sends
 * the same names). The offline fallback when the schema hasn't loaded.
 */
export const RELATION_ICONS: Record<string, IconInfo> = {
  located_in: { icon: MapPin, name: "map-pin" },
  part_of: { icon: ListTree, name: "list-tree" },
  owns: { icon: KeyRound, name: "key-round" },
  subsidiary_of: { icon: GitFork, name: "git-fork" },
  produces: { icon: Factory, name: "factory" },
  exports_to: { icon: Ship, name: "ship" },
  imports_from: { icon: PackageOpen, name: "package-open" },
  depends_on: { icon: Plug, name: "plug" },
  member_of: { icon: Users, name: "users" },
  competes_with: { icon: Swords, name: "swords" },
  in_sector: { icon: Tag, name: "tag" },
  mentions: { icon: Newspaper, name: "newspaper" },
  about: { icon: Target, name: "target" },
  relates_to: { icon: Link, name: "link" },
  supplies: { icon: Truck, name: "truck" },
  operates: { icon: Cog, name: "cog" },
  regulates: { icon: Scale, name: "scale" },
  drives: { icon: ArrowRight, name: "arrow-right" },
};

/** For relations not in RELATION_ICONS. In JSX: `(RELATION_ICONS[key] ?? DEFAULT_RELATION_ICON).icon`. */
export const DEFAULT_RELATION_ICON: IconInfo = { icon: Link, name: "link" };

/** The icon for a relation (non-JSX code): the schema's icon name when known, else by key, else a plain link. */
export function relationIcon(key: string | null | undefined, iconName?: string | null): LucideIcon {
  return (iconName && BY_NAME[iconName]) || (key && RELATION_ICONS[key]?.icon) || Link;
}

/** One icon per kind of property value (entity and place values show their node's type icon instead). */
export const PROPERTY_KIND_ICONS: Record<PropertyKind, IconInfo> = {
  text: { icon: Type, name: "type" },
  number: { icon: Hash, name: "hash" },
  date: { icon: CalendarDays, name: "calendar-days" },
  choice: { icon: Tag, name: "tag" },
  url: { icon: Globe, name: "globe" },
  place: { icon: MapPin, name: "map-pin" },
  entity: { icon: Link, name: "link" },
};

/** Properties whose meaning has a better icon than their kind's. */
const PROPERTY_KEY_ICONS: Record<string, LucideIcon> = {
  sector: Layers,
  sectors: Layers,
  headquarters: MapPin,
  size: Users,
  founded: CalendarDays,
  website: Globe,
  ticker: ChartLine,
  unit: Hash,
  benchmark: ChartLine,
  hs_code: Hash,
  issuer: Landmark,
  status: Activity,
  scope: MapPin,
  kind: Tag,
  capacity: Gauge,
  operator: Cog,
  frequency: CalendarDays,
  source: Newspaper,
  role: Briefcase,
  organization: Building,
};

/** The icon of a property chip: by its key when it has its own, else by kind. */
export function propertyIcon(key: string, kind: PropertyKind): LucideIcon {
  return PROPERTY_KEY_ICONS[key] ?? PROPERTY_KIND_ICONS[kind]?.icon ?? CircleDot;
}

// ---------------------------------------------------------------------------
// By name (for icons named in the database, e.g. api.meta sectors)
// ---------------------------------------------------------------------------

const BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  [
    ...Object.values(SECTORS),
    ...Object.values(ENTITY_TYPE_ICONS),
    ...Object.values(EVENT_TYPE_ICONS),
    ...Object.values(IMPACT_ICONS),
    ...Object.values(RELATION_ICONS),
    ...Object.values(PROPERTY_KIND_ICONS),
    FORECAST_ICON,
    DEFAULT_EVENT_ICON,
  ].map((info) => [info.name, info.icon]),
);

/** Look up a lucide icon by its kebab-case name; unknown names get a dot. */
export function iconByName(name: string | null | undefined): LucideIcon {
  return (name && BY_NAME[name]) || CircleDot;
}
