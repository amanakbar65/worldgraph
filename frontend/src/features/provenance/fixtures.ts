/** api.provenance answers for tests (invented sources; example.com links). */
import type { ProvenanceResponse } from "@/api/contract";

/** A curated link with a cited article, changed after it was added. */
export const EDGE_PROVENANCE: ProvenanceResponse = {
  target: "edge",
  id: 5326,
  title: "DP World operates Jebel Ali Port",
  sources: [
    {
      name: "Example Business Daily",
      url: "https://example.com/ports/jebel-ali",
      snippet: "The operator runs the port under a long-term concession.",
      published_at: "2026-10-20T08:00:00Z",
      title: "Gulf port operator adds berths",
    },
  ],
  source: {
    id: "curated",
    name: "WorldGraph curated",
    url: null,
    attribution: "Reference entities and links: compiled by WorldGraph from public sources",
  },
  confidence: 0.62,
  kind: "reported",
  added_by: "News pipeline · AI analysis · 22 Oct",
  created_by: "pipeline:news",
  created_at: "2026-10-22T09:00:00Z",
  updated_at: "2026-10-28T12:00:00Z",
  is_sample: false,
  weak: false,
};

/** A weak sample cause-and-effect link with nothing to cite. */
export const WEAK_LINK_PROVENANCE: ProvenanceResponse = {
  target: "link",
  id: 12,
  title: "Port queues grow → Freight rates climb",
  sources: [],
  source: null,
  confidence: 0.35,
  kind: "inferred",
  added_by: "Sample data · 30 Oct",
  created_by: "sample",
  created_at: "2026-10-30T05:20:04Z",
  updated_at: "2026-10-30T05:20:04Z",
  is_sample: true,
  weak: true,
};

/** A place from the gazetteer: a node, no confidence, its dataset as the source. */
export const NODE_PROVENANCE: ProvenanceResponse = {
  target: "node",
  id: "region:in-gj",
  title: "Gujarat",
  sources: [
    {
      name: "Natural Earth",
      url: "https://www.naturalearthdata.com",
      snippet: "Borders and places: Natural Earth",
      published_at: null,
      title: null,
    },
  ],
  source: {
    id: "natural-earth",
    name: "Natural Earth",
    url: "https://www.naturalearthdata.com",
    attribution: "Borders and places: Natural Earth",
  },
  confidence: null,
  kind: "reported",
  added_by: "Natural Earth gazetteer · 30 Oct",
  created_by: "gazetteer",
  created_at: "2026-10-30T05:20:04Z",
  updated_at: "2026-10-30T05:20:04Z",
  is_sample: false,
  weak: false,
};
