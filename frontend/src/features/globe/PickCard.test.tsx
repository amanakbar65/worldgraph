import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GLOBE } from "./fixtures";
import { arcPath, type ArcDatum, type GlobeCountry } from "./model";
import { PickContent, type PickContext } from "./PickCard";

afterEach(cleanup);

const context = (countries: GlobeCountry[] = []): PickContext => ({
  sample: "all",
  eventsById: new Map(GLOBE.events.map((e) => [e.id, e])),
  countriesById: new Map(countries.map((c) => [c.id, c])),
});

const arc = (confidence: number): ArcDatum => ({
  ...GLOBE.arcs[0],
  confidence,
  focus: false,
  dim: false,
  path: arcPath(GLOBE.arcs[0].src, GLOBE.arcs[0].dst, 4),
});

describe("globe pick cards", () => {
  it("marks a weak cascade link with a '?'", () => {
    render(<PickContent info={{ kind: "arc", id: "1", x: 0, y: 0, arc: arc(0.4) }} context={context()} />);
    expect(screen.getByRole("img", { name: "Weak link: under 50% sure" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Confidence 40%/ })).toBeTruthy();
  });

  it("leaves links of 50 % or more without the mark", () => {
    render(<PickContent info={{ kind: "arc", id: "1", x: 0, y: 0, arc: arc(0.5) }} context={context()} />);
    expect(screen.queryByRole("img", { name: /Weak link/ })).toBeNull();
  });

  it("shows a country's counts and its lean with ▲ ▼ and words", () => {
    const risky: GlobeCountry = {
      id: "region:ye",
      count: 4,
      risk: 3,
      opportunity: 0,
      neutral: 1,
      score: -0.75,
    };
    const { rerender } = render(
      <PickContent
        info={{ kind: "country", id: "region:ye", x: 0, y: 0, name: "Yemen" }}
        context={context([risky])}
      />,
    );
    expect(screen.getByText("4 events in this window")).toBeTruthy();
    expect(screen.getByText("3 risk")).toBeTruthy();
    expect(screen.getByText("1 neutral")).toBeTruthy();
    expect(screen.getByText("Leans risk").textContent).toBe("▼Leans risk");

    const hopeful: GlobeCountry = {
      id: "region:in",
      count: 2,
      risk: 0,
      opportunity: 2,
      neutral: 0,
      score: 1,
    };
    rerender(
      <PickContent
        info={{ kind: "country", id: "region:in", x: 0, y: 0, name: "India" }}
        context={context([hopeful])}
      />,
    );
    expect(screen.getByText("Leans opportunity").textContent).toBe("▲Leans opportunity");
  });

  it("says a quiet country is quiet", () => {
    render(
      <PickContent
        info={{ kind: "country", id: "region:fr", x: 0, y: 0, name: "France" }}
        context={context()}
      />,
    );
    expect(screen.getByText("Nothing new here in this window")).toBeTruthy();
    expect(screen.queryByText(/Leans/)).toBeNull();
  });
});
