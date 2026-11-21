import { defineConfig } from "vitest/config";
import { loadEnvFile } from "node:process";
loadEnvFile(".env");
const database = new URL(process.env.DATABASE_URL!);
database.pathname = "/miriam_test";
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: database.href,
      AI_MODE: "fixture",
      WEB_PUSH_ENABLED: "false",
      // Independent provider-double tests share this DB; quota regressions
      // override these values explicitly instead of consuming a common budget.
      AI_MAX_INVOCATIONS_PER_MINUTE: "1000000",
      AI_MAX_INVOCATIONS_PER_DAY: "1000000",
      AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY: "1000000",
    },
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
