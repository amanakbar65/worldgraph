import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GraphLegend } from "./GraphLegend";

afterEach(cleanup);

/** How a key row's swatch line is drawn: its pattern and colour class. */
function swatch(label: string) {
  const row = within(screen.getByRole("list", { name: "Kinds of link" })).getByText(label);
  const line = row.closest("li")?.querySelector("svg line");
  return { dash: line?.getAttribute("stroke-dasharray") ?? "solid", stroke: line?.getAttribute("class") ?? "" };
}

describe("GraphLegend", () => {
  it("draws every link type differently, by pattern as well as colour", () => {
    render(<GraphLegend types={["organization"]} linkTypes={["reported", "inferred", "projected", "conditional"]} />);
    const looks = ["Reported", "Inferred", "Projected", "Conditional"].map(swatch);
    expect(new Set(looks.map((l) => l.dash)).size).toBe(4);
    expect(swatch("Conditional").stroke).toContain("stroke-forecast");
    expect(swatch("Projected").stroke).toContain("stroke-fg-muted");
  });
});
