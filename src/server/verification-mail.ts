import { createHash } from "node:crypto";
import { z } from "zod";

// Account security mail only. This grants no Workspace email capability.
export interface VerificationMailTransport {
  sendPasswordReset(
    recipient: string,
    resetURL: string,
  ): Promise<{ deliveryId: string }>;
  sendVerification(
    recipient: string,
    verificationURL: string,
  ): Promise<{ deliveryId: string }>;
}
export function resendVerificationMail(
  settings: { apiKey: string; from: string; authOrigin: string },
  http: typeof fetch = fetch,
): VerificationMailTransport {
  const from = z.email().parse(settings.from);
  const origin = new URL(settings.authOrigin);
  if (
    !settings.apiKey ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password
  )
    throw new Error("MAIL_CONFIGURATION_INVALID");
  async function send(
    kind: "verification" | "password-reset",
    recipient: string,
    verificationURL: string,
  ) {
    z.email().parse(recipient);
    const url = new URL(verificationURL);
    if (
      url.origin !== origin.origin ||
      (kind === "verification"
        ? url.pathname !== "/api/auth/verify-email" ||
          !url.searchParams.get("token")
        : !/^\/api\/auth\/reset-password\/[a-zA-Z0-9_-]{16,128}$/.test(
            url.pathname,
          )) ||
      url.username ||
      url.password
    )
      throw new Error(
        kind === "verification"
          ? "MAIL_VERIFICATION_URL_INVALID"
          : "MAIL_RESET_URL_INVALID",
      );
    const key =
      kind +
      "/" +
      createHash("sha256")
        .update(JSON.stringify([from, recipient, url.href]))
        .digest("hex");
    // Same verification delivery => same payload/key. No hidden retries after an uncertain outcome.
    let response: Response;
    try {
      response = await http("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject:
            kind === "verification"
              ? "Verifica il tuo indirizzo email per MIRIAM"
              : "Reimposta la tua password MIRIAM",
          text:
            kind === "verification"
              ? `Apri questo link per verificare il tuo indirizzo email per MIRIAM:\n\n${url.href}\n\nSe non hai richiesto un account, ignora questa email.`
              : `Hai richiesto di reimpostare la password MIRIAM. Apri questo link:\n\n${url.href}\n\nSe non hai effettuato questa richiesta, ignora questa email.`,
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      // Never log provider responses, recipient addresses or verification tokens.
      throw new Error("MAIL_DELIVERY_UNCONFIRMED");
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "MAIL_RATE_LIMITED"
          : "MAIL_DELIVERY_UNCONFIRMED",
      );
    try {
      const body = await response.text();
      if (body.length > 65536) throw new Error();
      const result = z.object({ id: z.uuid() }).parse(JSON.parse(body));
      return { deliveryId: result.id };
    } catch {
      throw new Error("MAIL_DELIVERY_UNCONFIRMED");
    }
  }
  return {
    sendVerification: (recipient, url) => send("verification", recipient, url),
    sendPasswordReset: (recipient, url) =>
      send("password-reset", recipient, url),
  };
}
export function configuredVerificationMail(): VerificationMailTransport {
  if (
    process.env.MAIL_PROVIDER !== "resend" ||
    !process.env.RESEND_API_KEY ||
    !process.env.MAIL_FROM ||
    !process.env.BETTER_AUTH_URL
  )
    throw new Error("MAIL_CONFIGURATION_REQUIRED");
  return resendVerificationMail({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM,
    authOrigin: process.env.BETTER_AUTH_URL,
  });
}
