import { test as base, expect } from "@playwright/test";
import { pool } from "../../src/server/db";
// Both capability specs use the same process-local pool. Close it at worker teardown,
// never after a single spec while the next one can still need it.
export const test = base.extend<object, { backendPool: void }>({
  backendPool: [
    async ({}, use) => {
      await use();
      await pool.end();
    },
    { scope: "worker", auto: true },
  ],
});
export { expect };
