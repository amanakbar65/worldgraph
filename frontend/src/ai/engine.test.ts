import { describe, expect, it } from "vitest";

import { AiError, getAiEngine, runAi } from "./engine";
import { AskAnswer } from "./schemas";

describe("AI engine", () => {
  it("is unavailable outside claude.ai until an engine is wired in", async () => {
    const engine = await getAiEngine();
    expect(engine.kind).toBe("none");
    await expect(runAi("ask", {}, AskAnswer)).rejects.toBeInstanceOf(AiError);
  });

  it("validates Ask answers", () => {
    const ok = AskAnswer.safeParse({
      status: "answered",
      bullets: [{ text: "Freight rates rose after ships avoided the Red Sea.", cite: ["story:a"] }],
      cascade: [{ from: "story:a", to: "story:b", mechanism: "longer shipping routes" }],
      forecasts: [],
      follow_up: ["Which ports are most exposed?"],
    });
    expect(ok.success).toBe(true);
    const uncited = AskAnswer.safeParse({
      status: "answered",
      bullets: [{ text: "Unsupported claim.", cite: [] }],
      cascade: [],
      forecasts: [],
      follow_up: [],
    });
    expect(uncited.success).toBe(false);
  });
});
