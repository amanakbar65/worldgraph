/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { rpcDevPlugin } from "./dev/rpc-dev-plugin";

/**
 * Two build targets from one codebase:
 * - `web` (default): the website. /api/* goes to Netlify functions (or the
 *   local dev middleware below).
 * - `artifact` (`vite build --mode artifact`): the claude.ai test link. Data
 *   comes through the viewer's Supabase connector, AI through `sample`.
 */
export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  return {
    base: "./",
    plugins: [react(), tailwindcss(), rpcDevPlugin()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    define: {
      __WG_TARGET__: JSON.stringify(artifact ? "artifact" : "web"),
      // Not secret: the project id is how the connector knows which database to query.
      __WG_SUPABASE_PROJECT__: JSON.stringify("xmznnjpflimsjvwftxpa"),
      __WG_CONNECTOR__: JSON.stringify("Supabase"),
    },
    build: {
      outDir: artifact ? "dist-artifact" : "dist",
      assetsDir: "assets",
      chunkSizeWarningLimit: 4000,
      sourcemap: false,
    },
    server: { port: 5173, host: "127.0.0.1" },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
