/** The layout as React Flow nodes and edges. */
import type { CascadeModel } from "./cascade-data";
import type { CascadeLayout } from "./cascade-layout";
import type { CascadeFlowEdge } from "./CascadeEdge";
import type { LaneFlowNode, StoryFlowNode } from "./CascadeNodes";

/** Lane boxes underneath, cards on top (links sit between the two). */
export function flowNodes(model: CascadeModel, layout: CascadeLayout): (StoryFlowNode | LaneFlowNode)[] {
  const lanes: LaneFlowNode[] = layout.groups.flatMap((laid) => {
    const group = model.groups.find((g) => g.id === laid.id);
    if (!group) return [];
    return [
      {
        id: laid.id,
        type: "lane" as const,
        position: { x: laid.x, y: laid.y },
        width: laid.width,
        height: laid.height,
        data: { group, laid },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 0,
      },
    ];
  });
  const cards: StoryFlowNode[] = model.nodes.flatMap((node) => {
    const box = layout.nodes.get(node.id);
    if (!box) return [];
    return [
      {
        id: node.id,
        type: "story" as const,
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        data: { node, direction: layout.direction },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 2,
      },
    ];
  });
  return [...lanes, ...cards];
}

export function flowEdges(model: CascadeModel, layout: CascadeLayout): CascadeFlowEdge[] {
  return model.edges.flatMap((edge) => {
    const laid = layout.edges.get(edge.id);
    if (!laid) return [];
    return [
      {
        id: edge.id,
        source: edge.link.src,
        target: edge.link.dst,
        type: "cascade" as const,
        data: { edge, laid, direction: layout.direction },
        focusable: false,
        selectable: false,
        zIndex: 1,
      },
    ];
  });
}
