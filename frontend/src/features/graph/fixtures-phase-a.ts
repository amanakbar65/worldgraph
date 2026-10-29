/** Test data for Phase A entity pages: typed properties and links grouped by relation. */
import type { ConnectionGroup, EntityResponse, PropertyValue } from "@/api/contract";

import { CRUDE } from "./fixtures";

const prop = (partial: Partial<PropertyValue> & Pick<PropertyValue, "key" | "label" | "kind" | "value" | "display">): PropertyValue => ({
  unit: null,
  derived: false,
  entity: null,
  entities: null,
  ...partial,
});

export const PORT_PROPERTIES: PropertyValue[] = [
  prop({ key: "kind", label: "Kind", kind: "choice", value: "port", display: "Port" }),
  prop({ key: "capacity", label: "Capacity", kind: "number", value: 19_300_000, display: "19,300,000 TEU", unit: null }),
  prop({ key: "berths", label: "Berths", kind: "number", value: 67, display: "67", unit: "berths" }),
  prop({ key: "opened", label: "Opened", kind: "date", value: "1979", display: "1979", derived: true }),
  prop({ key: "website", label: "Website", kind: "url", value: "https://example.org", display: "example.org" }),
  prop({
    key: "operator",
    label: "Operator",
    kind: "entity",
    value: "org:dp-world",
    display: "DP World",
    entity: { id: "org:dp-world", name: "DP World", type: "organization" },
  }),
  prop({
    key: "place",
    label: "Place",
    kind: "place",
    value: "region:ae",
    display: "United Arab Emirates",
    entity: { id: "region:ae", name: "United Arab Emirates", type: "region" },
  }),
  prop({
    key: "sector",
    label: "Sector",
    kind: "entity",
    value: ["sector:energy", "sector:logistics-trade"],
    display: "Energy, Logistics and Trade",
    entities: [
      { id: "sector:energy", name: "Energy", type: "sector" },
      { id: "sector:logistics-trade", name: "Logistics and Trade", type: "sector" },
    ],
  }),
];

const item = (id: string, name: string, type: ConnectionGroup["items"][number]["type"], extra: Partial<ConnectionGroup["items"][number]> = {}) => ({
  id,
  name,
  type,
  subtype: null,
  is_sample: false,
  confidence: null,
  ...extra,
});

export const PORT_CONNECTIONS: ConnectionGroup[] = [
  {
    relation: "in_sector",
    label: "In sector",
    direction: "out",
    causal: false,
    count: 2,
    items: [item("sector:energy", "Energy", "sector"), item("sector:logistics-trade", "Logistics and Trade", "sector")],
  },
  {
    relation: "operates",
    label: "Operated by",
    direction: "in",
    causal: false,
    count: 1,
    items: [item("org:dp-world", "DP World", "organization")],
  },
  {
    relation: "located_in",
    label: "Located in",
    direction: "out",
    causal: false,
    count: 1,
    items: [item("region:ae", "United Arab Emirates", "region")],
  },
  {
    relation: "depends_on",
    label: "Needed by",
    direction: "in",
    causal: false,
    count: 20,
    items: Array.from({ length: 12 }, (_, i) =>
      item(`org:shipper-${i + 1}`, `Sample shipper ${i + 1}`, "organization", { is_sample: true }),
    ),
  },
  {
    relation: "about",
    label: "Covered by",
    direction: "in",
    causal: false,
    count: 1,
    items: [item("forecast:opec-cut", "Will OPEC+ extend its output cuts?", "forecast")],
  },
];

/** A port's page with properties and grouped links (and the older facts and backlinks). */
export const PORT: EntityResponse = {
  ...CRUDE,
  entity: {
    ...CRUDE.entity,
    id: "infra:jebel-ali-port",
    type: "infrastructure",
    subtype: "port",
    name: "Jebel Ali Port",
    summary: "The Middle East's largest container port.",
    aliases: [],
    facts: [
      { label: "Kind", value: "Port" },
      { label: "Operator", value: "DP World" },
      { label: "Depth", value: "17 m" },
    ],
    is_sample: false,
  },
  properties: PORT_PROPERTIES,
  connections: PORT_CONNECTIONS,
};
