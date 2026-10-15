import { describe, expect, it } from "vitest";

import type { AskAnswer } from "@/ai/schemas";

import {
  chainSteps,
  citedStories,
  cleanFollowUps,
  cleanQuestion,
  compactContext,
  inSentence,
  isAskable,
  isEmptyContext,
  mainTopic,
  notEnoughEvidence,
  shapeAnswer,
  suggestionsFor,
} from "./ask-data";
import {
  BRENT,
  CONTEXT,
  DRAFT,
  EMPTY_CONTEXT,
  JET_FUEL,
  L_BRENT_JET,
  L_JET_SURCHARGE,
  OPEC_FORECAST,
  SURCHARGE,
} from "./fixtures";

const answer = (partial: Partial<AskAnswer> = {}): AskAnswer => ({
  status: "answered",
  bullets: [{ text: "Brent is up on tighter supply.", cite: [BRENT.id] }],
  cascade: [],
  forecasts: [],
  follow_up: [],
  ...partial,
});

describe("the question", () => {
  it("collapses spaces, trims and caps at 300 characters", () => {
    expect(cleanQuestion("  What's   driving\n fuel costs?  ")).toBe("What's driving fuel costs?");
    expect(cleanQuestion("x".repeat(400))).toHaveLength(300);
  });

  it("needs at least three characters", () => {
    expect(isAskable("  ab ")).toBe(false);
    expect(isAskable("Oil")).toBe(true);
  });
});

describe("compactContext", () => {
  const compact = compactContext(CONTEXT);

  it("keeps each story's id, headline, so-what, region, first seen, source names and actions", () => {
    expect(compact.stories[0]).toEqual({
      id: BRENT.id,
      headline: BRENT.headline,
      so_what: BRENT.so_what,
      region: "London",
      first_seen: BRENT.first_seen,
      sources: ["Sample Wire", "Sample Daily"],
      actions: ["Lock in fuel contracts early"],
    });
  });

  it("sends no URLs, snippets, coordinates or sparklines", () => {
    const text = JSON.stringify(compact);
    expect(text).not.toContain("https://");
    expect(text).not.toContain("snippet");
    expect(text).not.toContain("sparkline");
    expect(text).not.toContain('"lon"');
  });

  it("never sends a so-what or actions for drafts the AI hasn't analysed", () => {
    const draft = compact.stories.find((s) => s.id === DRAFT.id)!;
    expect(draft.so_what).toBeNull();
    expect(draft.actions).toEqual([]);
    expect(draft.headline).toBe(DRAFT.headline);
  });

  it("keeps links between stories in the context, with type, mechanism and rounded confidence", () => {
    expect(compact.links).toEqual([
      { from: BRENT.id, to: JET_FUEL.id, type: "reported", mechanism: "lifts jet fuel prices", confidence: 0.85 },
      { from: JET_FUEL.id, to: SURCHARGE.id, type: "projected", mechanism: "pushes up fares", confidence: 0.45 },
    ]);
  });

  it("keeps each forecast's id, title, probability, provider, volume, unit and update time", () => {
    expect(compact.forecasts[0]).toEqual({
      id: OPEC_FORECAST.id,
      short_title: OPEC_FORECAST.short_title,
      probability: 0.62,
      provider: "Manifold",
      volume: 52_341,
      unit: "MANA",
      updated_at: OPEC_FORECAST.updated_at,
    });
    expect(compact.forecasts[1]).toMatchObject({ volume: 58_000, unit: null, provider: "Sample forecast" });
  });

  it("caps source names at four and skips blanks", () => {
    const many = {
      ...CONTEXT,
      stories: [
        {
          ...BRENT,
          sources: ["A", " ", "B", "C", "A", "D", "E"].map((source_name) => ({
            source_name,
            title: "t",
            url: null,
            published_at: null,
          })),
        },
      ],
    };
    expect(compactContext(many).stories[0].sources).toEqual(["A", "B", "C", "D"]);
  });

  it("knows when there is nothing to cite", () => {
    expect(isEmptyContext(EMPTY_CONTEXT)).toBe(true);
    expect(isEmptyContext({ ...EMPTY_CONTEXT, forecasts: [OPEC_FORECAST] })).toBe(true);
    expect(isEmptyContext(CONTEXT)).toBe(false);
  });
});

describe("shapeAnswer: citations", () => {
  it("removes citations of stories that aren't in the context", () => {
    const shaped = shapeAnswer(
      answer({ bullets: [{ text: "Brent is up.", cite: [BRENT.id, "story:made-up", BRENT.id] }] }),
      CONTEXT,
    );
    expect(shaped.bullets).toHaveLength(1);
    expect(shaped.bullets[0].cites.map((s) => s.id)).toEqual([BRENT.id]);
    expect(shaped.dropped).toBe(1);
  });

  it("drops a bullet left with no citation", () => {
    const shaped = shapeAnswer(
      answer({
        bullets: [
          { text: "Invented point.", cite: ["story:not-here"] },
          { text: "Jet fuel is up.", cite: [JET_FUEL.id] },
        ],
      }),
      CONTEXT,
    );
    expect(shaped.bullets.map((b) => b.text)).toEqual(["Jet fuel is up."]);
  });

  it("becomes 'not enough evidence' when no bullet survives", () => {
    const shaped = shapeAnswer(
      answer({
        bullets: [{ text: "Invented.", cite: ["story:nope"] }],
        cascade: [{ from: BRENT.id, to: JET_FUEL.id, mechanism: "lifts fuel prices" }],
        forecasts: [OPEC_FORECAST.id],
        follow_up: ["What moves jet fuel?"],
      }),
      CONTEXT,
    );
    expect(shaped.status).toBe("not_enough_evidence");
    expect(shaped.bullets).toEqual([]);
    expect(shaped.cascade).toEqual([]);
    expect(shaped.forecasts).toEqual([]);
    expect(shaped.followUps).toEqual(["What moves jet fuel?"]);
  });

  it("keeps the model's 'not enough evidence' even with bullets", () => {
    expect(shapeAnswer(answer({ status: "not_enough_evidence" }), CONTEXT).status).toBe("not_enough_evidence");
  });

  it("keeps at most three bullets", () => {
    const bullets = Array.from({ length: 3 }, (_, i) => ({ text: `Point ${i}`, cite: [BRENT.id] }));
    const shaped = shapeAnswer(answer({ bullets: [...bullets, { text: "Extra", cite: [BRENT.id] }] }), CONTEXT);
    expect(shaped.bullets).toHaveLength(3);
  });

  it("lists cited stories once, in order of first citation", () => {
    const shaped = shapeAnswer(
      answer({
        bullets: [
          { text: "a", cite: [JET_FUEL.id, BRENT.id] },
          { text: "b", cite: [BRENT.id, SURCHARGE.id] },
        ],
      }),
      CONTEXT,
    );
    expect(citedStories(shaped).map((s) => s.id)).toEqual([JET_FUEL.id, BRENT.id, SURCHARGE.id]);
  });
});

describe("shapeAnswer: cascade and forecasts", () => {
  it("keeps only steps that are stored links, with the stored link (type and confidence)", () => {
    const shaped = shapeAnswer(
      answer({
        cascade: [
          { from: BRENT.id, to: JET_FUEL.id, mechanism: "model words here" },
          { from: "story:made-up", to: BRENT.id, mechanism: "invented link here" },
          { from: JET_FUEL.id, to: BRENT.id, mechanism: "wrong way round" },
          { from: JET_FUEL.id, to: SURCHARGE.id, mechanism: "pushes up fares" },
        ],
      }),
      CONTEXT,
    );
    expect(shaped.cascade).toHaveLength(1);
    expect(shaped.cascade[0].nodes.map((n) => n.id)).toEqual([BRENT.id, JET_FUEL.id, SURCHARGE.id]);
    expect(shaped.cascade[0].links).toEqual([L_BRENT_JET, L_JET_SURCHARGE]);
    expect(shaped.dropped).toBe(2);
  });

  it("keeps only forecasts from the context, at most two", () => {
    const shaped = shapeAnswer(
      answer({ forecasts: ["forecast:not-real", OPEC_FORECAST.id, OPEC_FORECAST.id] }),
      CONTEXT,
    );
    expect(shaped.forecasts.map((f) => f.id)).toEqual([OPEC_FORECAST.id]);
    expect(shaped.dropped).toBe(1);
  });

  it("joins steps into chains only where one starts where the last ended", () => {
    const chains = chainSteps([
      { from: BRENT, to: JET_FUEL, link: L_BRENT_JET },
      { from: BRENT, to: SURCHARGE, link: L_JET_SURCHARGE },
    ]);
    expect(chains.map((c) => c.nodes.map((n) => n.id))).toEqual([
      [BRENT.id, JET_FUEL.id],
      [BRENT.id, SURCHARGE.id],
    ]);
  });
});

describe("follow-ups", () => {
  it("drops repeats (ignoring case), the question just asked and too-short items; keeps three", () => {
    expect(
      cleanFollowUps(["What next?", "what next?", "ok", "What moves oil?", "Who gains?", "Fourth one?"], [
        "What moves OIL?",
      ]),
    ).toEqual(["What next?", "Who gains?", "Fourth one?"]);
  });

  it("'not enough evidence' without AI carries cleaned follow-ups", () => {
    expect(notEnoughEvidence(["  Why?  ", "Why?"])).toMatchObject({
      status: "not_enough_evidence",
      followUps: ["Why?"],
      dropped: 0,
    });
  });
});

describe("suggested questions", () => {
  it("defaults to four questions, led by the viewer's sector when a profile has one", () => {
    expect(suggestionsFor(null)).toHaveLength(4);
    expect(suggestionsFor(null)[0]).toBe("What's driving fuel costs in India?");
    expect(suggestionsFor(null, ["agri-food"])[0]).toBe("What's changing for agri and food businesses?");
  });

  it("names the region, and its busiest sector when known", () => {
    const qs = suggestionsFor({ id: "region:in-gj", type: "region", name: "Gujarat", sector: "energy" });
    expect(qs).toHaveLength(4);
    expect(qs).toContain("How is energy doing in Gujarat?");
    expect(qs.every((q) => q.includes("Gujarat"))).toBe(true);
  });

  it("asks about a commodity as a common noun", () => {
    expect(suggestionsFor({ id: "commodity:crude-oil", type: "commodity", name: "Crude oil" })[0]).toBe(
      "What's driving crude oil prices?",
    );
  });

  it("asks about a story's main topic and place, never its long headline", () => {
    const qs = suggestionsFor({
      id: BRENT.id,
      type: "story",
      name: BRENT.headline,
      place: "India",
      topic: { name: "Crude oil", type: "commodity" },
    });
    expect(qs).toEqual([
      "What's driving crude oil?",
      "What could happen next for crude oil?",
      "How could crude oil affect India?",
    ]);
  });

  it("falls back to the defaults for a story with no topic or place", () => {
    expect(suggestionsFor({ id: BRENT.id, type: "story", name: BRENT.headline })).toEqual(suggestionsFor(null));
  });

  it("keeps acronyms as they are mid-sentence", () => {
    expect(inSentence("GDP", "indicator")).toBe("GDP");
    expect(inSentence("Crude oil", "commodity")).toBe("crude oil");
    expect(inSentence("Reserve Bank of India", "organization")).toBe("Reserve Bank of India");
  });

  it("picks a commodity over a policy or company as the main topic", () => {
    expect(
      mainTopic([
        { name: "India", type: "region" },
        { name: "Heronshore", type: "organization" },
        { name: "Crude oil", type: "commodity" },
      ]),
    ).toEqual({ name: "Crude oil", type: "commodity" });
    expect(mainTopic([{ name: "India", type: "region" }])).toBeNull();
  });
});
