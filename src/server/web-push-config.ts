import { createHash, ECDH } from "node:crypto";
import { z } from "zod";

export const pushHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Never let an authenticated client turn the sender into an arbitrary HTTP client.
// These are browser-vendor push endpoints, not user-managed webhook hosts.
export function validPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.href === value &&
      (host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.services.mozilla.com") ||
        host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
function validPublicKey(value: string) {
  try {
    const key = Buffer.from(value, "base64url");
    return (
      key.length === 65 &&
      key[0] === 4 &&
      ECDH.convertKey(key, "prime256v1").byteLength === 65
    );
  } catch {
    return false;
  }
}
export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().max(2048).refine(validPushEndpoint),
    keys: z
      .object({
        p256dh: z
          .string()
          .regex(/^[A-Za-z0-9_-]{87}$/)
          .refine(validPublicKey),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      })
      .strict(),
  })
  .strict();
export type BrowserPushSubscription = z.infer<typeof pushSubscriptionSchema>;

export function pushConfiguration() {
  if (process.env.WEB_PUSH_ENABLED !== "true") return null;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT ?? "";
  if (
    !validPublicKey(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey) ||
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)
  )
    return null;
  return { publicKey, privateKey, subject };
}
