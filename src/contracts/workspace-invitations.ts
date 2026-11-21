import { z } from "zod";

export const MAX_WORKSPACE_INVITE_RECIPIENTS = 25;
const workspaceInviteRecipientSchema = z.union([
  z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).strict(),
  z.object({ contactId: z.string().min(1).max(256) }).strict(),
]);
export const workspaceInvitationsSchema = z
  .object({
    recipients: z
      .array(workspaceInviteRecipientSchema)
      .min(1)
      .max(MAX_WORKSPACE_INVITE_RECIPIENTS),
    fullHistoryDisclosed: z.literal(true),
  })
  .strict();

export type WorkspaceInvitations = z.infer<typeof workspaceInvitationsSchema>;
export type WorkspaceInviteRecipient = z.infer<
  typeof workspaceInviteRecipientSchema
>;
