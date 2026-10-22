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
  /**
   * Whether owner-only functions may run: writes (save_analysis) and the raw
   * drafts waiting for analysis (pending_analysis). Never true for public visitors.
   */
  allowWrites: boolean;
}

export interface RpcResult {
  status: number;
  body: { data?: unknown; error?: string };
}

export const MAX_BODY_BYTES = 64 * 1024;

/** Only the owner's own tools call these: writes, and un-analysed drafts (raw titles and snippets). */
const OWNER_ONLY: ReadonlySet<RpcName> = new Set<RpcName>([...WRITE_RPCS, "pending_analysis"]);

/** True when a request declares a body over the limit, so it can be refused before it is read. */
export function bodyTooLarge(headers: Headers): boolean {
  const declared = Number(headers.get("content-length"));
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

/** UTF-8 size; a string with more UTF-16 units than the limit is over it without encoding. */
function tooLarge(text: string): boolean {
  return text.length > MAX_BODY_BYTES || new TextEncoder().encode(text).length > MAX_BODY_BYTES;
}

export async function handleRpc(pool: Pool, rawBody: string, ctx: RpcContext): Promise<RpcResult> {
  if (tooLarge(rawBody)) return { status: 413, body: { error: "Request too large." } };
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
  if (OWNER_ONLY.has(fn as RpcName) && !ctx.allowWrites) {
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
    const data = result.rows[0]?.data ?? null;
    // meta also says which country the server decided (Netlify's geo data), so
    // the app can pick India's map borders; the browser can't claim one.
    if (fn === "meta" && data && typeof data === "object" && !Array.isArray(data)) {
      return { status: 200, body: { data: { ...data, viewer_country: ctx.viewerCountry } } };
    }
    return { status: 200, body: { data } };
  } catch (error) {
    return rpcFailure(error);
  }
}

/**
 * The HTTP answer for a failed call, so the app can tell them apart:
 * - 404: the item doesn't exist (api.* raises "Not found: <id>");
 * - 400: the arguments were refused ("… must be …", "invalid …");
 * - 503: the database didn't answer (no connection, too busy, timed out),
 *   which is worth a retry;
 * - 500: the function itself failed.
 * Only our own messages are passed on; anything else says "Database error.".
 */
export function rpcFailure(error: unknown): RpcResult {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; severity?: unknown };
  const message = typeof e.message === "string" && e.message ? e.message : "Database error.";
  // Errors the server sent carry a severity and a SQLSTATE; connection failures don't.
  const sqlstate = typeof e.severity === "string" && typeof e.code === "string" ? e.code : null;
  // 08 connection, 53 resources (too many connections), 57 cancelled / shutting down.
  if (sqlstate === null || /^(08|53|57)/.test(sqlstate)) {
    return { status: 503, body: { error: "The database didn't answer. It may be waking up." } };
  }
  if (/^not found/i.test(message)) return { status: 404, body: { error: message } };
  if (/invalid|must|unknown|needs/i.test(message)) return { status: 400, body: { error: message } };
  return { status: 500, body: { error: "Database error." } };
}
