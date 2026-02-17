import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/tiles",
        destination: `${API_URL}/api/tiles`,
      },
      {
        source: "/api/health",
        destination: `${API_URL}/health`,
      },
    ];
  },
};

export default nextConfig;
