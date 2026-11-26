import { z } from "zod";
export const nativePushProvider = z.enum(["apns", "fcm"]);
export type NativePushProvider = z.infer<typeof nativePushProvider>;
export const nativePushChange = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("enable"),
      consent: z.literal(true),
      workspaceId: z.uuid(),
      installation: z.uuidv4(),
      localizedAlerts: z.literal(true).optional(),
      subscription: z.discriminatedUnion("provider", [
        z
          .object({
            provider: z.literal("apns"),
            token: z.string().regex(/^(?:[a-f0-9]{2}){16,200}$/i),
          })
          .strict(),
        z
          .object({
            provider: z.literal("fcm"),
            token: z.string().regex(/^[A-Za-z0-9_:-]{32,4096}$/),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("disable"),
      workspaceId: z.uuid(),
      deviceId: z.uuid(),
      provider: nativePushProvider,
    })
    .strict(),
]);
export const nativePushPreference = z.object({
  configured: z.boolean(),
  deviceId: z.uuid().nullable(),
  optedIn: z.boolean(),
  enabled: z.boolean(),
});
export const nativePushReceipt = z.object({
  deviceId: z.uuid(),
  enabled: z.boolean(),
});
export const nativePushTarget = z.object({
  workspaceId: z.uuid(),
  messageId: z.uuid().optional(),
});
