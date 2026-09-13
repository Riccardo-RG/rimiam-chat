import { afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../src/server/db";
import {
  enqueueAccountMail,
  processAccountMail,
  encryptAccountLink,
  decryptAccountLink,
} from "../src/server/account-delivery";
import {
  resendVerificationMail,
  type VerificationMailTransport,
} from "../src/server/verification-mail";
import {
  safeAccountReturn,
  accountReturnFromSearch,
} from "../src/shared/account-navigation";
afterAll(() => pool.end());
describe("Account delivery boundary", () => {
  it("encrypts links, binds their recipient/type/identity, deduplicates jobs and never republishes acknowledged delivery", async () => {
    const email = `${randomUUID()}@example.test`,
      url = `https://miriam.example.test/api/auth/reset-password/${randomUUID()}?callbackURL=x`;
    await enqueueAccountMail("password-reset", email, url);
    await enqueueAccountMail("password-reset", email, url);
    const rows = (
      await pool.query("SELECT * FROM account_delivery WHERE recipient=$1", [
        email,
      ])
    ).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.encrypted_link).not.toContain(url);
    expect(row.encrypted_link).not.toContain("/api/auth");
    let calls = 0;
    const sender: VerificationMailTransport = {
      async sendVerification() {
        throw new Error("Wrong capability");
      },
      async sendPasswordReset(to, link) {
        calls++;
        expect(to).toBe(email);
        expect(link).toBe(url);
        return { deliveryId: "remote-receipt" };
      },
    };
    await processAccountMail(row.id, sender);
    await processAccountMail(row.id, sender);
    expect(calls).toBe(1);
    expect(
      (
        await pool.query("SELECT status FROM account_delivery WHERE id=$1", [
          row.id,
        ])
      ).rows[0].status,
    ).toBe("delivered");
    await expect(
      pool.query(
        "UPDATE account_delivery SET recipient='different@example.test' WHERE id=$1",
        [row.id],
      ),
    ).rejects.toThrow("immutable");
    const encrypted = encryptAccountLink(url, "identity-a");
    expect(decryptAccountLink(encrypted, "identity-a")).toBe(url);
    expect(() => decryptAccountLink(encrypted, "identity-b")).toThrow();
  });
  it("keeps uncertain outcomes pending and retries exactly the same link with the same provider key", async () => {
    const email = `${randomUUID()}@example.test`,
      url = `https://miriam.example.test/api/auth/reset-password/${randomUUID()}?callbackURL=x`;
    await enqueueAccountMail("password-reset", email, url);
    const row = (
      await pool.query("SELECT id FROM account_delivery WHERE recipient=$1", [
        email,
      ])
    ).rows[0];
    const keys: string[] = [];
    let calls = 0;
    const sender = resendVerificationMail(
      {
        apiKey: "test-only",
        from: "account@example.test",
        authOrigin: "https://miriam.example.test",
      },
      async (_, init) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
        calls++;
        if (calls === 1)
          throw new Error(
            "Simulated lost acknowledgement after remote delivery",
          );
        return Response.json({ id: randomUUID() });
      },
    );
    await expect(processAccountMail(row.id, sender)).rejects.toThrow(
      "ACCOUNT_MAIL_DELIVERY_PENDING",
    );
    expect(
      (
        await pool.query("SELECT status FROM account_delivery WHERE id=$1", [
          row.id,
        ])
      ).rows[0].status,
    ).toBe("unknown");
    await processAccountMail(row.id, sender);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^password-reset\//);
  });
  it("does not call delivery without configuration or after expiry", async () => {
    const email = `${randomUUID()}@example.test`;
    await enqueueAccountMail(
      "verification",
      email,
      "https://miriam.example.test/api/auth/verify-email?token=placeholder",
    );
    const row = (
      await pool.query("SELECT id FROM account_delivery WHERE recipient=$1", [
        email,
      ])
    ).rows[0];
    const saved = process.env.MAIL_PROVIDER;
    process.env.MAIL_PROVIDER = "unconfigured";
    try {
      await processAccountMail(row.id);
    } finally {
      if (saved) process.env.MAIL_PROVIDER = saved;
      else delete process.env.MAIL_PROVIDER;
    }
    expect(
      (
        await pool.query("SELECT status FROM account_delivery WHERE id=$1", [
          row.id,
        ])
      ).rows[0].status,
    ).toBe("needs_configuration");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO account_delivery(id,deduplication_key,kind,recipient,encrypted_link,expires_at) VALUES($1::uuid,$1::text,'verification',$2,'unused',now()-interval '1 second')",
      [id, email],
    );
    const forbidden = async () => {
      throw new Error("Must not send");
    };
    await processAccountMail(id, {
      sendVerification: forbidden,
      sendPasswordReset: forbidden,
    });
    expect(
      (
        await pool.query("SELECT status FROM account_delivery WHERE id=$1", [
          id,
        ])
      ).rows[0].status,
    ).toBe("expired");
  });
});
describe("Account return destinations", () => {
  it("preserves only a known invitation or Workspace route and strips external redirects/tokens", () => {
    const invite = "a".repeat(43),
      w = randomUUID();
    expect(accountReturnFromSearch(`?invite=${invite}`)).toBe(
      `/?invite=${invite}`,
    );
    expect(
      accountReturnFromSearch(
        `?returnTo=${encodeURIComponent("/?workspace=" + w)}&token=secret`,
      ),
    ).toBe("/?workspace=" + w);
    for (const raw of [
      "https://evil.test/",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "/account/recovery?token=secret",
      "/?redirect=https://evil.test",
    ])
      expect(safeAccountReturn(raw)).toBe("/");
  });
});
