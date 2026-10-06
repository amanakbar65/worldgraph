import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { Panel, View } from "@/state/nav";

/**
 * Which component renders each screen and panel. Each feature folder owns
 * its components; this file only wires them up (and code-splits them).
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const VIEW_COMPONENTS: Record<View, Lazy<object>> = {
  globe: lazy(() => import("@/features/globe/GlobeView")),
  graph: lazy(() => import("@/features/graph/GraphView")),
  forecasts: lazy(() => import("@/features/forecasts/ForecastsView")),
  opportunities: lazy(() => import("@/features/opportunities/OpportunitiesView")),
  business: lazy(() => import("@/features/business/BusinessView")),
  brief: lazy(() => import("@/features/brief/BriefView")),
};

type PanelProps<K extends Panel["kind"]> = { panel: Extract<Panel, { kind: K }> };

export const PANEL_COMPONENTS: { [K in Panel["kind"]]: Lazy<PanelProps<K>> } = {
  region: lazy(() => import("@/features/region/RegionPanel")),
  compare: lazy(() => import("@/features/region/ComparePanel")),
  story: lazy(() => import("@/features/story/StoryPanel")),
  cascade: lazy(() => import("@/features/story/CascadePanel")),
  entity: lazy(() => import("@/features/graph/EntityPanel")),
  forecast: lazy(() => import("@/features/forecasts/ForecastPanel")),
  ask: lazy(() => import("@/features/ask/AskPanel")),
  settings: lazy(() => import("@/features/settings/SettingsPanel")),
};

/** Panels that need the full width (the cascade flow). */
export const WIDE_PANELS: ReadonlySet<Panel["kind"]> = new Set(["cascade", "compare"]);
