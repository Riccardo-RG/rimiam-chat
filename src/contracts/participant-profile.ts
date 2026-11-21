import { z } from "zod";

const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[\d ()./-]+$/)
  .refine((value) => /^\d{6,15}$/.test(value.replace(/\D/g, "")));

export const participantProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  version: z.int().nonnegative(),
});
export const changeOwnProfileSchema = z
  .object({
    expectedActorId: z.string().min(1).max(256),
    expectedVersion: z.int().nonnegative(),
    phone: phone.nullable(),
  })
  .strict();
export type ParticipantProfile = z.infer<typeof participantProfileSchema>;
export type ChangeOwnProfile = z.infer<typeof changeOwnProfileSchema>;
