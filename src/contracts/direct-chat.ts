import { z } from "zod";
import {
  personalReadingSchema,
  readingAnchorSchema,
} from "./conversation-reading.ts";
const actor = z.string().min(1).max(256);
export const directOpenSchema = z
  .object({ expectedActorId: actor, contactId: actor })
  .strict();
const attachment = z
  .object({
    filename: z.string().min(1).max(180),
    bytesBase64: z.string().min(1).max(11184812),
  })
  .strict();
export const directInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("send"),
      expectedActorId: actor,
      id: z.uuid(),
      text: z.string().trim().max(12000),
      attachments: z.array(attachment).max(10).optional(),
      quoteId: z.uuid().optional(),
    })
    .strict()
    .refine((i) => !!i.text || !!i.attachments?.length),
  z
    .object({
      type: z.literal("read"),
      expectedActorId: actor,
      seen: z.array(z.uuid()).max(100),
      anchor: readingAnchorSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("consent"),
      expectedActorId: actor,
      enabled: z.boolean(),
      expectedVersion: z.int().nonnegative(),
      id: z.uuid(),
    })
    .strict(),
  z
    .object({ type: z.literal("recap"), expectedActorId: actor, id: z.uuid() })
    .strict(),
]);
export type DirectInput = z.infer<typeof directInputSchema>;
export const directEntrySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactId: actor,
  photoVersion: z.int().nullable(),
  lastActivityAt: z.string(),
  preview: z.string().nullable(),
  unreadCount: z.int().nonnegative(),
});
export type DirectEntry = z.infer<typeof directEntrySchema>;
export const directViewSchema = z.object({
  id: z.uuid(),
  me: actor,
  peer: z.object({
    id: actor,
    name: z.string(),
    photoVersion: z.int().nullable(),
  }),
  consent: z.boolean(),
  peerConsent: z.boolean(),
  consentVersion: z.int().nonnegative(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      authorId: actor,
      name: z.string(),
      text: z.string(),
      sentAt: z.string(),
      quoteId: z.uuid().nullable(),
      files: z.array(
        z.object({ id: z.uuid(), filename: z.string(), type: z.string() }),
      ),
    }),
  ),
  reading: personalReadingSchema,
  recaps: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      sourceIds: z.array(z.uuid()),
      createdAt: z.string(),
    }),
  ),
});
export type DirectView = z.infer<typeof directViewSchema>;
