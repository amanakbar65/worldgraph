/**
 * Website AI endpoint: POST /api/ai {task: "ask" | "projection", input}.
 * (netlify.toml redirects /api/ai here.) All the logic is in server/ai.ts:
 * input checks, the daily budget in llm_usage, the Claude API call and
 * usage logging. Story analysis is refused: the pipeline does it.
 *
 * Environment: ANTHROPIC_API_KEY, DATABASE_URL, optional DATABASE_CA_CERT,
 * WG_AI_MODEL (default claude-opus-5-5), WG_AI_DAILY_BUDGET_USD (default 2).
 */
import pg from "pg";

import { handleAi } from "../../server/ai.ts";
import { WEB_PROMPTS } from "../../server/prompts.generated.ts";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (pool) return pool;
  const ca = process.env.DATABASE_CA_CERT;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  return pool;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async function ai(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!process.env.DATABASE_URL) return json(503, { error: "WorldGraph AI isn't set up yet." });
  const result = await handleAi(await req.text(), {
    db: getPool(),
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      WG_AI_MODEL: process.env.WG_AI_MODEL,
      WG_AI_DAILY_BUDGET_USD: process.env.WG_AI_DAILY_BUDGET_USD,
    },
    prompts: WEB_PROMPTS,
    fetch,
  });
  return json(result.status, result.body);
}
