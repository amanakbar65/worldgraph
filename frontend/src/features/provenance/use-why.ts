import { useFlag } from "@/lib/flags";
import { useNav, whyPanel } from "@/state/nav";

import type { ProvenanceTarget } from "./provenance-data";

/** Open "Why is this here?" for a node, an edge or a causal link (as a panel: Back returns). */
export function useOpenWhy(): (target: ProvenanceTarget, id: string | number) => void {
  const open = useNav((s) => s.open);
  return (target, id) => open(whyPanel(target, id));
}

/** Is "Why is this here?" available (kg.provenance on)? */
export function useWhyAvailable(): boolean {
  return useFlag("kg.provenance");
}
