import type { NextConfig } from "next";

/*
  Option A proxy: browser calls to same-origin /api/* are rewritten to the
  backend. The backend's httpOnly session cookie (enviable.sid) flows back
  via Set-Cookie and is sent on subsequent requests; JavaScript never sees it.
  Next.js rewrites are transparent reverse proxies, so both directions of the
  Cookie / Set-Cookie headers are forwarded faithfully.

  The backend base URL is configurable via BACKEND_API_URL; default targets
  the local Docker dev stack at http://localhost:3000.
*/

const backendApiUrl =
  process.env.BACKEND_API_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendApiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
