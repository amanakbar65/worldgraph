/**
 * Website data endpoint: POST /api/rpc {fn, args} → select api.<fn>(args).
 * (netlify.toml redirects /api/rpc here.) Read-only for every visitor; the
 * viewer's country comes from Netlify's geo data, never from the browser,
 * so real-money forecast providers stay hidden where they're not allowed.
 *
 * Environment: DATABASE_URL (Supabase → Connect → Session pooler URI);
 * optional DATABASE_CA_CERT (Supabase's CA certificate, PEM) to verify TLS.
 */
import pg from "pg";

import { handleRpc } from "../../server/rpc.ts";

/** The part of Netlify's function context we use. */
interface NetlifyContext {
  geo?: { country?: { code?: string } };
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (pool) return pool;
  const ca = process.env.DATABASE_CA_CERT;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    // Supabase's certificate is signed by its own CA: verify against it when given.
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  // No per-connection setup: every api.* function sets its own search_path.
  return pool;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async function rpc(req: Request, context: NetlifyContext): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!process.env.DATABASE_URL) return json(503, { error: "The database isn't set up yet." });
  const code = context.geo?.country?.code;
  const result = await handleRpc(getPool(), await req.text(), {
    viewerCountry: code && /^[A-Z]{2}$/.test(code) ? code : null,
    allowWrites: false,
  });
  return json(result.status, result.body);
}
