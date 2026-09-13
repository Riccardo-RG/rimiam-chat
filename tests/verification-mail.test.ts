import { describe, it, expect } from "vitest";
import {
  resendVerificationMail,
  configuredVerificationMail,
} from "../src/server/verification-mail";
const settings = {
  apiKey: "dummy-unit-test-key",
  from: "verify@example.test",
  authOrigin: "https://miriam.example.test",
};
const url =
  "https://miriam.example.test/api/auth/verify-email?token=dummy-verification-token";
describe("Account verification delivery boundary", () => {
  it("sends exactly the requested verification using a stable idempotency key and a validated acknowledgement", async () => {
    const requests: RequestInit[] = [];
    const sender = resendVerificationMail(settings, async (input, init) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      requests.push(init!);
      return Response.json({ id: "2f564a9f-c9da-4c39-84fd-8361fd6d34b6" });
    });
    await sender.sendVerification("person@example.test", url);
    await sender.sendVerification("person@example.test", url);
    const first = new Headers(requests[0].headers),
      second = new Headers(requests[1].headers);
    expect(first.get("Idempotency-Key")).toBe(second.get("Idempotency-Key"));
    expect(first.get("Idempotency-Key")).not.toContain(
      "dummy-verification-token",
    );
    expect(first.get("Authorization")).toBe("Bearer dummy-unit-test-key");
    const body = JSON.parse(String(requests[0].body));
    expect(body.to).toEqual(["person@example.test"]);
    expect(body.text).toContain(url);
    expect(body.html).toBeUndefined();
    expect(first.has("Cookie")).toBe(false);
  });
  it("rejects wrong origins, wrong paths and malformed recipients before transport", async () => {
    let calls = 0;
    const sender = resendVerificationMail(settings, async () => {
      calls++;
      return Response.json({});
    });
    for (const invalid of [
      "https://evil.example/api/auth/verify-email?token=x",
      "https://miriam.example.test/reset?token=x",
      "https://miriam.example.test/api/auth/verify-email",
      "https://u:p@miriam.example.test/api/auth/verify-email?token=x",
    ])
      await expect(
        sender.sendVerification("person@example.test", invalid),
      ).rejects.toThrow("MAIL_VERIFICATION_URL_INVALID");
    await expect(
      sender.sendVerification(
        "person@example.test\nBcc: other@example.test",
        url,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
    expect(() =>
      resendVerificationMail({
        ...settings,
        authOrigin: "http://miriam.example.test",
      }),
    ).toThrow("MAIL_CONFIGURATION_INVALID");
  });
  it("reports uncertain delivery and rate limits without retries or secret disclosure", async () => {
    for (const response of [
      () => Promise.reject(new Error(url)),
      () => Promise.resolve(new Response(url, { status: 500 })),
      () => Promise.resolve(Response.json({ wrong: url })),
      () => Promise.resolve(new Response("x".repeat(65537))),
    ]) {
      let calls = 0;
      const sender = resendVerificationMail(settings, async () => {
        calls++;
        return response();
      });
      await expect(
        sender.sendVerification("person@example.test", url),
      ).rejects.toThrow("MAIL_DELIVERY_UNCONFIRMED");
      expect(calls).toBe(1);
    }
    await expect(
      resendVerificationMail(
        settings,
        async () => new Response("", { status: 429 }),
      ).sendVerification("person@example.test", url),
    ).rejects.toThrow("MAIL_RATE_LIMITED");
    const saved = process.env.MAIL_PROVIDER;
    process.env.MAIL_PROVIDER = "unconfigured";
    try {
      expect(() => configuredVerificationMail()).toThrow(
        "MAIL_CONFIGURATION_REQUIRED",
      );
    } finally {
      if (saved === undefined) delete process.env.MAIL_PROVIDER;
      else process.env.MAIL_PROVIDER = saved;
    }
  });
});
