import { describe, expect, it } from "vitest";

import { snapshotKeyOf, snapshotManifest, snapshotPlan, SNAPSHOT_WINDOWS } from "./snapshot-plan";
import { RESPONSES, type RpcArgs, type RpcName } from "@/api/contract";
import { snapshotKey } from "@/api/sources/static";
import { sampleArg } from "@/state/settings";

const files = import.meta.glob<unknown>("../../public/snapshot/*.json", { eager: true, import: "default" });
const published = Object.fromEntries(
  Object.entries(files).map(([path, data]) => [path.split("/").pop()!, data]),
);

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

  it("cover the first frame as the app asks for it, whatever the sample setting", () => {
    const manifest = snapshotManifest();
    for (const setting of ["auto", "on"] as const) {
      const sample = sampleArg(setting);
      for (const window of SNAPSHOT_WINDOWS) {
        const lensOff: RpcArgs["globe"][] = [
          { window, sample },
          { window, sectors: [], sample },
        ];
        for (const args of lensOff) {
          expect(manifest[snapshotKey("globe", args)]).toBe(`globe-${window}.json`);
          expect(manifest[snapshotKey("top", args)]).toBe(`top-${window}.json`);
        }
      }
      const brief: RpcArgs["brief"] = { profile: undefined, sample };
      expect(manifest[snapshotKey("brief", brief)]).toBe("brief.json");
      const forecasts: RpcArgs["forecasts"] = { sort: "relevance", sample, sectors: [] };
      expect(manifest[snapshotKey("forecasts", forecasts)]).toBe("forecasts.json");
      expect(manifest[snapshotKey("forecasts", { sample })]).toBe("forecasts.json");
    }
    expect(manifest[snapshotKey("meta", {})]).toBe("meta.json");
  });

  it("never claim a call that needs live data", () => {
    const manifest = snapshotManifest();
    expect(manifest[snapshotKey("globe", { window: "7d", sectors: ["energy"] })]).toBeUndefined();
    expect(manifest[snapshotKey("story", { id: "story:a" })]).toBeUndefined();
  });
});

describe("the committed snapshot", () => {
  it("matches the plan (run `npm run snapshot` after changing it)", () => {
    expect(published["manifest.json"]).toEqual(snapshotManifest());
    for (const entry of snapshotPlan()) expect(published[entry.file], entry.file).toBeDefined();
  });

  it("matches the API contract and holds sample data", () => {
    for (const entry of snapshotPlan()) {
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
