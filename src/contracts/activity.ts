import { z } from "zod";

export const conversationReferenceSchema = z
  .object({
    kind: z.enum([
      "goal",
      "information",
      "commitment",
      "task",
      "artifact",
      "question",
      "workstream",
      "active_work",
      "scheduled_event",
      "source",
    ]),
    id: z.uuid(),
    // Active Work uses the immutable meaningful-event revision, not Work Contract version.
    version: z.number().int().positive(),
    eventId: z.string().min(1).max(220).optional(),
  })
  .strict();
export type ConversationReference = z.infer<typeof conversationReferenceSchema>;
export const activityEventSchema = z.object({
  eventId: z.string(),
  occurredAt: z.string(),
  actor: z.string().nullable(),
  actorName: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  qualification: z.string(),
  reference: conversationReferenceSchema,
});
export const activitySchema = z.object({
  events: z.array(activityEventSchema),
  next: z.string().nullable(),
});
export const referenceDetailSchema = z.object({
  reference: conversationReferenceSchema,
  title: z.string(),
  content: z.string(),
  qualification: z.string(),
  actor: z.string().nullable(),
  createdAt: z.string(),
  current: z.boolean(),
  sourceIds: z.array(z.uuid()),
  provenance: z.record(z.string(), z.unknown()),
  event: activityEventSchema.nullable(),
});
export type ReferenceDetail = z.infer<typeof referenceDetailSchema>;
