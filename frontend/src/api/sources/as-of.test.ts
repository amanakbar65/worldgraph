/** "As of" (kg.history) through each data source, the same way as api.graph. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { rpcFailure } from "../../../server/rpc";
import type { GraphAsOfResponse } from "../contract";
import { DataError } from "../source";
import { ConnectorSource } from "./connector";
import { HttpSource } from "./http";
import { __testing as snapshot, snapshotKey, StaticSource } from "./static";

const capability = vi.hoisted(() => vi.fn());
vi.mock("@/platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/runtime")>()),
  capability,
}));

const answer: GraphAsOfResponse = {
  nodes: [],
  links: [],
  truncated: false,
  as_of: "2026-10-29T23:59:59.999999+00:00",
  history_starts: "2026-10-28T09:00:00+00:00",
};
const args = { at: "2026-10-29", window: "7d" as const, sample: false };

afterEach(() => {
  vi.unstubAllGlobals();
  capability.mockReset();
  snapshot.reset();
});

describe("as-of calls", () => {
  it("go to the website's /api/rpc and are checked against the contract", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: answer }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(new HttpSource().call("graph_as_of", args)).resolves.toEqual(answer);
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as unknown;
    expect(body).toEqual({ fn: "graph_as_of", args });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ...answer, as_of: undefined } }))));
    await expect(new HttpSource().call("graph_as_of", args)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("pass on 'History starts on …' from the website as this screen's answer", async () => {
    const pg = Object.assign(new Error("History starts on 28 Oct 2026"), { code: "P0001", severity: "ERROR" });
    expect(rpcFailure(pg)).toEqual({ status: 400, body: { error: "History starts on 28 Oct 2026" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rpcFailure(pg).body), { status: 400 })));
    await expect(new HttpSource().call("local_graph_as_of", { ...args, id: "region:in", depth: 1 })).rejects.toMatchObject({
      kind: "server_error",
      message: "History starts on 28 Oct 2026",
    });
  });

  it("run through the connector as select api.graph_as_of(…)", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: `<untrusted-data-1>${JSON.stringify([{ data: answer }])}</untrusted-data-1>` }],
    }));
    capability.mockResolvedValue({ callTool, invalidate: vi.fn() });
    await expect(new ConnectorSource().call("graph_as_of", args)).resolves.toEqual(answer);
    const input = (callTool.mock.calls[0] as unknown as [string, string, { query: string }])[2];
    expect(input.query).toBe(`select api.graph_as_of($wg$${JSON.stringify({ at: "2026-10-29", sample: false, window: "7d" })}$wg$::jsonb) as data`);
  });

  it("aren't in the snapshot, which says it needs the live database", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("manifest.json")
          ? new Response(JSON.stringify({ kind: "live", as_of: "2026-10-29T10:00:00Z", files: { [snapshotKey("meta", {})]: "meta.json" } }))
          : new Response("{}"),
      ),
    );
    const missing = new StaticSource().call("graph_as_of", args);
    await expect(missing).rejects.toBeInstanceOf(DataError);
    await expect(missing).rejects.toMatchObject({ kind: "offline", message: "This view needs the live database." });
  });
});
