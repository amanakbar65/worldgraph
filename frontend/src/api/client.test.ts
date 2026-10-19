import { beforeEach, describe, expect, it } from "vitest";

import { LiveWithSnapshot, Tracked, isConnectionFailure, useConnection } from "./client";
import { DataError, type DataSource } from "./source";

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
    const live = new LiveWithSnapshot(source("connector", error), source("static", null));
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
    const live = new LiveWithSnapshot(source("connector", missing), source("static", null));
    await expect(live.call("meta", {})).resolves.toEqual(meta);
    await live.call("story", { id: "story:x" }).catch(() => undefined);
    expect(status()).toEqual({ status: "snapshot", reason: missing });
  });

  it("counts only connection-level kinds as connection failures", () => {
    expect(isConnectionFailure(new DataError("offline", "No connectors here."))).toBe(true);
    expect(isConnectionFailure(new DataError("connector_reauth", "Reconnect."))).toBe(true);
    expect(isConnectionFailure(new DataError("server_error", "Database error."))).toBe(false);
    expect(isConnectionFailure(new Error("boom"))).toBe(false);
  });
});
