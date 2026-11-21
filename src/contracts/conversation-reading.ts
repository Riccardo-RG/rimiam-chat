import { z } from "zod";

export const conversationDirectoryEntrySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lastActivityAt: z.string(),
  preview: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
  mentionCount: z.number().int().nonnegative(),
  firstMentionId: z.uuid().nullable(),
  requestCount: z.number().int().nonnegative(),
  firstRequestId: z.uuid().nullable(),
});
export type ConversationDirectoryEntry = z.infer<
  typeof conversationDirectoryEntrySchema
>;

export const readingAnchorSchema = z.object({
  id: z.uuid(),
  offset: z.number().int().min(-200000).max(200000),
  atBottom: z.boolean().optional(),
  expectedVersion: z.number().int().nonnegative(),
});
export const readingInputSchema = z
  .object({
    expectedActorId: z.string().min(1),
    admission: z.number().int().positive(),
    seen: z.array(z.uuid()).max(100),
    anchor: readingAnchorSchema.optional(),
  })
  .strict();
export type ReadingInput = z.infer<typeof readingInputSchema>;
export const personalReadingSchema = z.object({
  admission: z.int().positive(),
  anchorId: z.uuid().nullable(),
  anchorOffset: z.int(),
  anchorAtBottom: z.boolean().optional(),
  cursorVersion: z.int().nonnegative(),
  unreadIds: z.array(z.uuid()),
  mentionIds: z.array(z.uuid()),
  requestIds: z.array(z.uuid()),
});
export type PersonalReading = z.infer<typeof personalReadingSchema>;
export const conversationAddressFields = {
  quoteMessageId: z.uuid().optional(),
  mentionIds: z.array(z.string().min(1).max(256)).max(40).optional(),
};
export const conversationAnswerCommands = [
  z.object({
    type: z.literal("conversation.requestAnswer"),
    messageId: z.uuid(),
    recipients: z.array(z.string().min(1).max(256)).min(1).max(40),
  }),
  z.object({ type: z.literal("conversation.answered"), messageId: z.uuid() }),
] as const;
