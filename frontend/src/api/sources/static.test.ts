// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataError } from "../source";
import {
  __testing,
  loadSnapshot,
  shiftTimes,
  snapshotAllowed,
  snapshotKey,
  StaticSource,
  useSnapshot,
} from "./static";
import { useSettings } from "@/state/settings";

const FILES = import.meta.glob<unknown>("../../../public/snapshot/*.json", {
  eager: true,
  import: "default",
});
const committed = (file: string): unknown => {
  const body = FILES[`../../../public/snapshot/${file}`];
  if (body === undefined) throw new Error(`No committed snapshot file ${file}`);
  return body;
};

/** A fetch that serves files from a map of url → body (missing → 404). */
function serve(files: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!(url in files)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(files[url]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const HOUR = 3_600_000;

/** A small snapshot of `kind` built `ageMs` ago: meta and a 24 h globe. */
function snapshotOf(kind: unknown, ageMs: number) {
  const built = new Date(Date.now() - ageMs).toISOString();
  const meta = { ...(committed("meta.json") as object), generated_at: built };
  return {
    built,
    files: {
      "snapshot/manifest.json": {
        kind,
        as_of: built,
        files: {
          [snapshotKey("meta", {})]: "meta.json",
          [snapshotKey("globe", { window: "24h" })]: "globe-24h.json",
          [snapshotKey("globe", { window: "24h", sample: true })]: "globe-24h.json",
        },
      },
      "snapshot/meta.json": meta,
      "snapshot/globe-24h.json": committed("globe-24h.json"),
    },
  };
}

const setSample = (sample: "auto" | "on" | "off") => useSettings.setState({ sample });

beforeEach(() => {
  __testing.reset();
  setSample("auto");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSample("auto");
});

describe("the committed snapshot", () => {
  it("is a live or sample snapshot, and every file matches the API contract", async () => {
    const manifest = committed("manifest.json") as {
      kind: string;
      as_of: string;
      files: Record<string, string>;
    };
    expect(["live", "sample"]).toContain(manifest.kind);
    expect(Number.isFinite(Date.parse(manifest.as_of))).toBe(true);
    const files: Record<string, unknown> = { "snapshot/manifest.json": manifest };
    for (const file of new Set(Object.values(manifest.files))) files[`snapshot/${file}`] = committed(file);
    serve(files);
    setSample("on");

    const snapshot = await loadSnapshot();
    expect(snapshot.kind).toBe(manifest.kind);
    expect([...snapshot.invalid]).toEqual([]);
    expect(snapshot.data.size).toBe(Object.keys(manifest.files).length);
    expect(useSnapshot.getState().data.size).toBe(snapshot.data.size);
  });
});

describe("StaticSource", () => {
  it("serves snapshotted calls and explains the rest", async () => {
    const meta = committed("meta.json");
    serve({
      "snapshot/manifest.json": {
        kind: "live",
        as_of: "2026-10-22T10:00:00Z",
        files: { [snapshotKey("meta", {})]: "meta.json", [snapshotKey("brief", {})]: "brief.json" },
      },
      "snapshot/meta.json": meta,
      "snapshot/brief.json": { not: "a brief" },
    });
    const source = new StaticSource();

    const served = await source.call("meta", {});
    expect(served.data).toEqual((meta as { data: unknown }).data);
    await expect(source.call("brief", {})).rejects.toMatchObject({ kind: "bad_response" });
    const missing = source.call("globe", { window: "24h" });
    await expect(missing).rejects.toBeInstanceOf(DataError);
    await expect(missing).rejects.toMatchObject({ kind: "offline" });
  });

  it("loads once, and an unreachable snapshot is just empty", async () => {
    const fetchMock = serve({});
    const source = new StaticSource();
    await expect(source.call("meta", {})).rejects.toMatchObject({ kind: "offline" });
    await expect(source.call("meta", {})).rejects.toMatchObject({ kind: "offline" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await source.available()).toBe(false);
    expect(useSnapshot.getState()).toMatchObject({ kind: null, asOf: null });
    expect(useSnapshot.getState().data.size).toBe(0);
  });
});

describe("snapshot kinds", () => {
  it("reads the kind and the time it was built from the manifest", async () => {
    const { built, files } = snapshotOf("live", 2 * HOUR);
    serve(files);
    const snapshot = await loadSnapshot();
    expect(snapshot.kind).toBe("live");
    expect(snapshot.asOf).toBe(built);
    expect(useSnapshot.getState()).toMatchObject({ kind: "live", asOf: built });
  });

  it.each([
    ["no kind", undefined],
    ["an unknown kind", "real"],
  ])("treats a manifest with %s as sample data (fails closed)", async (_what, kind) => {
    serve(snapshotOf(kind, HOUR).files);
    expect((await loadSnapshot()).kind).toBe("sample");
  });

  it("ignores a manifest in the old flat shape", async () => {
    serve({ "snapshot/manifest.json": { [snapshotKey("meta", {})]: "meta.json" } });
    const snapshot = await loadSnapshot();
    expect(snapshot.kind).toBeNull();
    expect(snapshot.data.size).toBe(0);
  });

  it("keeps a live snapshot's true dates", async () => {
    const { files } = snapshotOf("live", 30 * HOUR);
    serve(files);
    const meta = files["snapshot/meta.json"] as { generated_at: string };
    expect((await new StaticSource().call("meta", {})).generated_at).toBe(meta.generated_at);
    const globe = await new StaticSource().call("globe", { window: "24h" });
    expect(globe).toEqual(committed("globe-24h.json"));
  });

  it("moves a sample snapshot's times forward by its age", async () => {
    setSample("on");
    const { files } = snapshotOf("sample", 30 * HOUR);
    serve(files);
    const served = (await new StaticSource().call("meta", {})).generated_at;
    expect(Math.abs(Date.parse(served) - Date.now())).toBeLessThan(5_000);
    const globe = await new StaticSource().call("globe", { window: "24h", sample: true });
    expect(JSON.stringify(globe)).not.toEqual(JSON.stringify(committed("globe-24h.json")));
  });
});

describe("who may see which snapshot", () => {
  it.each([
    ["live", "auto", true],
    ["live", "off", true],
    ["live", "on", true],
    ["sample", "auto", false],
    ["sample", "off", false],
    ["sample", "on", true],
    [null, "on", false],
  ] as const)("a %s snapshot with Sample data %s: %s", (kind, sample, allowed) => {
    expect(snapshotAllowed(kind, sample)).toBe(allowed);
  });

  it.each(["auto", "off", "on"] as const)(
    "a live snapshot is the first frame and the fallback with Sample data %s",
    async (sample) => {
      setSample(sample);
      serve(snapshotOf("live", HOUR).files);
      const source = new StaticSource();
      expect(await source.available()).toBe(true);
      await expect(source.call("meta", {})).resolves.toBeTruthy();
      expect(useSnapshot.getState().data.size).toBe(3);
    },
  );

  it.each(["auto", "off"] as const)(
    "a sample snapshot is neither the first frame nor the fallback with Sample data %s",
    async (sample) => {
      setSample(sample);
      serve(snapshotOf("sample", HOUR).files);
      const source = new StaticSource();
      expect(await source.available()).toBe(false);
      await expect(source.call("meta", {})).rejects.toMatchObject({
        kind: "offline",
        message: "Live data isn't connected.",
      });
      await expect(source.call("globe", { window: "24h" })).rejects.toBeInstanceOf(DataError);
      expect(useSnapshot.getState().data.size).toBe(0);
      expect(useSnapshot.getState().kind).toBe("sample");
    },
  );

  it("a sample snapshot is the first frame and the fallback with Sample data on, and goes when it's turned off", async () => {
    setSample("on");
    serve(snapshotOf("sample", HOUR).files);
    const source = new StaticSource();
    expect(await source.available()).toBe(true);
    await expect(source.call("globe", { window: "24h", sample: true })).resolves.toBeTruthy();
    expect(useSnapshot.getState().data.size).toBe(3);

    setSample("auto");
    expect(useSnapshot.getState().data.size).toBe(0);
    expect(await source.available()).toBe(false);
    setSample("on");
    expect(useSnapshot.getState().data.size).toBe(3);
  });
});

describe("shiftTimes", () => {
  it("moves ISO date-times only", () => {
    expect(
      shiftTimes(
        {
          at: "2026-10-08T10:00:00+00:00",
          list: ["2026-10-08T10:00:00.5Z", "2026", "2026-10-08"],
          n: 3,
          x: null,
        },
        HOUR,
      ),
    ).toEqual({
      at: "2026-10-08T11:00:00.000Z",
      list: ["2026-10-08T11:00:00.500Z", "2026", "2026-10-08"],
      n: 3,
      x: null,
    });
  });
});
