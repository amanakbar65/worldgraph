import { create } from "zustand";

import { RESPONSES, WRITE_RPCS, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, type CallOptions, type DataSource } from "../source";
import { parseExecuteSqlRows, rpcSql } from "../sql";
import { capability, SUPABASE_CONNECTOR, SUPABASE_PROJECT_ID } from "@/platform/runtime";

/**
 * Calls that the viewer must approve before they reach the database
 * (`approval_required`). The shell only asks while a page's own call waits;
 * when that ask is declined, left unanswered or not shown, the call comes
 * back with this code. We keep such calls waiting here, show a "needs
 * approval" state with one button (StatusBar), and on a tap repeat each
 * call once. Nothing here retries on its own.
 */
interface WaitingCall {
  id: number;
  run: () => Promise<Claude.mcp.CallToolResult>;
  resolve: (result: Claude.mcp.CallToolResult) => void;
  reject: (error: unknown) => void;
}

interface ApprovalState {
  /** Calls waiting for the viewer's tap. */
  waiting: WaitingCall[];
  /** True while the repeated calls are running (the shell may be asking). */
  asking: boolean;
}

export const useConnectorApproval = create<ApprovalState>(() => ({ waiting: [], asking: false }));

let nextId = 1;

function isApprovalRequired(error: unknown): boolean {
  return (error as Partial<Claude.mcp.McpError> | undefined)?.code === "approval_required";
}

/** Park a call that needs approval until the viewer taps the button. */
function waitForApproval(
  run: () => Promise<Claude.mcp.CallToolResult>,
  signal?: AbortSignal,
): Promise<Claude.mcp.CallToolResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const remove = () =>
      useConnectorApproval.setState((s) => ({ waiting: s.waiting.filter((w) => w.id !== id) }));
    const onAbort = () => {
      remove();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const settle =
      <T,>(fn: (v: T) => void) =>
      (value: T) => {
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      };
    useConnectorApproval.setState((s) => ({
      waiting: [...s.waiting, { id, run, resolve: settle(resolve), reject: settle(reject) }],
    }));
  });
}

/**
 * The viewer tapped "Allow": repeat the first waiting call once (the shell
 * asks while it waits). If that went through, repeat the others once each;
 * if it needed approval again, the viewer said no, so every waiting call
 * fails with "not allowed" (and the app shows the sample snapshot instead).
 */
export async function approveWaitingCalls(): Promise<void> {
  const { waiting, asking } = useConnectorApproval.getState();
  if (asking || waiting.length === 0) return;
  useConnectorApproval.setState({ waiting: [], asking: true });
  const [first, ...rest] = waiting;
  try {
    let declined = false;
    try {
      first.resolve(await first.run());
    } catch (error) {
      declined = isApprovalRequired(error);
      first.reject(declined ? notAllowed() : error);
    }
    await Promise.all(
      rest.map(async (call) => {
        if (declined) return call.reject(notAllowed());
        try {
          call.resolve(await call.run());
        } catch (error) {
          // Each call may need its own approval: put it back for another tap.
          if (isApprovalRequired(error)) {
            useConnectorApproval.setState((s) => ({ waiting: [...s.waiting, call] }));
          } else call.reject(error);
        }
      }),
    );
  } finally {
    useConnectorApproval.setState({ asking: false });
  }
}

const notAllowed = () =>
  new DataError("not_allowed", "Live data wasn't approved, so WorldGraph is showing sample data.");

/**
 * Drop the platform's cached connector reads (after a write), so the next
 * reads come from the database. Any failure means nothing was cached.
 */
export async function invalidateConnectorCache(): Promise<void> {
  const mcp = await capability("mcp");
  if (!mcp) return;
  try {
    await mcp.invalidate(SUPABASE_CONNECTOR, "execute_sql");
  } catch {
    // Older shells: nothing cached to drop.
  }
}

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
    const input = { project_id: SUPABASE_PROJECT_ID, query: rpcSql(name, args) };
    const run = (refresh: boolean | undefined) =>
      mcp.callTool(SUPABASE_CONNECTOR, "execute_sql", input, {
        cache: write ? false : { staleTime: 30_000, gcTime: 600_000, refresh },
        signal: options.signal,
      });
    let result: Claude.mcp.CallToolResult;
    try {
      result = await run(options.fresh);
    } catch (error) {
      if (!isApprovalRequired(error)) throw toDataError(error);
      try {
        // Repeated after the viewer's tap: always ask the database itself.
        result = await waitForApproval(() => run(true), options.signal);
      } catch (retryError) {
        if (retryError instanceof DataError || (retryError as Error | undefined)?.name === "AbortError") {
          throw retryError;
        }
        throw toDataError(retryError);
      }
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

export function toDataError(error: unknown): DataError {
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
    case "approval_required":
      return notAllowed();
    case "not_in_manifest":
    case "not_granted":
    case "blocked_by_policy":
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
