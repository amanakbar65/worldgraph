import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNav } from "@/state/nav";

import { PanelHost } from "./PanelHost";

vi.mock("./registry", () => ({
  PANEL_COMPONENTS: new Proxy({}, { get: () => () => <p>Panel body</p> }),
  WIDE_PANELS: new Set(["cascade", "compare"]),
}));

beforeEach(() => {
  // jsdom has no scrolling.
  HTMLElement.prototype.scrollTo = () => {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: /min-width: 768px/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useNav.setState({ panels: [] });
});

describe("PanelHost on a desktop", () => {
  it("makes the full-width panels opaque, so the globe's controls don't show through", () => {
    useNav.setState({ view: "globe", panels: [{ kind: "cascade", id: "story:a" }] });
    render(<PanelHost />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(aside.className).toContain("bg-surface");
    expect(aside.className).not.toContain("bg-glass");
    expect(aside.className).toContain("inset-3");
  });

  it("keeps the glass look on the side panel", () => {
    useNav.setState({ view: "globe", panels: [{ kind: "story", id: "story:a" }] });
    render(<PanelHost />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(aside.className).toContain("bg-glass");
  });
});
