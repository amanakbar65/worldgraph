import { RESPONSES, WRITE_RPCS, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, type CallOptions, type DataSource } from "../source";
import { parseExecuteSqlRows, rpcSql } from "../sql";
import { capability, SUPABASE_CONNECTOR, SUPABASE_PROJECT_ID } from "@/platform/runtime";

/**
 * Inside claude.ai: run `select api.<fn>(…)` through the viewer's own
 * Supabase connector. Reads are cached by the platform for 30 s and replayed
 * for up to 10 min, so moving around the app stays fast.
 */
export class ConnectorSource implements DataSource {
  readonly kind = "connector" as const;

  async call<N extends RpcName>(
    name: N,
    args: RpcArgs[N],
    options: CallOptions = {},
  ): Promise<RpcResponse<N>> {
    const mcp = await capability("mcp");
    if (!mcp) throw new DataError("offline", "Connectors aren't available in this view.");
    const write = WRITE_RPCS.has(name);
    let result: Claude.mcp.CallToolResult;
    try {
      result = await mcp.callTool(
        SUPABASE_CONNECTOR,
        "execute_sql",
        { project_id: SUPABASE_PROJECT_ID, query: rpcSql(name, args) },
        {
          cache: write ? false : { staleTime: 30_000, gcTime: 600_000, refresh: options.fresh },
          signal: options.signal,
        },
      );
    } catch (error) {
      throw toDataError(error);
    }
    let rows: Record<string, unknown>[];
    try {
      rows = parseExecuteSqlRows(result.payload ?? textOf(result));
    } catch (error) {
      throw new DataError("bad_response", (error as Error).message);
    }
    const parsed = RESPONSES[name].safeParse(rows[0]?.data);
    if (!parsed.success) {
      throw new DataError("bad_response", `The ${name} answer didn't match the expected shape.`);
    }
    return parsed.data as RpcResponse<N>;
  }
}

function textOf(result: Claude.mcp.CallToolResult): string {
  return result.content
    .map((block) => (block.type === "text" ? String((block as { text: string }).text) : ""))
    .join("\n");
}

function toDataError(error: unknown): DataError {
  const e = error as Partial<Claude.mcp.McpError> | undefined;
  switch (e?.code) {
    case "server_not_connected":
    case "server_not_found":
    case "selection_required":
      return new DataError(
        "connector_missing",
        "Add the Supabase connector in claude.ai Settings → Connectors.",
      );
    case "needs_reauth":
      return new DataError("connector_reauth", "Reconnect Supabase in claude.ai Settings → Connectors.");
    case "not_in_manifest":
    case "not_granted":
    case "blocked_by_policy":
    case "approval_required":
    case "consent_required":
      return new DataError(
        "not_allowed",
        "WorldGraph isn't allowed to use the Supabase connector in this view.",
      );
    case "capability_disabled":
    case "capability_removed":
      return new DataError("offline", "Connectors aren't available in this view.");
    case "tool_error":
      return new DataError("server_error", e.message ?? "The database reported an error.");
    case "server_unavailable":
    case "rate_limited":
    case "upstream_error":
      return new DataError("unavailable", "The database didn't answer. It may be waking up.", true);
    default:
      return new DataError("unavailable", e?.message ?? "The database didn't answer.", true);
  }
}
