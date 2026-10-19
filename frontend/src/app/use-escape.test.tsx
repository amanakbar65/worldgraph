import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNav } from "@/state/nav";

import { useEscapeClosesPanel } from "./use-escape";

function Screen() {
  useEscapeClosesPanel();
  return (
    <div>
      <Popover>
        <PopoverTrigger>Sector lens</PopoverTrigger>
        <PopoverContent>
          <button type="button">Energy</button>
        </PopoverContent>
      </Popover>
      <input aria-label="Notes" />
    </div>
  );
}

const forecast = { kind: "forecast", id: "forecast:panama-draft-limits-lifted" } as const;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useNav.setState({ view: "forecasts", panels: [forecast] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Escape", () => {
  it("closes the open panel", () => {
    render(<Screen />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useNav.getState().panels).toEqual([]);
  });

  it("only closes a popover when that is what it dismissed, and the panel on the next press", async () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "Sector lens" }));
    const inside = await screen.findByRole("button", { name: "Energy" });
    await act(async () => {
      fireEvent.keyDown(inside, { key: "Escape" });
    });
    expect(screen.queryByRole("button", { name: "Energy" })).toBeNull();
    expect(useNav.getState().panels).toEqual([forecast]);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useNav.getState().panels).toEqual([]);
  });

  it("leaves an Escape typed in a field alone", () => {
    render(<Screen />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "Escape" });
    expect(useNav.getState().panels).toEqual([forecast]);
  });

  it("ignores other keys", () => {
    render(<Screen />);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(useNav.getState().panels).toEqual([forecast]);
  });
});
