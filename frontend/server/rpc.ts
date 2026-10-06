/**
 * The one HTTP entry point to the data: POST {fn, args} → select api.<fn>(args).
 * Used by the local dev server (dev/rpc-dev-plugin.ts) and, on the website,
 * by the Netlify function (netlify/functions/rpc.mts).
 */
import type { Pool } from "pg";

import { RPC_NAMES, WRITE_RPCS, type RpcName } from "../src/api/contract";

export interface RpcContext {
  /** Two-letter country code from the host's geo header, or null when unknown. */
  viewerCountry: string | null;
  /** Whether write functions (save_analysis) may run. Never true for public visitors. */
  allowWrites: boolean;
}

export interface RpcResult {
  status: number;
  body: { data?: unknown; error?: string };
}

const MAX_BODY_BYTES = 64 * 1024;

export async function handleRpc(pool: Pool, rawBody: string, ctx: RpcContext): Promise<RpcResult> {
  if (rawBody.length > MAX_BODY_BYTES) return { status: 413, body: { error: "Request too large." } };
  let parsed: { fn?: unknown; args?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { fn?: unknown; args?: unknown };
  } catch {
    return { status: 400, body: { error: "Body must be JSON." } };
  }
  const fn = parsed.fn;
  if (typeof fn !== "string" || !RPC_NAMES.includes(fn as RpcName)) {
    return { status: 404, body: { error: "Unknown function." } };
  }
  if (WRITE_RPCS.has(fn as RpcName) && !ctx.allowWrites) {
    return { status: 403, body: { error: "Not allowed." } };
  }
  const args =
    parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
      ? { ...(parsed.args as Record<string, unknown>) }
      : {};
  // The viewer's country is decided by the server, never by the browser.
  delete args._viewer;
  args._viewer = { country: ctx.viewerCountry };
  try {
    const result = await pool.query<{ data: unknown }>(`select api.${fn}($1::jsonb) as data`, [
      JSON.stringify(args),
    ]);
    return { status: 200, body: { data: result.rows[0]?.data ?? null } };
  } catch (error) {
    const message = (error as Error).message ?? "Database error.";
    const userFacing = /invalid|not found|must|unknown/i.test(message) ? message : "Database error.";
    return { status: 500, body: { error: userFacing } };
  }
}
