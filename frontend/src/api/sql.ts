import { RPC_NAMES, type RpcName } from "./contract";
import { stableJson } from "./source";

/**
 * Build the SQL that calls one api function with JSON arguments.
 * The function name comes only from the contract's allow-list, and the
 * arguments travel as a dollar-quoted JSON literal whose tag never appears
 * inside the JSON, so no argument can break out of the literal.
 */
export function rpcSql(name: RpcName, args: unknown): string {
  if (!RPC_NAMES.includes(name)) throw new Error(`Unknown function: ${String(name)}`);
  const json = stableJson(args ?? {});
  let tag = "wg";
  let n = 0;
  while (json.includes(`$${tag}$`)) tag = `wg${++n}`;
  return `select api.${name}($${tag}$${json}$${tag}$::jsonb) as data`;
}

/**
 * The Supabase connector's execute_sql answers with text that wraps the
 * rows (a JSON array) between <untrusted-data-…> tags. Accept that, a bare
 * JSON array, or an object carrying either under `result`.
 */
export function parseExecuteSqlRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  let text: string | null = null;
  if (typeof payload === "string") text = payload;
  else if (payload && typeof payload === "object") {
    const result = (payload as { result?: unknown }).result;
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (typeof result === "string") text = result;
  }
  if (text === null) throw new Error("The database answered in an unexpected format.");
  const wrapped = /<untrusted-data-[^>]*>\s*([\s\S]*?)\s*<\/untrusted-data-[^>]*>/.exec(text);
  const body = (wrapped ? wrapped[1] : text).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end < start) throw new Error("The database answer held no rows.");
  const rows: unknown = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error("The database answer held no rows.");
  return rows as Record<string, unknown>[];
}
