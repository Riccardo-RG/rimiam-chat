import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    actionTimeout: 15000,
    baseURL: process.env.MIRIAM_TEST_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
