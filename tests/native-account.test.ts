import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { handleAPI } from "../src/server/api";
import { pool } from "../src/server/db";
afterAll(() => pool.end());
const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const call = (data: unknown, headers: Record<string, string> = {}) =>
  handleAPI(
    new Request(`${base}/api/v1/native/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    }),
  );
it("registers through real auth without returning cookie/token or bypassing verification", async () => {
  const email = `${randomUUID()}@example.test`;
  const res = await call({
    action: "register",
    name: "Native newcomer",
    email,
    password: "Native-onboarding-2026!",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ requested: true });
  expect(res.headers.has("set-cookie")).toBe(false);
  expect(res.headers.has("set-auth-token")).toBe(false);
  const u = (
    await pool.query('SELECT id,"emailVerified" FROM "user" WHERE email=$1', [
      email,
    ])
  ).rows[0];
  expect(u.emailVerified).toBe(false);
  expect(
    (await pool.query("SELECT * FROM membership WHERE user_id=$1", [u.id]))
      .rowCount,
  ).toBe(0);
});
it("rejects browser transport, arbitrary callbacks and weak credentials", async () => {
  const data = {
    action: "request-password-reset",
    email: `${randomUUID()}@example.test`,
  };
  expect((await call(data, { Origin: base })).status).toBe(403);
  expect((await call(data, { Cookie: "attacker=x" })).status).toBe(403);
  expect(
    (await call({ ...data, redirectTo: "https://example.com" })).status,
  ).toBe(400);
  expect(
    (
      await call({
        action: "register",
        name: "Test",
        email: data.email,
        password: "short",
      })
    ).status,
  ).toBe(400);
});
it("returns generic requested status for absent recovery/verification accounts", async () => {
  for (const action of ["request-password-reset", "send-verification"]) {
    const res = await call({ action, email: `${randomUUID()}@example.test` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
  }
});
