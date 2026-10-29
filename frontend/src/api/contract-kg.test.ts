import { describe, expect, it } from "vitest";

import { RESPONSES, RPC_NAMES, WRITE_RPCS } from "./contract";

// Phase A part 2 (migrations 0023–0025): provenance, "as of", schema map.
// The new fields are optional, so an older database's answers still parse.

const link = {
  source: "org:dp-world",
  target: "infra:jebel-ali-port",
  type: "operates",
  causal: false,
  confidence: null,
  created_at: "2026-10-28T10:00:00Z",
};

describe("provenance contract", () => {
  it("parses a node's provenance", () => {
    const parsed = RESPONSES.provenance.parse({
      target: "node",
      id: "org:dp-world",
      title: "DP World",
      sources: [
        {
          name: "WorldGraph curated",
          url: null,
          snippet: "Reference entities and links: compiled by WorldGraph from public sources",
          published_at: null,
          title: null,
        },
      ],
      source: { id: "curated", name: "WorldGraph curated", url: null, attribution: "Reference entities…" },
      confidence: null,
      kind: "reported",
      added_by: "WorldGraph curated · 28 Oct",
      created_by: "curated",
      created_at: "2026-10-28T10:00:00Z",
      updated_at: "2026-10-28T10:00:00Z",
      is_sample: false,
      weak: false,
    });
    expect(parsed.added_by).toContain("·");
  });

  it("parses a causal link's provenance (numeric id, no source row)", () => {
    const parsed = RESPONSES.provenance.parse({
      target: "link",
      id: 280,
      title: "Saudi Arabia extends crude output cuts → Freight rates climb at Indian ports",
      sources: [],
      source: null,
      confidence: 0.4,
      kind: "inferred",
      added_by: "AI analysis · 22 Oct",
      created_by: "ai:claude-opus-5-5",
      created_at: "2026-10-22T10:00:00Z",
      updated_at: "2026-10-22T10:00:00Z",
      is_sample: false,
      weak: true,
    });
    expect(parsed.weak).toBe(true);
  });

  it("is a read function", () => {
    expect(RPC_NAMES).toEqual(expect.arrayContaining(["provenance", "graph_as_of", "local_graph_as_of"]));
    expect(WRITE_RPCS.has("provenance")).toBe(false);
  });
});

describe("weak links and connection edge ids", () => {
  it("accepts links with and without `weak`", () => {
    const graph = {
      nodes: [],
      links: [link, { ...link, id: 7, weak: true, confidence: 0.3 }],
      truncated: false,
    };
    expect(RESPONSES.graph.parse(graph).links[1]?.weak).toBe(true);
  });
});

describe("as-of contract", () => {
  it("is a graph response plus as_of and history_starts", () => {
    const data = {
      nodes: [],
      links: [link],
      truncated: false,
      as_of: "2026-10-28T23:59:59.999999+00:00",
      history_starts: "2026-10-28T10:00:00+00:00",
    };
    expect(RESPONSES.graph_as_of.parse(data).history_starts).toBe(data.history_starts);
    expect(() => RESPONSES.graph_as_of.parse({ ...data, as_of: undefined })).toThrow();
    expect(RESPONSES.local_graph_as_of.parse({ ...data, focus: "region:in" }).focus).toBe("region:in");
  });
});

describe("schema map contract", () => {
  const type = {
    key: "organization",
    label: "Organisation",
    plural: "Organisations",
    icon: "building",
    tone: "type-organization",
    description: "A company.",
    count: 45,
    properties: [],
  };
  it("accepts coverage and type links, and their absence", () => {
    const property = {
      key: "sector",
      label: "Sector",
      kind: "entity",
      required: false,
      derived: false,
      multiple: true,
      choices: null,
      unit: null,
      unit_key: null,
      entity_types: ["sector"],
      pattern: null,
      min: null,
      max: null,
      description: null,
    };
    const withMap = {
      ...type,
      properties: [{ ...property, coverage: 0.8 }],
      links: [{ relation: "in_sector", label: "In sector", direction: "out", count: 57 }],
    };
    const parsed = RESPONSES.schema.parse({ types: [withMap, type], relations: [] });
    expect(parsed.types[0]?.properties[0]?.coverage).toBe(0.8);
    expect(parsed.types[1]?.links).toBeUndefined();
  });
});
