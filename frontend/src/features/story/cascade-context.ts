import { createContext, useContext, type KeyboardEvent } from "react";

import type { CascadeNode } from "./cascade-data";
import type { FlowDirection } from "./cascade-layout";

/** What the flow's cards and links share: hover, keyboard focus and taps. */
export interface CascadeUi {
  direction: FlowDirection;
  /** The card that takes Tab (roving focus); arrow keys move it. */
  activeNode: string;
  /** The card under the pointer or keyboard focus; its links light up. */
  hotNode: string | null;
  /** The link under the pointer or focus. */
  hotEdge: string | null;
  /** The link whose evidence is open. */
  selectedEdge: string | null;
  /** Some cards are sample data and some aren't: mark the sample ones. */
  mixedSample: boolean;
  /** Id of the hidden "arrow keys move between stories" hint. */
  hintId: string;
  setActiveNode: (id: string) => void;
  setHotNode: (id: string | null) => void;
  setHotEdge: (id: string | null) => void;
  openNode: (node: CascadeNode) => void;
  openEvidence: (edgeId: string) => void;
  onNodeKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
  openForecast: (id: string) => void;
}

export const CascadeUiContext = createContext<CascadeUi | null>(null);

export function useCascadeUi(): CascadeUi {
  const ui = useContext(CascadeUiContext);
  if (!ui) throw new Error("useCascadeUi needs a CascadeUiContext provider");
  return ui;
}
