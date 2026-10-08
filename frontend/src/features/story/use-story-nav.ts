import { useMemo } from "react";

import type { EntityType } from "@/api/contract";
import { useNav } from "@/state/nav";

/** Where taps in the story card and cascade lead. */
export function useStoryNav() {
  const open = useNav((s) => s.open);
  const replace = useNav((s) => s.replace);
  const flyTo = useNav((s) => s.flyTo);
  return useMemo(
    () => ({
      openStory: (id: string) => open({ kind: "story", id }),
      /** From the cascade: show that story's card in place of the flow. */
      replaceWithStory: (id: string) => replace({ kind: "story", id }),
      openCascade: (id: string) => open({ kind: "cascade", id }),
      openForecast: (id: string) => open({ kind: "forecast", id }),
      openRegion: (id: string) => {
        open({ kind: "region", id });
        flyTo({ regionId: id });
      },
      /** Any entity chip: regions fly the globe there, stories and forecasts open their own panels. */
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
    [open, replace, flyTo],
  );
}
