import { describe, expect, it } from "vitest";

import { projectionElements, shapeCascade } from "./cascade-data";
import { flowPath, groupGeometry, layoutCascade, midpoint, neighbour, SIZES } from "./cascade-layout";
import { CASCADE, FOCUS_ID } from "./fixtures";

const model = shapeCascade(CASCADE);
const centreX = (b: { x: number; width: number }) => b.x + b.width / 2;
const centreY = (b: { y: number; height: number }) => b.y + b.height / 2;

describe("layoutCascade (left to right)", () => {
  const layout = layoutCascade(model, "LR");

  it("places every story", () => {
    expect(layout.nodes.size).toBe(model.nodes.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("puts causes left of the story and effects right, one column per step", () => {
    const x = (id: string) => centreX(layout.nodes.get(id)!);
    const focus = x(FOCUS_ID);
    expect(x("story:red-sea-attacks-reroute")).toBeLessThan(focus);
    expect(x("story:brent-multi-month-high")).toBe(x("story:red-sea-attacks-reroute"));
    expect(x("story:rotterdam-congestion")).toBeGreaterThan(focus);
    expect(x("story:europe-retail-restock-delays")).toBeGreaterThan(x("story:rotterdam-congestion"));
    // Columns leave room for a link label between the cards.
    const focusBox = layout.nodes.get(FOCUS_ID)!;
    const cause = layout.nodes.get("story:red-sea-attacks-reroute")!;
    const effect = layout.nodes.get("story:rotterdam-congestion")!;
    expect(focusBox.x - (cause.x + cause.width)).toBeGreaterThanOrEqual(SIZES.label.width);
    expect(effect.x - (focusBox.x + focusBox.width)).toBeGreaterThanOrEqual(SIZES.label.width);
  });

  it("makes the focus card bigger", () => {
    const focus = layout.nodes.get(FOCUS_ID)!;
    expect(focus.width).toBe(SIZES.focus.width);
    expect(layout.nodes.get("story:rotterdam-congestion")!.width).toBe(SIZES.node.width);
  });

  it("never lets cards in a column overlap", () => {
    for (const depth of [-1, 1]) {
      const column = [...layout.nodes.values()].filter((n) => n.depth === depth).sort((a, b) => a.y - b.y);
      for (let i = 1; i < column.length; i++) {
        expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + column[i - 1].height);
      }
    }
  });

  it("stacks If YES above If NO inside one lane box", () => {
    expect(layout.groups).toHaveLength(1);
    const [group] = layout.groups;
    const yes = layout.nodes.get("story:freight-rates-ease-on-return")!;
    const no = layout.nodes.get("story:surcharges-persist")!;
    expect(yes.y).toBeLessThan(no.y);
    expect(centreX(yes)).toBeCloseTo(centreX(group), 0);
    for (const card of [yes, no]) {
      expect(card.x).toBeGreaterThanOrEqual(group.x);
      expect(card.x + card.width).toBeLessThanOrEqual(group.x + group.width);
      expect(card.y).toBeGreaterThanOrEqual(group.y);
      expect(card.y + card.height).toBeLessThanOrEqual(group.y + group.height);
    }
    // Each lane holds its own card, below its header.
    const [yesLane, noLane] = group.sections;
    expect(yes.y).toBeGreaterThanOrEqual(yesLane.y + SIZES.group.header);
    expect(no.y).toBeGreaterThanOrEqual(noLane.y + SIZES.group.header);
    expect(noLane.y).toBeGreaterThanOrEqual(yesLane.y + yesLane.height);
  });

  it("routes links with a label slot between columns", () => {
    const direct = layout.edges.get("link-176")!;
    expect(direct.label).not.toBeNull();
    const focus = layout.nodes.get(FOCUS_ID)!;
    const rotterdam = layout.nodes.get("story:rotterdam-congestion")!;
    expect(direct.label!.x).toBeGreaterThan(focus.x + focus.width);
    expect(direct.label!.x).toBeLessThan(rotterdam.x);
    // A link that skips a column bends around it.
    const skip = layout.edges.get("link-130")!;
    expect(skip.points.length).toBeGreaterThan(direct.points.length);
  });

  it("is deterministic", () => {
    const again = layoutCascade(model, "LR");
    expect([...again.nodes.values()]).toEqual([...layout.nodes.values()]);
  });

  it("puts AI projections in their own lane next to the other effects", () => {
    const withAi = shapeCascade(
      CASCADE,
      projectionElements(
        FOCUS_ID,
        [
          {
            headline: "Air freight demand may rise for urgent parts",
            so_what: "Manufacturers would pay more to fly components.",
            impact: "risk",
            direction: "up",
            sectors: ["logistics-trade"],
            region_id: null,
            mechanism: "shifts urgent cargo",
            lag_days: 10,
            confidence: 0.4,
          },
        ],
        [],
      ),
    );
    const laid = layoutCascade(withAi, "LR");
    const ai = laid.nodes.get("ai-projection:1")!;
    expect(centreX(ai)).toBeCloseTo(centreX(laid.nodes.get("story:rotterdam-congestion")!), 0);
    expect(laid.groups).toHaveLength(2);
  });
});

describe("layoutCascade (top to bottom, phones)", () => {
  const layout = layoutCascade(model, "TB");

  it("puts causes above the story and effects below", () => {
    const y = (id: string) => centreY(layout.nodes.get(id)!);
    expect(y("story:red-sea-attacks-reroute")).toBeLessThan(y(FOCUS_ID));
    expect(y("story:rotterdam-congestion")).toBeGreaterThan(y(FOCUS_ID));
    expect(y("story:europe-retail-restock-delays")).toBeGreaterThan(y("story:rotterdam-congestion"));
  });
});

describe("groupGeometry", () => {
  it("sizes a lane box from its sections", () => {
    const [group] = model.groups;
    const shape = groupGeometry(group);
    expect(shape.width).toBe(SIZES.node.width + 2 * SIZES.group.padding);
    expect(shape.sections).toHaveLength(2);
    expect(shape.height).toBeGreaterThan(2 * (SIZES.group.header + SIZES.node.height));
  });
});

describe("neighbour (arrow keys)", () => {
  const layout = layoutCascade(model, "LR");

  it("moves along the flow to the nearest card in the next step", () => {
    const right = neighbour(layout, FOCUS_ID, "ArrowRight");
    expect(layout.nodes.get(right!)?.depth).toBe(1);
    expect(layout.nodes.get(neighbour(layout, FOCUS_ID, "ArrowLeft")!)?.depth).toBe(-1);
    expect(neighbour(layout, "story:red-sea-attacks-reroute", "ArrowLeft")).toBeNull();
    expect(neighbour(layout, "story:europe-retail-restock-delays", "ArrowRight")).toBeNull();
  });

  it("moves across the flow within a step", () => {
    const column = [...layout.nodes.values()].filter((n) => n.depth === 1).sort((a, b) => a.y - b.y);
    expect(neighbour(layout, column[0].id, "ArrowDown")).toBe(column[1].id);
    expect(neighbour(layout, column[1].id, "ArrowUp")).toBe(column[0].id);
    expect(neighbour(layout, column[0].id, "ArrowUp")).toBeNull();
  });

  it("swaps axes in the vertical layout", () => {
    const tb = layoutCascade(model, "TB");
    expect(tb.nodes.get(neighbour(tb, FOCUS_ID, "ArrowDown")!)?.depth).toBe(1);
    expect(tb.nodes.get(neighbour(tb, FOCUS_ID, "ArrowUp")!)?.depth).toBe(-1);
  });
});

describe("flowPath", () => {
  it("draws S-curves through the bend points", () => {
    const d = flowPath({ x: 0, y: 0 }, { x: 200, y: 100 }, [{ x: 100, y: 40 }], "LR");
    expect(d.startsWith("M0,0")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith("200,100")).toBe(true);
  });

  it("swings out for links that point back", () => {
    const d = flowPath({ x: 200, y: 0 }, { x: 0, y: 0 }, [], "LR");
    expect(d).toContain("C248,0");
  });

  it("finds the middle of a path", () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toEqual({ x: 50, y: 0 });
    expect(midpoint({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: 40, y: 10 }])).toEqual({ x: 40, y: 10 });
  });
});
