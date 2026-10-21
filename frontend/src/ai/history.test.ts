import { describe, expect, it } from "vitest";

import { clip, MAX_TURN_ANSWER, MAX_TURN_QUESTION, MAX_TURNS, parseHistory, trimHistory } from "./history";

describe("conversation history", () => {
  it("keeps the last six turns, each trimmed, and drops empty ones", () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({
      question: `  Question ${i}?  `,
      answer: `- Point ${i}`,
    }));
    turns.splice(4, 0, { question: "   ", answer: "- orphan" });
    const kept = trimHistory(turns);
    expect(kept).toHaveLength(MAX_TURNS);
    expect(kept[0]).toEqual({ question: "Question 3?", answer: "- Point 3" });
    expect(kept.at(-1)).toEqual({ question: "Question 8?", answer: "- Point 8" });
  });

  it("cuts long text at a word, within the limits, keeping line breaks", () => {
    const long = trimHistory([{ question: "why ".repeat(200), answer: "- word ".repeat(400) }])[0];
    expect(long.question.length).toBeLessThanOrEqual(MAX_TURN_QUESTION);
    expect(long.answer.length).toBeLessThanOrEqual(MAX_TURN_ANSWER);
    expect(long.question.endsWith("…")).toBe(true);
    expect(clip("- one\n\n   - two  ", 100)).toBe("- one\n- two");
  });

  it("checks history from a request: at most six short {question, answer} turns", () => {
    expect(parseHistory(undefined)).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory([{ question: " Oil? ", answer: " - Up. " }])).toEqual([
      { question: "Oil?", answer: "- Up." },
    ]);
    expect(parseHistory("nope")).toBeNull();
    expect(
      parseHistory(Array.from({ length: MAX_TURNS + 1 }, () => ({ question: "q", answer: "a" }))),
    ).toBeNull();
    expect(parseHistory([{ question: "q" }])).toBeNull();
    expect(parseHistory([{ question: "", answer: "a" }])).toBeNull();
    expect(parseHistory([{ question: "q".repeat(MAX_TURN_QUESTION + 1), answer: "a" }])).toBeNull();
    expect(parseHistory([{ question: "q", answer: "a".repeat(MAX_TURN_ANSWER + 1) }])).toBeNull();
    expect(parseHistory([["q", "a"]])).toBeNull();
  });
});
