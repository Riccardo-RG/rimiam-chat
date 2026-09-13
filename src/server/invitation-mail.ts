import { z } from "zod";

export const invitationPayloadSchema = z
  .object({
    from: z.email(),
    to: z.tuple([z.email()]),
    subject: z.literal("Invito a MIRIAM"),
    text: z.string().min(1).max(4000),
  })
  .strict();
export type InvitationPayload = z.infer<typeof invitationPayloadSchema>;
export interface InvitationMailTransport {
  prepare(recipient: string, url: string): InvitationPayload;
  send(
    payload: InvitationPayload,
    key: string,
  ): Promise<{ deliveryId: string }>;
}

export function resendInvitationMail(
  settings: { apiKey: string; from: string; origin: string },
  http: typeof fetch = fetch,
): InvitationMailTransport {
  const origin = new URL(settings.origin);
  if (
    !settings.apiKey ||
    !z.email().safeParse(settings.from).success ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password
  )
    throw new Error("MAIL_CONFIGURATION_REQUIRED");
  return {
    prepare(recipient, link) {
      const url = new URL(link);
      if (
        url.origin !== origin.origin ||
        url.pathname !== "/" ||
        url.username ||
        url.password ||
        url.hash ||
        [...url.searchParams.keys()].join() !== "invite" ||
        !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("invite") ?? "")
      )
        throw new Error("MAIL_INVITATION_URL_INVALID");
      // No name, Goal, membership roster or private Workspace material crosses this boundary.
      return invitationPayloadSchema.parse({
        from: settings.from,
        to: [recipient],
        subject: "Invito a MIRIAM",
        text: `Hai ricevuto un invito personale a uno spazio MIRIAM. Apri il link e accedi con questo indirizzo email:\n\n${url.href}\n\nAccettando potrai leggere la storia condivisa conservata nello spazio. L’invito non attribuisce adesione al Goal o authority decisionale. Se non ti aspettavi questo invito, ignoralo.`,
      });
    },
    async send(payload, key) {
      invitationPayloadSchema.parse(payload);
      if (!/^invitation\/[0-9a-f-]{36}$/.test(key))
        throw new Error("MAIL_DELIVERY_KEY_INVALID");
      try {
        const response = await http("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!response.ok) throw new Error();
        const body = await response.text();
        if (body.length > 65536) throw new Error();
        return {
          deliveryId: z.object({ id: z.uuid() }).parse(JSON.parse(body)).id,
        };
      } catch {
        throw new Error("MAIL_DELIVERY_UNCONFIRMED");
      }
    },
  };
}

export function configuredInvitationMail(): InvitationMailTransport {
  if (
    process.env.MAIL_PROVIDER !== "resend" ||
    !process.env.RESEND_API_KEY ||
    !process.env.MAIL_FROM ||
    !process.env.BETTER_AUTH_URL
  )
    throw new Error("MAIL_CONFIGURATION_REQUIRED");
  return resendInvitationMail({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM,
    origin: process.env.BETTER_AUTH_URL,
  });
}
