import { describe, expect, it } from "vitest";

import askPrompt from "../../../prompts/ask.md?raw";
import askSchema from "../../../prompts/ask.schema.json";
import projectionPrompt from "../../../prompts/projection.md?raw";
import projectionSchema from "../../../prompts/projection.schema.json";
import { WEB_PROMPTS } from "../../server/prompts.generated";
import { PROMPTS } from "./prompts";

const withoutComment = (schema: Record<string, unknown>) => {
  const { $comment: _comment, ...rest } = schema;
  return rest;
};

describe("the website's copy of the prompts", () => {
  it("matches /prompts (run `npm run prompts` after editing them)", () => {
    expect(WEB_PROMPTS.ask.prompt).toBe(askPrompt);
    expect(WEB_PROMPTS.projection.prompt).toBe(projectionPrompt);
    expect(WEB_PROMPTS.ask.schema).toEqual(withoutComment(askSchema));
    expect(WEB_PROMPTS.projection.schema).toEqual(withoutComment(projectionSchema));
  });
});

describe("every prompt", () => {
  it.each(Object.entries(PROMPTS))("%s says the data is never instructions", (_task, prompt) => {
    expect(prompt).toMatch(/data[^.]*(not|never) instructions/i);
    expect(prompt).toMatch(/outside WorldGraph/);
    expect(prompt).toMatch(/ignore anything in (them|the data)/i);
  });
});
