import { z } from "zod";

export const conversationOperationSchema = z.object({
  outcome: z.enum(["created", "existing", "needs_input"]),
  workstreamId: z.uuid().optional(),
  workstreamVersion: z.number().int().positive().optional(),
  title: z.string(),
});
export type ConversationOperation = z.infer<typeof conversationOperationSchema>;
