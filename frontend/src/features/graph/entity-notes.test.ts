import { describe, expect, it } from "vitest";

import { cleanNotes, NOTE_MAX, noteChanged, noteFor, noteLinks, NOTES_MAX, savedWhere, withNote } from "./entity-notes";

describe("cleanNotes", () => {
  it("keeps id → text pairs and drops anything else", () => {
    expect(cleanNotes(null)).toEqual({});
    expect(cleanNotes(["x"])).toEqual({});
    expect(
      cleanNotes({ "commodity:crude-oil": "Watch Brent", "Not an id": "x", "region:in": 3, "org:acme": "   " }),
    ).toEqual({ "commodity:crude-oil": "Watch Brent" });
  });
});

describe("noteFor", () => {
  it("reads one entity's note, or nothing", () => {
    const notes = { "commodity:crude-oil": "Watch Brent" };
    expect(noteFor(notes, "commodity:crude-oil")).toBe("Watch Brent");
    expect(noteFor(notes, "region:in")).toBe("");
    expect(noteFor(undefined, "region:in")).toBe("");
  });
});

describe("withNote", () => {
  it("adds and changes a note without touching the others", () => {
    const one = withNote({}, "commodity:crude-oil", "Watch Brent");
    expect(one).toEqual({ "commodity:crude-oil": "Watch Brent" });
    const two = withNote(one, "region:in", "Monsoon risk");
    expect(two).toEqual({ "commodity:crude-oil": "Watch Brent", "region:in": "Monsoon risk" });
    expect(withNote(two, "commodity:crude-oil", "Watch WTI too")["region:in"]).toBe("Monsoon risk");
  });

  it("removes a note that is emptied", () => {
    expect(withNote({ "region:in": "x", "org:acme": "y" }, "region:in", "  \n ")).toEqual({ "org:acme": "y" });
  });

  it("cuts a long note", () => {
    expect(withNote({}, "region:in", "a".repeat(NOTE_MAX + 50))["region:in"]).toHaveLength(NOTE_MAX);
  });

  it("moves the edited note last and lets the oldest go past the cap", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < NOTES_MAX; i++) many[`region:r${i}`] = `note ${i}`;
    const next = withNote(many, "region:new", "fresh");
    const keys = Object.keys(next);
    expect(keys).toHaveLength(NOTES_MAX);
    expect(keys.at(-1)).toBe("region:new");
    expect(next["region:r0"]).toBeUndefined();
    expect(next["region:r1"]).toBe("note 1");
  });
});

describe("noteChanged", () => {
  it("is false when the text is what's stored (so nothing is saved)", () => {
    const notes = { "region:in": "Monsoon risk" };
    expect(noteChanged(notes, "region:in", "Monsoon risk")).toBe(false);
    expect(noteChanged(notes, "region:in", "Monsoon risk!")).toBe(true);
    expect(noteChanged(notes, "org:acme", "")).toBe(false);
    expect(noteChanged(notes, "region:in", "   ")).toBe(true);
  });
});

describe("noteLinks", () => {
  it("finds [[links]] in order, once each, up to a limit", () => {
    expect(noteLinks("Check [[Crude oil]] and [[ Mundra  Port ]], then [[crude OIL]].")).toEqual(["Crude oil", "Mundra Port"]);
    expect(noteLinks("[[a]] [[ ]] [[unclosed and [[nested]]")).toEqual(["nested"]);
    expect(noteLinks("[[One]] [[Two]] [[Three]]", 2)).toEqual(["One", "Two"]);
    expect(noteLinks("no links here")).toEqual([]);
  });
});

describe("savedWhere", () => {
  it("says where the note lives, in plain words", () => {
    expect(savedWhere("cloud")).toMatch(/Claude account/);
    expect(savedWhere("browser")).toMatch(/this browser/);
    expect(savedWhere("memory")).toMatch(/this visit only/);
    expect(savedWhere(null)).toBe("Private to you.");
  });
});
