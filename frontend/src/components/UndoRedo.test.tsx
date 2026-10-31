import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __testing as storage } from "@/platform/storage";
import { notesValue, saveNote } from "@/state/notes";
import { __testing as profileStore } from "@/state/profile";
import { __testing as undoStore, touching, useUndo } from "@/state/undo";

import { UndoRedoButtons, UndoShortcuts } from "./UndoRedo";

const notes = () => notesValue.store.getState().value;

async function edit(id: string, name: string, text: string) {
  await act(async () => {
    saveNote(id, name, text);
    await Promise.resolve();
  });
}

beforeEach(async () => {
  localStorage.clear();
  undoStore.reset();
  profileStore.reset();
  notesValue.reset();
  storage.reset();
  await notesValue.store.getState().refresh();
});
afterEach(cleanup);

describe("UndoShortcuts", () => {
  it("undoes with Ctrl/Cmd+Z and redoes with Shift, and says so politely", async () => {
    render(<UndoShortcuts />);
    await edit("org:acme", "Acme", "Ring them");

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(notes()).toEqual({}));
    const region = screen.getByTestId("undo-announcer");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent?.trim()).toBe("Undone: note on Acme");

    fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(notes()).toEqual({ "org:acme": "Ring them" }));
    expect(region.textContent?.trim()).toBe("Redone: note on Acme");
  });

  it("leaves typing alone: a text field keeps its own undo", async () => {
    render(
      <>
        <UndoShortcuts />
        <textarea aria-label="Note" />
        <input aria-label="Search" type="search" />
        <input aria-label="Confidence" type="range" />
      </>,
    );
    await edit("org:acme", "Acme", "Ring them");
    fireEvent.keyDown(screen.getByLabelText("Note"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "z", metaKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(notes()).toEqual({ "org:acme": "Ring them" });
    // A slider isn't a text field.
    fireEvent.keyDown(screen.getByLabelText("Confidence"), { key: "z", ctrlKey: true });
    await waitFor(() => expect(notes()).toEqual({}));
  });
});

describe("UndoRedoButtons", () => {
  it("name what they would undo and redo, and act on their own scope", async () => {
    render(<UndoRedoButtons scope={touching("notes", "org:acme")} noun="this note" />);
    expect(screen.getByRole("button", { name: "Nothing to undo in this note" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Nothing to redo in this note" }).hasAttribute("disabled")).toBe(true);

    await edit("org:acme", "Acme", "Ring them");
    await edit("org:other", "Other", "Not this one");
    fireEvent.click(screen.getByRole("button", { name: "Undo note on Acme" }));
    await waitFor(() => expect(notes()).toEqual({ "org:other": "Not this one" }));
    expect(useUndo.getState().message?.text).toBe("Undone: note on Acme");

    fireEvent.click(screen.getByRole("button", { name: "Redo note on Acme" }));
    await waitFor(() => expect(notes()).toEqual({ "org:other": "Not this one", "org:acme": "Ring them" }));
    expect(screen.getByRole("group", { name: "Undo and redo this note" })).toBeTruthy();
  });
});
