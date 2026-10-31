import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useNav } from "@/state/nav";

import { WhyButton, WhyMark } from "./WhyButton";

const top = () => useNav.getState().panels.at(-1);

afterEach(() => {
  cleanup();
  useNav.setState({ panels: [] });
});

describe("ways into Why is this here?", () => {
  it("a weak item's '?' is the button, and it opens the sheet on top of the panel", () => {
    useNav.setState({ panels: [{ kind: "entity", id: "infra:jebel-ali-port" }] });
    render(<WhyMark target="edge" id={41} subject="Jebel Ali Port, operated by, DP World" link weak />);
    const button = screen.getByRole("button", {
      name: "Why is this link here? Jebel Ali Port, operated by, DP World. Weak: under 50% sure, or no source.",
    });
    expect(button.textContent).toBe("?");
    // 24 px to the eye, 40 px to the touch.
    expect(button.className).toEqual(expect.stringContaining("size-6"));
    expect(button.className).toEqual(expect.stringContaining("before:-inset-2"));
    fireEvent.click(button);
    expect(useNav.getState().panels).toEqual([
      { kind: "entity", id: "infra:jebel-ali-port" },
      { kind: "why", target: "edge", id: "41" },
    ]);
  });

  it("an item that isn't weak gets a quiet info mark instead of '?'", () => {
    render(<WhyMark target="node" id="org:dp-world" subject="DP World" />);
    const button = screen.getByRole("button", { name: "Why is DP World here?" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("the card button says the question and what it is about", () => {
    render(<WhyButton target="link" id={7} subject="Ships reroute, leads to, Rates jump" weak />);
    const button = screen.getByRole("button", {
      name: "Why is this here? Ships reroute, leads to, Rates jump. Weak: under 50% sure, or no source.",
    });
    expect(button.textContent).toBe("?Why is this here?");
    fireEvent.click(button);
    expect(top()).toEqual({ kind: "why", target: "link", id: "7" });
  });
});
