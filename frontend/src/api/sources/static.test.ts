// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataError } from "../source";
import { __testing, loadSnapshot, snapshotKey, StaticSource, useSnapshot } from "./static";

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

    await expect(source.call("meta", {})).resolves.toEqual(meta);
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
});
