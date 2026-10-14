import { useMemo } from "react";

import type { EntityType } from "@/api/contract";
import { useNav } from "@/state/nav";

/** Where taps in the forecasts view and panel lead. */
export function useForecastNav() {
  const open = useNav((s) => s.open);
  const flyTo = useNav((s) => s.flyTo);
  return useMemo(
    () => ({
      openForecast: (id: string) => open({ kind: "forecast", id }),
      openStory: (id: string) => open({ kind: "story", id }),
      /** Places open their panel (and fly the globe there); other entities open their page. */
      openEntity: (entity: { id?: string; type: EntityType }) => {
        if (!entity.id) return;
        if (entity.type === "region") {
          open({ kind: "region", id: entity.id });
          flyTo({ regionId: entity.id });
        } else if (entity.type === "story") open({ kind: "story", id: entity.id });
        else if (entity.type === "forecast") open({ kind: "forecast", id: entity.id });
        else open({ kind: "entity", id: entity.id });
      },
    }),
    [open, flyTo],
  );
}
