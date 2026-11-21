import { z } from "zod";

export const assistantConnectionId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const connectionRevision = z.string().regex(/^[a-f0-9]{64}$/);
const settings = {
  connectionId: assistantConnectionId,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .’'_-]*$/u),
  instructions: z
    .string()
    .trim()
    .max(5000)
    .refine((value) => !value.includes("\0")),
};
export const saveAssistantSettingsSchema = z.strictObject({
  ...settings,
  workspaceId: z.uuid().optional(),
  expectedActorId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  connectionRevision,
});
export const assistantSettingsSchema = z.object({
  ...settings,
  revision: z.number().int().nonnegative(),
  baseInstructions: z.string(),
  defaultInstructions: z.string(),
  effectiveInstructions: z.string(),
  needsReconfirmation: z.boolean(),
  canManage: z.boolean(),
  managedSpaces: z.array(
    z.object({
      workspaceId: z.uuid(),
      workspaceName: z.string(),
      connectionId: assistantConnectionId,
      displayName: z.string(),
    }),
  ),
  connections: z.array(
    z.object({
      id: assistantConnectionId,
      label: z.string(),
      kind: z.enum(["model", "agent"]),
      provider: z.string(),
      configured: z.boolean(),
      destination: z.string(),
      revision: connectionRevision,
    }),
  ),
});
export type SaveAssistantSettings = z.infer<typeof saveAssistantSettingsSchema>;
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
