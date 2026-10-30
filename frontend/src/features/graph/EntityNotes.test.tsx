import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __testing as storage } from "@/platform/storage";
import { notesValue } from "@/state/notes";
import { __testing as undoStore } from "@/state/undo";

import { EntityNotes } from "./EntityNotes";
import { fakeQuery } from "./test-utils";

vi.mock("@/api/client", () => ({ useRpc: () => fakeQuery({ results: [] }) }));

const box = () => screen.getByRole("textbox", { name: "Your note on Crude oil" }) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  storage.reset();
  undoStore.reset();
  notesValue.reset();
});
afterEach(cleanup);

describe("EntityNotes undo and redo", () => {
  it("undoes a saved note from the page, puts it back with redo, and survives a reload", async () => {
    localStorage.setItem("worldgraph.user.notes", JSON.stringify({ "commodity:crude-oil": "Watch Brent" }));
    const view = render(<EntityNotes id="commodity:crude-oil" name="Crude oil" onOpen={() => {}} />);
    await waitFor(() => expect(box().value).toBe("Watch Brent"));
    expect(screen.getByRole("button", { name: "Nothing to undo in this note" })).toBeTruthy();

    fireEvent.change(box(), { target: { value: "Watch Brent and WTI" } });
    fireEvent.blur(box()); // saves at once
    await act(async () => {
      await Promise.resolve();
    });
    const undoButton = await screen.findByRole("button", { name: "Undo note on Crude oil" });

    fireEvent.click(undoButton);
    await waitFor(() => expect(box().value).toBe("Watch Brent"));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("worldgraph.user.notes") ?? "{}")).toEqual({ "commodity:crude-oil": "Watch Brent" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Redo note on Crude oil" }));
    await waitFor(() => expect(box().value).toBe("Watch Brent and WTI"));

    // A reload: the list comes back from storage, so the edit can still be undone.
    await undoStore.saved();
    view.unmount();
    storage.reset();
    undoStore.reset();
    notesValue.reset();
    render(<EntityNotes id="commodity:crude-oil" name="Crude oil" onOpen={() => {}} />);
    await waitFor(() => expect(box().value).toBe("Watch Brent and WTI"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo note on Crude oil" }));
    await waitFor(() => expect(box().value).toBe("Watch Brent"));
  });
});
