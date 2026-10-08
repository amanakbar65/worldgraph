import { afterEach, describe, expect, it, vi } from "vitest";

import { __testing, AiError, getAiEngine, runAi } from "./engine";
import { AskAnswer } from "./schemas";

afterEach(() => {
  vi.unstubAllGlobals();
  __testing.reset();
});

describe("AI engine", () => {
  it("uses the website's AI function outside claude.ai", async () => {
    const engine = await getAiEngine();
    expect(engine.kind).toBe("api");
  });

  it("validates replies and rejects ones that don't fit", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { status: "maybe" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await runAi("ask", {}, AskAnswer).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("invalid");
  });

  it("reports a missing AI function as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const error = await runAi("ask", {}, AskAnswer).catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("unavailable");
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
