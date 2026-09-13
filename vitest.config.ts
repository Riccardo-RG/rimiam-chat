import { defineConfig } from "vitest/config";
import { loadEnvFile } from "node:process";
loadEnvFile(".env");
const database = new URL(process.env.DATABASE_URL!);
database.pathname = "/miriam_test";
export default defineConfig({
  test: {
    env: { DATABASE_URL: database.href, AI_MODE: "fixture" },
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
