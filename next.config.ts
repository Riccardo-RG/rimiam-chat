import type { NextConfig } from "next";
import {
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const e2e = process.env.MIRIAM_E2E === "true";
const e2ePort = process.env.MIRIAM_E2E_PORT ?? "3100";
if (e2e && !/^\d{4,5}$/.test(e2ePort)) throw new Error("Invalid E2E port");
const distDir = e2e ? `.next-e2e/${e2ePort}/app` : ".next";
export default function config(phase: string): NextConfig {
  // Build workers inherit the same id. Starting another replica reuses the id
  // stored by Next with the build, regardless of the host or deployment service.
  const release =
    phase === PHASE_PRODUCTION_SERVER
      ? readFileSync(join(distDir, "BUILD_ID"), "utf8").trim()
      : phase === PHASE_PRODUCTION_BUILD
        ? (process.env.RIMIAM_INTERNAL_BUILD_NONCE ??= randomUUID())
        : (process.env.RIMIAM_INTERNAL_BUILD_NONCE ?? "development");
  return {
    generateBuildId: () => release,
    env: { RIMIAM_WEB_RELEASE: release },
    agentRules: false,
    distDir,
    ...(e2e
      ? { typescript: { tsconfigPath: `.next-e2e/${e2ePort}/tsconfig.json` } }
      : {}),
    logging: { incomingRequests: false },
    devIndicators: false,
    // Root PDFs are local documents excluded from Git and the deployment context.
    outputFileTracingExcludes: { "/api/**": ["./*.[pP][dD][fF]"] },
    // Python and FFmpeg come from the host. Only these document helpers ship with the API.
    outputFileTracingIncludes: {
      "/api/**": [
        "./scripts/extract-document.py",
        "./scripts/render-pdf-preview.py",
      ],
    },
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
}
