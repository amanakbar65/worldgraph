// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataError } from "../source";
import { __testing, loadSnapshot, shiftTimes, snapshotKey, StaticSource, useSnapshot } from "./static";

const FILES = import.meta.glob<unknown>("../../../public/snapshot/*.json", { eager: true, import: "default" });
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

beforeEach(() => __testing.reset());
afterEach(() => vi.unstubAllGlobals());

describe("snapshot", () => {
  it("every committed snapshot file matches the API contract", async () => {
    const manifest = committed("manifest.json") as Record<string, string>;
    const files: Record<string, unknown> = { "snapshot/manifest.json": manifest };
    for (const file of new Set(Object.values(manifest))) files[`snapshot/${file}`] = committed(file);
    serve(files);

    const snapshot = await loadSnapshot();
    expect([...snapshot.invalid]).toEqual([]);
    expect(snapshot.data.size).toBe(Object.keys(manifest).length);
    expect(useSnapshot.getState().data.size).toBe(snapshot.data.size);
  });

  it("serves snapshotted calls and explains the rest", async () => {
    const meta = committed("meta.json");
    serve({
      "snapshot/manifest.json": {
        [snapshotKey("meta", {})]: "meta.json",
        [snapshotKey("brief", {})]: "brief.json",
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
    expect(useSnapshot.getState().data.size).toBe(0);
  });

  it("moves every time forward by the snapshot's age", async () => {
    const meta = committed("meta.json") as { generated_at: string };
    const globe = committed("globe-24h.json");
    const age = Date.now() - Date.parse(meta.generated_at);
    serve({
      "snapshot/manifest.json": { [snapshotKey("meta", {})]: "meta.json", [snapshotKey("globe", {})]: "globe.json" },
      "snapshot/meta.json": meta,
      "snapshot/globe.json": globe,
    });
    const served = (await new StaticSource().call("meta", {})).generated_at;
    expect(Math.abs(Date.parse(served) - Date.now())).toBeLessThan(5_000);
    const shiftedGlobe = await new StaticSource().call("globe", {} as never);
    expect(JSON.stringify(shiftedGlobe)).not.toEqual(JSON.stringify(globe));
    expect(age).toBeGreaterThan(0);
  });
});

describe("shiftTimes", () => {
  it("moves ISO date-times only", () => {
    const hour = 3_600_000;
    expect(
      shiftTimes(
        { at: "2026-10-08T10:00:00+00:00", list: ["2026-10-08T10:00:00.5Z", "2026", "2026-10-08"], n: 3, x: null },
        hour,
      ),
    ).toEqual({ at: "2026-10-08T11:00:00.000Z", list: ["2026-10-08T11:00:00.500Z", "2026", "2026-10-08"], n: 3, x: null });
  });
});
