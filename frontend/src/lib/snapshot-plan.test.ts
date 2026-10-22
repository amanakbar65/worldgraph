import { describe, expect, it } from "vitest";

import {
  liveSnapshotProblems,
  manifestFile,
  snapshotKeyOf,
  snapshotManifest,
  snapshotPlan,
  SNAPSHOT_WINDOWS,
  type SnapshotKind,
} from "./snapshot-plan";
import { RESPONSES, type RpcArgs, type RpcName } from "@/api/contract";
import { snapshotKey } from "@/api/sources/static";
import { sampleArg, type Settings } from "@/state/settings";

const files = import.meta.glob<unknown>("../../public/snapshot/*.json", { eager: true, import: "default" });
const published = Object.fromEntries(
  Object.entries(files).map(([path, data]) => [path.split("/").pop()!, data]),
);

/** The first-frame calls exactly as the app sends them with this Sample data setting. */
function firstFrame(setting: Settings["sample"]): [RpcName, unknown, string][] {
  const sample = sampleArg(setting);
  const calls: [RpcName, unknown, string][] = [["meta", {}, "meta.json"]];
  for (const window of SNAPSHOT_WINDOWS) {
    const lensOff: RpcArgs["globe"][] = [
      { window, sample },
      { window, sectors: [], sample },
    ];
    for (const args of lensOff) {
      calls.push(["globe", args, `globe-${window}.json`], ["top", args, `top-${window}.json`]);
    }
  }
  const brief: RpcArgs["brief"] = { profile: undefined, sample };
  const forecasts: RpcArgs["forecasts"] = { sort: "relevance", sample, sectors: [] };
  calls.push(["brief", brief, "brief.json"], ["forecasts", forecasts, "forecasts.json"]);
  calls.push(["forecasts", { sample }, "forecasts.json"]);
  return calls;
}

describe("snapshot keys", () => {
  it("are the keys StaticSource looks up", () => {
    const cases: [RpcName, unknown][] = [
      ["meta", {}],
      ["globe", { window: "7d", sectors: [] }],
      ["top", { sample: true, window: "24h" }],
      ["forecasts", { sort: "relevance", include_thin: false }],
      ["brief", undefined],
    ];
    for (const [name, args] of cases) expect(snapshotKeyOf(name, args)).toBe(snapshotKey(name, args));
  });

  it.each([
    ["live", ["auto", "off", "on"]],
    ["sample", ["auto", "on"]],
  ] as const)("cover the first frame of a %s snapshot for Sample data %j", (kind, settings) => {
    const manifest = snapshotManifest(snapshotPlan(kind));
    for (const setting of settings) {
      for (const [name, args, file] of firstFrame(setting)) {
        expect(manifest[snapshotKey(name, args)], `${name} ${JSON.stringify(args)}`).toBe(file);
      }
    }
  });

  it("never answer Sample data off from a sample snapshot", () => {
    const manifest = snapshotManifest(snapshotPlan("sample"));
    for (const [name, args] of firstFrame("off")) {
      if (name !== "meta") expect(manifest[snapshotKey(name, args)], name).toBeUndefined();
    }
  });

  it("never claim a call that needs live data", () => {
    for (const kind of ["live", "sample"] as const) {
      const manifest = snapshotManifest(snapshotPlan(kind));
      expect(manifest[snapshotKey("globe", { window: "7d", sectors: ["energy"] })]).toBeUndefined();
      expect(manifest[snapshotKey("story", { id: "story:a" })]).toBeUndefined();
    }
  });
});

describe("the plan", () => {
  it.each([
    ["live", false],
    ["sample", true],
  ] as const)("asks for a %s snapshot with sample: %s wherever the function takes it", (kind, sample) => {
    for (const entry of snapshotPlan(kind)) {
      if (entry.name === "meta") expect(entry.query).toEqual({});
      else expect(entry.query.sample, entry.file).toBe(sample);
    }
  });

  it.each(["live", "sample"] as const)(
    "writes a %s manifest with its kind and build time",
    (kind: SnapshotKind) => {
      const manifest = manifestFile(kind, "2026-10-22T12:00:00.000Z");
      expect(manifest.kind).toBe(kind);
      expect(manifest.as_of).toBe("2026-10-22T12:00:00.000Z");
      expect(manifest.files).toEqual(snapshotManifest(snapshotPlan(kind)));
    },
  );
});

describe("a live snapshot", () => {
  const forecast = (provider: string) => ({ id: "forecast:x", provider, is_sample: false });

  it("passes with real stories and free forecasts only", () => {
    expect(
      liveSnapshotProblems({
        "top-7d.json": { stories: [{ id: "story:a", is_sample: false }], movers: [forecast("manifold")] },
        "meta.json": { data: { showing_sample: false } },
      }),
    ).toEqual([]);
  });

  it("refuses sample items and forecasts that may be real-money", () => {
    expect(
      liveSnapshotProblems({
        "globe-7d.json": {
          events: [{ id: "story:b", is_sample: true }],
          forecasts: [forecast("polymarket")],
        },
        "brief.json": { cards: [{ forecast: forecast("some-new-market") }] },
      }),
    ).toEqual([
      "globe-7d.json: holds sample data",
      "globe-7d.json: forecasts from polymarket, which may be real-money",
      "brief.json: forecasts from some-new-market, which may be real-money",
    ]);
  });
});

describe("the committed snapshot", () => {
  it("is a sample snapshot that matches the plan (run `npm run snapshot` after changing it)", () => {
    const manifest = published["manifest.json"] as ReturnType<typeof manifestFile>;
    expect(manifest.kind).toBe("sample");
    expect(Number.isFinite(Date.parse(manifest.as_of))).toBe(true);
    expect(manifest.files).toEqual(snapshotManifest(snapshotPlan("sample")));
    for (const entry of snapshotPlan("sample")) expect(published[entry.file], entry.file).toBeDefined();
  });

  it("matches the API contract and holds sample data", () => {
    for (const entry of snapshotPlan("sample")) {
      const parsed = RESPONSES[entry.name as RpcName].safeParse(published[entry.file]);
      expect(parsed.success, `${entry.file}: ${parsed.error?.message}`).toBe(true);
    }
    const meta = RESPONSES.meta.parse(published["meta.json"]);
    expect(meta.data.showing_sample).toBe(true);
    const top = RESPONSES.top.parse(published["top-7d.json"]);
    expect(top.stories.length).toBeGreaterThan(0);
    expect(top.stories.every((s) => s.is_sample)).toBe(true);
  });
});
