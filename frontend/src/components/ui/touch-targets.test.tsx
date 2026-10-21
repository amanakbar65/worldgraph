import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { ChipButton } from "./chip";
import { Segmented } from "./segmented";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Tap areas reach 40 px at phone width. jsdom has no layout, so this checks
 * the classes that do it: a min width, and an absolutely placed ::before
 * layer that reaches past a compact control's edges (the browser check is
 * test-results/fix:a11y/targets.mjs).
 */
const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe("touch targets", () => {
  it("segments are at least 40 px wide and 40 px tall to the touch, at both sizes", () => {
    render(
      <>
        <Segmented aria-label="Steps" value="1" onValueChange={() => {}} options={["1", "2", "3"].map((v) => ({ value: v, label: v }))} />
        <Segmented
          aria-label="Window"
          size="sm"
          value="7d"
          onValueChange={() => {}}
          options={[
            { value: "24h", label: "24 h" },
            { value: "7d", label: "7 d" },
          ]}
        />
      </>,
    );
    const md = screen.getByRole("radio", { name: "1" });
    const sm = screen.getByRole("radio", { name: "7 d" });
    for (const item of [md, sm]) {
      expect(classes(item)).toEqual(expect.arrayContaining(["relative", "min-w-10", "before:absolute", "before:inset-x-0"]));
    }
    // md: 34 px segment + 2 × 3 px; sm: 26 px segment + 2 × 7 px.
    expect(classes(md)).toContain("before:-inset-y-[3px]");
    expect(classes(sm)).toContain("before:-inset-y-[7px]");
  });

  it("small buttons and chips reach 40 px", () => {
    render(
      <>
        <Button size="sm">Show all 10</Button>
        <ChipButton>All</ChipButton>
      </>,
    );
    const button = screen.getByRole("button", { name: "Show all 10" });
    expect(classes(button)).toEqual(expect.arrayContaining(["h-8", "relative", "before:absolute", "before:-inset-y-1"]));
    const chip = screen.getByRole("button", { name: "All" });
    expect(classes(chip)).toEqual(expect.arrayContaining(["min-w-10", "before:h-10"]));
  });
});
