import { defineConfig } from "@playwright/test";
const isolatedPort = process.env.MIRIAM_E2E_PORT;
const runDirectory =
  isolatedPort && /^\d{4,5}$/.test(isolatedPort)
    ? `.next-e2e/${isolatedPort}/`
    : "";
export default defineConfig({
  outputDir: runDirectory + "test-results",
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    locale: "it-IT",
    actionTimeout: 15000,
    baseURL: process.env.MIRIAM_TEST_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: runDirectory + "playwright-report" },
    ],
  ],
});
