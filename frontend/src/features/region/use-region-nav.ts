import { useMemo } from "react";

import type { EntityType, SectorId } from "@/api/contract";
import { useNav } from "@/state/nav";

/** Where taps in the region panel and Compare lead. */
export function useRegionNav() {
  const open = useNav((s) => s.open);
  const replace = useNav((s) => s.replace);
  const flyTo = useNav((s) => s.flyTo);
  const toggleSector = useNav((s) => s.toggleSector);
  const setView = useNav((s) => s.setView);
  return useMemo(() => {
    const openRegion = (id: string) => {
      open({ kind: "region", id });
      flyTo({ regionId: id });
    };
    return {
      openRegion,
      openStory: (id: string) => open({ kind: "story", id }),
      openForecast: (id: string) => open({ kind: "forecast", id }),
      /** Indicators and other entities open their own page. */
      openEntityPage: (id: string) => open({ kind: "entity", id }),
      /** Any graph node: places fly the globe there; stories and forecasts open their own panels. */
      openNode: (node: { id: string; type: EntityType }) => {
        if (node.type === "region") openRegion(node.id);
        else if (node.type === "story") open({ kind: "story", id: node.id });
        else if (node.type === "forecast") open({ kind: "forecast", id: node.id });
        else open({ kind: "entity", id: node.id });
      },
      openCompare: (ids: string[]) => open({ kind: "compare", ids }),
      /** Change which regions Compare shows, in place (keeps Back tidy). */
      setCompare: (ids: string[]) => replace({ kind: "compare", ids }),
      ask: (scope: string) => open({ kind: "ask", scope }),
      toggleSector: (sector: SectorId) => toggleSector(sector),
      showForecasts: () => setView("forecasts"),
    };
  }, [open, replace, flyTo, toggleSector, setView]);
}

export type RegionNav = ReturnType<typeof useRegionNav>;
