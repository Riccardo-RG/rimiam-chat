import { z } from "zod";

const photoVersion = z.object({
  version: z.number().int().nonnegative(),
  present: z.boolean(),
});
export const photoDirectorySchema = z.object({
  actor: z.string(),
  own: photoVersion,
  rooms: z.record(z.string(), photoVersion),
  members: z.record(z.string(), photoVersion),
});
export type PhotoDirectory = z.infer<typeof photoDirectorySchema>;
export const photoChangeSchema = z
  .object({
    expectedActorId: z.string().min(1).max(256),
    workspace: z.uuid().optional(),
    expectedVersion: z.number().int().nonnegative(),
    image: z
      .string()
      .min(1)
      .max(480000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .nullable(),
  })
  .strict();
export type PhotoChange = z.infer<typeof photoChangeSchema>;
