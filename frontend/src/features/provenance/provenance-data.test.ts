import { describe, expect, it } from "vitest";

import { showsWeak } from "@/lib/meaning";
import { whyPanel } from "@/state/nav";

import { EDGE_PROVENANCE, NODE_PROVENANCE, WEAK_LINK_PROVENANCE } from "./fixtures";
import {
  KIND_WORDS,
  originSource,
  provenanceArgs,
  provenanceSources,
  updatedSinceAdded,
  whyLabel,
} from "./provenance-data";

describe("provenance data", () => {
  it("asks the api with node ids as they are and edge or link ids as numbers", () => {
    expect(provenanceArgs(whyPanel("node", "org:dp-world"))).toEqual({ target: "node", id: "org:dp-world" });
    expect(provenanceArgs(whyPanel("edge", 5326))).toEqual({ target: "edge", id: 5326 });
    expect(provenanceArgs(whyPanel("link", "12"))).toEqual({ target: "link", id: 12 });
  });

  it("lists sources the way SourcesList shows them, sample ones marked", () => {
    expect(provenanceSources(EDGE_PROVENANCE)).toEqual([
      {
        source_name: "Example Business Daily",
        url: "https://example.com/ports/jebel-ali",
        published_at: "2026-10-20T08:00:00Z",
        title: "Gulf port operator adds berths",
        snippet: "The operator runs the port under a long-term concession.",
        is_sample: false,
      },
    ]);
    expect(provenanceSources({ ...EDGE_PROVENANCE, is_sample: true })[0]!.is_sample).toBe(true);
  });

  it("names the source dataset only when the sources don't already", () => {
    expect(originSource(EDGE_PROVENANCE)?.name).toBe("WorldGraph curated");
    expect(originSource(NODE_PROVENANCE)).toBeNull();
    expect(originSource(WEAK_LINK_PROVENANCE)).toBeNull();
  });

  it("says when it changed only if that was after it was added", () => {
    expect(updatedSinceAdded(EDGE_PROVENANCE)).toBe(true);
    expect(updatedSinceAdded(WEAK_LINK_PROVENANCE)).toBe(false);
    expect(updatedSinceAdded({ created_at: "2026-10-30T05:20:04Z", updated_at: "2026-10-30T05:20:30Z" })).toBe(false);
  });

  it("has plain words for every kind", () => {
    expect(KIND_WORDS.inferred.label).toBe("Inferred");
    expect(KIND_WORDS.ai_suggested.label).toBe("Suggested by AI");
    expect(KIND_WORDS.user.label).toBe("Added by a person");
  });

  it("labels the buttons that open the sheet", () => {
    expect(whyLabel("DP World")).toBe("Why is DP World here?");
    expect(whyLabel("DP World, operates, Jebel Ali Port", { link: true })).toBe(
      "Why is this link here? DP World, operates, Jebel Ali Port.",
    );
    expect(whyLabel("DP World", { weak: true })).toBe("Why is DP World here? Weak: under 50% sure, or no source.");
  });
});

describe("the '?' mark (showsWeak)", () => {
  it("follows the api's own verdict first", () => {
    expect(showsWeak({ weak: true, confidence: 0.9 }, true)).toBe(true);
    expect(showsWeak({ weak: true, confidence: null }, false)).toBe(true);
  });

  it("marks cause-and-effect links under 50 % or unknown", () => {
    expect(showsWeak({ confidence: 0.49 }, true)).toBe(true);
    expect(showsWeak({ confidence: null }, true)).toBe(true);
    expect(showsWeak({ confidence: 0.5 }, true)).toBe(false);
    expect(showsWeak({ weak: false, confidence: 0.8 }, true)).toBe(false);
  });

  it("marks other links only when their own confidence is under 50 %", () => {
    expect(showsWeak({ confidence: null }, false)).toBe(false);
    expect(showsWeak({}, false)).toBe(false);
    expect(showsWeak({ confidence: 0.3 }, false)).toBe(true);
    expect(showsWeak({ confidence: 0.7 }, false)).toBe(false);
  });
});
