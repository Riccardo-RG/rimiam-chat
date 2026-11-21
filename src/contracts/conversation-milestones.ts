import { z } from "zod";
export const conversationMilestoneSchema = z.object({
  id: z.string(),
  kind: z.enum(["decision", "completed"]),
  objectId: z.string(),
  anchor: z.uuid(),
  at: z.iso.datetime(),
  label: z.string(),
  conclusion: z.string().optional(),
  completionRevision: z.number().int().positive().optional(),
});
export const conversationMilestonesSchema = z.object({
  items: z.array(conversationMilestoneSchema),
});
export type ConversationMilestone = z.infer<typeof conversationMilestoneSchema>;
