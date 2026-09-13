import { z } from "zod";
export const workspaceLinkCommandSchema = z
  .object({
    type: z.literal("workspace.link"),
    otherWorkspaceId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    linked: z.boolean(),
  })
  .strict();
export type WorkspaceLink = {
  id: string;
  name: string;
  version: number;
  active: boolean;
  history: {
    version: number;
    active: boolean;
    actor_id: string;
    created_at: string;
  }[];
};
