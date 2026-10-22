import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useNav, type Panel } from "@/state/nav";

import { usePanelFocus } from "./panel-focus";

/** A stand-in for PanelHost: a side panel with a close button and a link to another panel. */
function Host() {
  const panel = useNav((s) => s.panels.at(-1) ?? null);
  const root = useRef<HTMLElement>(null);
  const close = usePanelFocus(panel, root);
  if (!panel) return null;
  return (
    <aside ref={root} aria-label="Details">
      <button ref={close} type="button" onClick={() => useNav.getState().closePanels()}>
        Close panel
      </button>
      <h2>{"id" in panel ? panel.id : panel.kind}</h2>
      <button type="button" onClick={() => useNav.getState().open({ kind: "story", id: "story:b" })}>
        Related story
      </button>
      {panel.kind === "ask" && <input aria-label="Question" autoFocus />}
    </aside>
  );
}

function Page({ panelOnLoad = false }: { panelOnLoad?: boolean }) {
  const open = (panel: Panel) => useNav.getState().open(panel);
  return (
    <main id="main" tabIndex={-1}>
      {!panelOnLoad && (
        <>
          <button type="button" onClick={() => open({ kind: "settings" })}>
            Settings
          </button>
          <button type="button" onClick={() => open({ kind: "ask" })}>
            Ask
          </button>
        </>
      )}
      <Host />
    </main>
  );
}

/** Click a button the way a browser does: it takes focus first. */
function press(name: string) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

beforeEach(() => useNav.setState({ view: "globe", panels: [] }));
afterEach(cleanup);

describe("panel focus", () => {
  it("moves focus into a panel when it opens and back to its opener when it closes", () => {
    render(<Page />);
    press("Settings");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close panel" }));
    press("Close panel");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  });

  it("keeps the first opener through links inside the panel, and Escape-style closes", () => {
    render(<Page />);
    press("Settings");
    press("Related story");
    expect(screen.getByRole("heading").textContent).toBe("story:b");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close panel" }));
    act(() => useNav.getState().back());
    act(() => useNav.getState().back());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  });

  it("lets a panel that focuses its own field keep it", () => {
    render(<Page />);
    press("Ask");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Question" }));
  });

  it("goes to the main content, not <body>, when the opener has gone", () => {
    render(<Page />);
    press("Settings");
    screen.getByRole("button", { name: "Settings" }).remove();
    press("Close panel");
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("leaves focus alone for a panel already open on page load", () => {
    useNav.setState({ panels: [{ kind: "settings" }] });
    render(<Page panelOnLoad />);
    expect(document.activeElement).toBe(document.body);
  });
});
