import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "./Header";
import { NAV_ITEMS } from "./nav-items";

vi.mock("@/api/client", async () => {
  const { create } = await import("zustand");
  return {
    useConnection: create(() => ({ state: { status: "live", source: "http" } })),
    useRpc: () => ({ data: undefined, isLoading: true, error: null, isPlaceholderData: false }),
  };
});

beforeEach(() => {
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
});

describe("Header", () => {
  it("names every screen, with labels shown only where they fit (icons alone below xl)", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "Screens" });
    for (const item of NAV_ITEMS) {
      const button = within(nav).getByRole("button", { name: item.label });
      expect(button.getAttribute("title")).toBe(item.label);
      expect(button.className).toContain("whitespace-nowrap");
      expect(within(button).getByText(item.label).className).toBe("sr-only xl:not-sr-only");
    }
  });

  it("keeps search, Ask and Settings in a group that never shrinks", () => {
    render(<Header />);
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings.parentElement?.className).toContain("shrink-0");
    expect(screen.getByRole("button", { name: /^Search places/ }).parentElement).toBe(settings.parentElement);
  });
});

describe("Header logo", () => {
  afterEach(cleanup);

  it("is Home everywhere: back to the globe and asks the globe to fly home", async () => {
    const { useNav } = await import("@/state/nav");
    const { useUi } = await import("@/state/ui");
    useUi.setState({ homePending: false });
    render(<Header />);
    screen.getByRole("button", { name: "WorldGraph home" }).click();
    expect(useNav.getState().view).toBe("globe");
    expect(useUi.getState().homePending).toBe(true);
  });
});
