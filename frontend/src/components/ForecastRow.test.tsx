import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { forecast } from "@/features/forecasts/fixtures";

import { ForecastRow } from "./ForecastRow";

afterEach(cleanup);

const FED = forecast({
  id: "forecast:fed-cuts-next-meeting",
  short_title: "Fed cuts at its next meeting?",
  thin: true,
  url: "https://manifold.markets/example",
  provider_name: "Manifold",
});

/** The footer's facts: each one line of words with its own separator. */
function facts() {
  const footer = screen.getByText(/volume$/).closest(".flex-wrap") as HTMLElement;
  return [...footer.children] as HTMLElement[];
}

describe("ForecastRow footer", () => {
  it("keeps each fact's words together, each with its own hidden separator", () => {
    render(<ForecastRow forecast={FED} short />);
    const items = facts();
    expect(items.map((el) => el.textContent?.replace(/^·/, "").trim())).toEqual([
      "Thin market",
      "50K volume",
      expect.stringMatching(/^Ends /),
      expect.stringMatching(/^Updated /),
      "Source: Manifold",
      expect.stringMatching(/^Open on Manifold/),
    ]);
    for (const item of items) {
      expect(item.className).toContain("whitespace-nowrap");
      // The separator leads the fact (so it can be clipped at a line start) and is not read out.
      const dot = item.firstElementChild as HTMLElement;
      expect(dot.textContent).toBe("·");
      expect(dot.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("still shows source, volume and last update (information only)", () => {
    render(<ForecastRow forecast={FED} />);
    expect(screen.getByText("Source: Manifold")).toBeTruthy();
    expect(screen.getByText("50K volume")).toBeTruthy();
    expect(screen.getByText(/^Updated /)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open on Manifold/ }).getAttribute("href")).toBe(FED.url);
  });
});
