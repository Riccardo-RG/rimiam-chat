import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { handleAPI } from "../src/server/api";

afterAll(() => pool.end());
it("preserves the real native login rate limit and reports throttling instead of invalid credentials", async () => {
  const email = `${randomUUID()}@example.test`,
    password = "Rate-limit-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Native limiter verification" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const call = (suppliedPassword = password) =>
    handleAPI(
      new Request("http://localhost/api/v1/native/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: suppliedPassword }),
      }),
    );
  const invalid = await call("Incorrect-test-only-password");
  expect(invalid.status).toBe(401);
  expect((await invalid.json()).error.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  expect((await call()).status).toBe(200);
  expect((await call()).status).toBe(200);
  const before = (
    await pool.query(
      'SELECT count(*)::int AS count FROM session WHERE "userId"=$1',
      [user.id],
    )
  ).rows[0].count;
  const limited = await call();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({
    error: { code: "TOO_MANY_REQUESTS", recovery: "none" },
  });
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM session WHERE "userId"=$1',
        [user.id],
      )
    ).rows[0].count,
  ).toBe(before);
});
