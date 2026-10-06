import type { NextConfig } from "next";

// The browser only ever talks to this web app. Requests to /api/* are passed
// on to the Python API, so there are no cross-origin (CORS) issues and the
// API's address stays a server-side setting.
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
