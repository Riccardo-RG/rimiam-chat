import { z } from "zod";
import { conversationReferenceSchema } from "./activity.ts";

export const handoffKindSchema = z.enum([
  "goal.establish",
  "goal.change",
  "information.accept",
  "information.correct",
  "project.propose",
  "project.replace",
  "project.revoke",
  "task.create",
  "task.change",
  "artifact.prepare",
  "email.prepare",
  "calendar.prepare",
]);
// Navigation metadata, deliberately excluding executable commands, people and authority.
export const handoffSuggestionSchema = z
  .object({
    kind: handoffKindSchema,
    summary: z.string().trim().min(1).max(500),
    suggestedText: z.string().trim().min(1).max(12000),
    target: conversationReferenceSchema.nullable(),
    candidateIndex: z.number().int().min(0).max(11).nullable(),
    sourceIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict();
export type HandoffSuggestion = z.infer<typeof handoffSuggestionSchema>;
export const conversationOriginSchema = z
  .object({ handoffId: z.uuid() })
  .strict();
export const conversationHandoffSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  sourceMessageId: z.uuid(),
  kind: handoffKindSchema,
  summary: z.string(),
  suggestedText: z.string(),
  target: conversationReferenceSchema.nullable(),
  candidateId: z.uuid().nullable(),
  sourceIds: z.array(z.uuid()),
  status: z.enum(["ready", "stale", "applied", "navigation"]),
  createdAt: z.string(),
  application: z
    .object({
      actor: z.string(),
      commandId: z.uuid(),
      commandType: z.string(),
      createdAt: z.string(),
      resultReference: conversationReferenceSchema.nullable(),
      prepared: z
        .object({
          kind: z.enum([
            "goal_transition",
            "project_proposal",
            "task_revision_proposal",
          ]),
          id: z.uuid(),
        })
        .nullable(),
    })
    .nullable(),
});
export const conversationHandoffsSchema = z.object({
  handoffs: z.array(conversationHandoffSchema),
});
export type ConversationHandoff = z.infer<typeof conversationHandoffSchema>;
