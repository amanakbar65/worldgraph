import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveWithSnapshot, Tracked, isConnectionFailure, useConnection, type SnapshotSource } from "./client";
import { DataError, type DataSource } from "./source";
import { __testing, snapshotKey, StaticSource } from "./sources/static";
import { useSettings } from "@/state/settings";

const meta = { generated_at: "2026-10-15T10:00:00Z" };

/** A source that answers `meta` and fails every other call with `error`. */
function source(kind: DataSource["kind"], error: unknown): DataSource {
  return {
    kind,
    call: async (name) => {
      if (name === "meta") return meta as never;
      throw error;
    },
  };
}

/** A snapshot like `source`, that this viewer may or may not see. */
function snapshot(available = true): SnapshotSource {
  return {
    ...source("static", new DataError("offline", "This view needs the live database.")),
    available: async () => available,
  };
}

const status = () => useConnection.getState().state;

beforeEach(() => useConnection.setState({ state: { status: "connecting" } }));

describe("the app-wide data status", () => {
  it.each([
    ["an item that's gone", new DataError("server_error", "Not found: story:does-not-exist")],
    ["a function that failed", new DataError("server_error", "Database error.")],
    ["an answer in the wrong shape", new DataError("bad_response", "The story answer didn't match.")],
    ["a Not found sent as unavailable", new DataError("unavailable", "Not found: region:zz", true)],
    ["a cancelled call", new DOMException("Aborted", "AbortError")],
  ])("stays live after %s on the website", async (_what, error) => {
    const tracked = new Tracked(source("http", error));
    await tracked.call("meta", {});
    await expect(tracked.call("story", { id: "story:x" })).rejects.toBe(error);
    expect(status()).toEqual({ status: "live", source: "http" });
  });

  it.each([
    ["an item that's gone", new DataError("server_error", "Not found: story:does-not-exist")],
    ["a cancelled call", new DOMException("Aborted", "AbortError")],
  ])("stays live after %s in the test link", async (_what, error) => {
    const live = new LiveWithSnapshot(source("connector", error), snapshot());
    await live.call("meta", {});
    await expect(live.call("story", { id: "story:x" })).rejects.toBe(error);
    expect(status()).toEqual({ status: "live", source: "connector" });
  });

  it("reports a connection that stopped answering", async () => {
    const down = new DataError("unavailable", "The database didn't answer. It may be waking up.", true);
    const tracked = new Tracked(source("http", down));
    await expect(tracked.call("story", { id: "story:x" })).rejects.toBe(down);
    expect(status()).toEqual({ status: "error", reason: down });
  });

  it("falls back to the snapshot when the connector can't run here", async () => {
    const missing = new DataError("connector_missing", "Add the Supabase connector.");
    const live = new LiveWithSnapshot(source("connector", missing), snapshot());
    await expect(live.call("meta", {})).resolves.toEqual(meta);
    await live.call("story", { id: "story:x" }).catch(() => undefined);
    expect(status()).toEqual({ status: "snapshot", reason: missing });
  });

  it.each([
    new DataError("connector_missing", "Add the Supabase connector."),
    new DataError("not_allowed", "Live data wasn't approved."),
    new DataError("offline", "Connectors aren't available in this view."),
  ])(
    "says live data isn't connected, and fails with its reason, when there is no snapshot to show ($kind)",
    async (reason) => {
      const fallback = snapshot(false);
      const call = vi.spyOn(fallback, "call");
      const live = new LiveWithSnapshot(source("connector", reason), fallback);
      await expect(live.call("globe", { window: "7d" })).rejects.toBe(reason);
      expect(call).not.toHaveBeenCalled();
      expect(status()).toEqual({ status: "disconnected", reason });
    },
  );

  it("counts only connection-level kinds as connection failures", () => {
    expect(isConnectionFailure(new DataError("offline", "No connectors here."))).toBe(true);
    expect(isConnectionFailure(new DataError("connector_reauth", "Reconnect."))).toBe(true);
    expect(isConnectionFailure(new DataError("server_error", "Database error."))).toBe(false);
    expect(isConnectionFailure(new Error("boom"))).toBe(false);
  });
});

describe("the test link's fallback with each Sample data setting", () => {
  const missing = new DataError("connector_missing", "Add the Supabase connector.");
  const globe = import.meta.glob<unknown>("../../public/snapshot/globe-7d.json", {
    eager: true,
    import: "default",
  })["../../public/snapshot/globe-7d.json"];

  function serveSnapshot(kind: "live" | "sample") {
    const files: Record<string, unknown> = {
      "snapshot/manifest.json": {
        kind,
        as_of: new Date().toISOString(),
        files: {
          [snapshotKey("globe", { window: "7d", sample: true })]: "globe.json",
          [snapshotKey("globe", { window: "7d" })]: "globe.json",
          [snapshotKey("globe", { window: "7d", sample: false })]: "globe.json",
        },
      },
      "snapshot/globe.json": globe,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url in files ? new Response(JSON.stringify(files[url])) : new Response("", { status: 404 }),
      ),
    );
  }

  beforeEach(() => __testing.reset());
  afterEach(() => {
    vi.unstubAllGlobals();
    useSettings.setState({ sample: "auto" });
  });

  it.each(["auto", "off", "on"] as const)("shows a live snapshot with Sample data %s", async (sample) => {
    useSettings.setState({ sample });
    serveSnapshot("live");
    const live = new LiveWithSnapshot(source("connector", missing), new StaticSource());
    await expect(live.call("globe", { window: "7d" })).resolves.toEqual(globe); // its true dates, unmoved
    expect(status()).toEqual({ status: "snapshot", reason: missing });
  });

  it.each(["auto", "off"] as const)("never shows a sample snapshot with Sample data %s", async (sample) => {
    useSettings.setState({ sample });
    serveSnapshot("sample");
    const live = new LiveWithSnapshot(source("connector", missing), new StaticSource());
    await expect(live.call("globe", { window: "7d" })).rejects.toBe(missing);
    expect(status()).toEqual({ status: "disconnected", reason: missing });
  });

  it("shows a sample snapshot with Sample data on", async () => {
    useSettings.setState({ sample: "on" });
    serveSnapshot("sample");
    const live = new LiveWithSnapshot(source("connector", missing), new StaticSource());
    await expect(live.call("globe", { window: "7d", sample: true })).resolves.toBeTruthy();
    expect(status()).toEqual({ status: "snapshot", reason: missing });
  });
});
