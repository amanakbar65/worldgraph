import { useMemo } from "react";

import type { EntityType, RelationDirection } from "@/api/contract";
import { useNav, type Panel } from "@/state/nav";

import { useGraphState } from "./graph-state";

/** The panel a node opens: places, stories and forecasts have their own; everything else is an entity page. */
export function panelFor(node: { id: string; type: EntityType }): Panel {
  switch (node.type) {
    case "region":
      return { kind: "region", id: node.id };
    case "story":
      return { kind: "story", id: node.id };
    case "forecast":
      return { kind: "forecast", id: node.id };
    default:
      return { kind: "entity", id: node.id };
  }
}

/** Where taps on the graph and on entity pages lead. */
export function useGraphNav() {
  const open = useNav((s) => s.open);
  const setView = useNav((s) => s.setView);
  const flyTo = useNav((s) => s.flyTo);
  return useMemo(
    () => ({
      openNode: (node: { id: string; type: EntityType }) => open(panelFor(node)),
      openStory: (id: string) => open({ kind: "story", id }),
      openForecast: (id: string) => open({ kind: "forecast", id }),
      openEntity: (id: string) => open({ kind: "entity", id }),
      /** The graph screen, around this node. */
      showInGraph: (node: { id: string; name: string }, depth: 1 | 2 | 3 = 2) => {
        useGraphState.getState().showAround(node, depth);
        setView("graph");
      },
      /**
       * The graph around this node, showing only links of one relation in
       * one direction (an entity page's "See all" for a connection group).
       */
      showRelationInGraph: (node: { id: string; name: string }, relation: string, direction: RelationDirection) => {
        const graph = useGraphState.getState();
        graph.setRelations([relation]);
        graph.setDirection(direction);
        graph.showAround(node, 1);
        setView("graph");
      },
      /** The globe, flown to this point. */
      showOnMap: (lon: number, lat: number) => {
        setView("globe");
        flyTo({ lon, lat, zoom: 4 });
      },
      /** The globe, flown to this place, with its panel open (a place-valued property). */
      showPlaceOnMap: (regionId: string) => {
        setView("globe");
        open({ kind: "region", id: regionId });
        flyTo({ regionId });
      },
      ask: (scope: string) => open({ kind: "ask", scope }),
      openBusiness: () => setView("business"),
      openForecasts: () => setView("forecasts"),
    }),
    [open, setView, flyTo],
  );
}

export type GraphNav = ReturnType<typeof useGraphNav>;
