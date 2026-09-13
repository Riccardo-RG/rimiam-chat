import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  distDir: process.env.MIRIAM_E2E === "true" ? ".next-e2e" : ".next",
  logging: { incomingRequests: false },
  devIndicators: false,
  serverExternalPackages: ["pg", "graphile-worker"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/account/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
