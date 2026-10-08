import { afterEach, describe, expect, it, vi } from "vitest";

import { DataError } from "../source";
import {
  approveWaitingCalls,
  ConnectorSource,
  invalidateConnectorCache,
  useConnectorApproval,
} from "./connector";

const capability = vi.hoisted(() => vi.fn());
vi.mock("@/platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/runtime")>()),
  capability,
}));

const meta = {
  generated_at: "2026-10-08T10:00:00Z",
  data: {
    live_stories: 3,
    sample_stories: 0,
    forecasts: 1,
    entities: 9,
    last_ingest_at: "2026-10-08T09:56:00Z",
    showing_sample: false,
  },
  sectors: [],
  sources: [],
};

/** What the Supabase connector's execute_sql answers. */
const rows = (data: unknown): Claude.mcp.CallToolResult => ({
  content: [
    {
      type: "text",
      text: `Below is the result.\n<untrusted-data-1>\n${JSON.stringify([{ data }])}\n</untrusted-data-1>`,
    },
  ],
});

const mcpError = (code: string) => ({ code, message: code });

function fakeMcp(callTool: (...args: unknown[]) => Promise<Claude.mcp.CallToolResult>) {
  const mcp = { callTool: vi.fn(callTool), invalidate: vi.fn(async () => {}) };
  capability.mockResolvedValue(mcp);
  return mcp;
}

afterEach(() => {
  capability.mockReset();
  useConnectorApproval.setState({ waiting: [], asking: false });
});

describe("ConnectorSource", () => {
  it("runs the api function through execute_sql and checks the answer", async () => {
    const mcp = fakeMcp(async () => rows(meta));
    await expect(new ConnectorSource().call("meta", {})).resolves.toEqual(meta);
    const [server, tool, input, options] = mcp.callTool.mock.calls[0] as [
      string,
      string,
      { query: string },
      { cache: unknown },
    ];
    expect([server, tool]).toEqual(["Supabase", "execute_sql"]);
    expect(input.query).toBe("select api.meta($wg${}$wg$::jsonb) as data");
    expect(options.cache).toMatchObject({ staleTime: 30_000 });
  });

  it("sends writes uncached", async () => {
    const mcp = fakeMcp(async () => rows({ saved: 0, skipped: 0, rejected: [], links_saved: 0 }));
    await new ConnectorSource().call("save_analysis", { engine: "artifact", model: "m", items: [] });
    expect((mcp.callTool.mock.calls[0][3] as { cache: unknown }).cache).toBe(false);
  });

  it.each([
    ["server_not_connected", "connector_missing"],
    ["needs_reauth", "connector_reauth"],
    ["not_granted", "not_allowed"],
    ["capability_disabled", "offline"],
    ["tool_error", "server_error"],
    ["server_unavailable", "unavailable"],
  ])("turns %s into %s", async (code, kind) => {
    fakeMcp(async () => Promise.reject(mcpError(code)));
    const error = await new ConnectorSource().call("meta", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe(kind);
  });
});

describe("approval_required", () => {
  it("waits for the viewer's tap, repeats the call once, and returns its answer", async () => {
    let calls = 0;
    const mcp = fakeMcp(async () => {
      calls += 1;
      if (calls === 1) throw mcpError("approval_required");
      return rows(meta);
    });
    const pending = new ConnectorSource().call("meta", {});
    await vi.waitFor(() => expect(useConnectorApproval.getState().waiting).toHaveLength(1));
    expect(calls).toBe(1); // nothing repeats on its own

    await approveWaitingCalls();
    await expect(pending).resolves.toEqual(meta);
    expect(calls).toBe(2);
    expect((mcp.callTool.mock.calls[1][3] as { cache: { refresh: boolean } }).cache.refresh).toBe(true);
    expect(useConnectorApproval.getState()).toMatchObject({ waiting: [], asking: false });
  });

  it("falls back to 'not allowed' when the viewer declines again", async () => {
    fakeMcp(async () => Promise.reject(mcpError("approval_required")));
    const first = new ConnectorSource().call("meta", {});
    const second = new ConnectorSource().call("top", { window: "7d" });
    await vi.waitFor(() => expect(useConnectorApproval.getState().waiting).toHaveLength(2));
    await approveWaitingCalls();
    for (const call of [first, second]) {
      const error = await call.catch((e: unknown) => e);
      expect((error as DataError).kind).toBe("not_allowed");
    }
    expect(useConnectorApproval.getState().waiting).toHaveLength(0);
  });

  it("drops a waiting call when its screen goes away", async () => {
    fakeMcp(async () => Promise.reject(mcpError("approval_required")));
    const controller = new AbortController();
    const call = new ConnectorSource().call("meta", {}, { signal: controller.signal });
    await vi.waitFor(() => expect(useConnectorApproval.getState().waiting).toHaveLength(1));
    controller.abort();
    await expect(call).rejects.toBeDefined();
    expect(useConnectorApproval.getState().waiting).toHaveLength(0);
  });
});

describe("invalidateConnectorCache", () => {
  it("drops cached execute_sql reads, and tolerates older shells", async () => {
    const mcp = fakeMcp(async () => rows(meta));
    await invalidateConnectorCache();
    expect(mcp.invalidate).toHaveBeenCalledWith("Supabase", "execute_sql");
    mcp.invalidate.mockRejectedValueOnce(mcpError("bad_request"));
    await expect(invalidateConnectorCache()).resolves.toBeUndefined();
  });
});
