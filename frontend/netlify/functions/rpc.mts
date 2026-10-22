/**
 * Website data endpoint: POST /api/rpc {fn, args} → select api.<fn>(args).
 * (netlify.toml redirects /api/rpc here.) Read-only for every visitor; the
 * viewer's country comes from Netlify's geo data, never from the browser,
 * so real-money forecast providers stay hidden where they're not allowed.
 *
 * Environment: DATABASE_URL (Supabase → Connect → pooler URI). TLS is always
 * verified against Supabase's root CA (bundled in server/db.ts); set
 * DATABASE_CA_CERT (PEM) only to trust a different CA.
 */
import pg from "pg";

import { websitePoolConfig } from "../../server/db.ts";
import { bodyTooLarge, handleRpc } from "../../server/rpc.ts";

/** The part of Netlify's function context we use. */
interface NetlifyContext {
  geo?: { country?: { code?: string } };
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (pool) return pool;
  const config = websitePoolConfig(process.env, 2);
  if (!config) return null;
  // No per-connection setup: every api.* function sets its own search_path.
  pool = new pg.Pool(config);
  return pool;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async function rpc(req: Request, context: NetlifyContext): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  // Refuse a large upload from its declared size, before reading it.
  if (bodyTooLarge(req.headers)) return json(413, { error: "Request too large." });
  const db = getPool();
  if (!db) return json(503, { error: "The database isn't set up yet." });
  const code = context.geo?.country?.code;
  const result = await handleRpc(db, await req.text(), {
    viewerCountry: code && /^[A-Z]{2}$/.test(code) ? code : null,
    allowWrites: false,
  });
  return json(result.status, result.body);
}
