import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const password = "Original-password-2026!";
async function post(
  path: string,
  body: unknown,
  cookie = "",
  attempt = 0,
): Promise<Response> {
  const response = await auth.handler(
    new Request(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  if (response.status === 429) {
    if (attempt >= 3)
      throw new Error(
        "Auth rate limit did not recover within the test retry window",
      );
    // Exercise the real auth configuration; respect its limiter instead of disabling it.
    const seconds = Number(
      response.headers.get("x-retry-after") ??
        response.headers.get("retry-after") ??
        60,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    return post(path, body, cookie, attempt + 1);
  }
  return response;
}
async function account() {
  const email = `${randomUUID()}@example.test`;
  const signup = await post("sign-up/email", {
    email,
    password,
    name: "Recovery person",
  });
  expect(signup.ok).toBe(true);
  const user = (
    await pool.query('SELECT id FROM "user" WHERE email=$1', [email])
  ).rows[0];
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  return { email, id: user.id as string };
}
async function reset(email: string) {
  const r = await post("request-password-reset", {
    email,
    redirectTo: `${base}/account/recovery`,
  });
  expect(r.ok).toBe(true);
  const mail = (
    await pool.query(
      "SELECT link FROM local_mail WHERE recipient=$1 AND subject=$2 ORDER BY created_at DESC",
      [email, "Reset your MIRIAM password"],
    )
  ).rows[0];
  return new URL(mail.link).pathname.split("/").pop()!;
}
afterAll(() => pool.end());
describe(
  "Essential account recovery through the real auth boundary",
  { timeout: 180000 },
  () => {
    it("resets a password once, revokes existing sessions and leaves membership/authority unchanged", async () => {
      const { email, id } = await account();
      const login = await post("sign-in/email", { email, password });
      expect(login.ok).toBe(true);
      expect(
        (await pool.query('SELECT id FROM session WHERE "userId"=$1', [id]))
          .rowCount,
      ).toBeGreaterThan(0);
      const token = await reset(email);
      const changed = await post("reset-password", {
        token,
        newPassword: "New-password-2026!",
      });
      expect(changed.ok).toBe(true);
      expect(
        (await pool.query('SELECT id FROM session WHERE "userId"=$1', [id]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await post("reset-password", {
            token,
            newPassword: "Another-password-2026!",
          })
        ).ok,
      ).toBe(false);
      expect((await post("sign-in/email", { email, password })).ok).toBe(false);
      expect(
        (await post("sign-in/email", { email, password: "New-password-2026!" }))
          .ok,
      ).toBe(true);
      expect(
        (await pool.query("SELECT 1 FROM membership WHERE user_id=$1", [id]))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM access_relationship WHERE holder_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("consumes a reset token atomically under concurrent submissions", async () => {
      const { email } = await account();
      const token = await reset(email);
      const responses = await Promise.all([
        post("reset-password", { token, newPassword: "Concurrent-a-2026!" }),
        post("reset-password", { token, newPassword: "Concurrent-b-2026!" }),
      ]);
      expect(responses.filter((r) => r.ok)).toHaveLength(1);
    });
    it("rejects expired/invalid tokens and unsafe callbacks; responses do not disclose whether an email is registered", async () => {
      const { email, id } = await account();
      const token = await reset(email);
      await pool.query(
        "UPDATE verification SET \"expiresAt\"=now()-interval '1 second' WHERE value=$1",
        [id],
      );
      expect(
        (
          await post("reset-password", {
            token,
            newPassword: "Valid-password-2026!",
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await post("reset-password", {
            token: "invalid-token",
            newPassword: "Valid-password-2026!",
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await post("request-password-reset", {
            email,
            redirectTo: "https://evil.example/account/recovery",
          })
        ).status,
      ).toBe(403);
      const exists = await post("request-password-reset", {
          email,
          redirectTo: `${base}/account/recovery`,
        }),
        unknown = await post("request-password-reset", {
          email: `${randomUUID()}@example.test`,
          redirectTo: `${base}/account/recovery`,
        });
      expect(await exists.json()).toEqual(await unknown.json());
    });
    it("does not verify an email or restore account eligibility through password recovery", async () => {
      const { email, id } = await account();
      await pool.query(
        'UPDATE "user" SET "emailVerified"=false,eligible=false WHERE id=$1',
        [id],
      );
      const token = await reset(email);
      expect(
        (
          await post("reset-password", {
            token,
            newPassword: "Still-disabled-2026!",
          })
        ).ok,
      ).toBe(true);
      const row = (
        await pool.query(
          'SELECT eligible,"emailVerified" FROM "user" WHERE id=$1',
          [id],
        )
      ).rows[0];
      expect(row).toEqual({ eligible: false, emailVerified: false });
      expect(
        (
          await post("sign-in/email", {
            email,
            password: "Still-disabled-2026!",
          })
        ).ok,
      ).toBe(false);
    });
  },
);
