import type { IncomingMessage } from "node:http";

import type { Plugin } from "vite";

/**
 * `npm run dev` serves POST /api/rpc from a local Postgres
 * (DEV_DATABASE_URL, default postgresql://wg:wg@localhost:5432/worldgraph_dev),
 * mirroring the Netlify function the website uses.
 */
export function rpcDevPlugin(): Plugin {
  return {
    name: "worldgraph-rpc-dev",
    apply: "serve",
    async configureServer(server) {
      const { default: pg } = await import("pg");
      const { handleRpc } = await server.ssrLoadModule("/server/rpc.ts");
      const pool = new pg.Pool({
        connectionString: process.env.DEV_DATABASE_URL ?? "postgresql://wg:wg@localhost:5432/worldgraph_dev",
        max: 4,
      });
      pool.on("connect", (client) => void client.query("set search_path to public, extensions"));
      server.middlewares.use("/api/rpc", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const body = await readBody(req);
        const result = await handleRpc(pool, body, {
          viewerCountry: process.env.WG_DEV_VIEWER_COUNTRY || null,
          allowWrites: true,
        });
        res.statusCode = result.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
