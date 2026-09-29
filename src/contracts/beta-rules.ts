import { z } from "zod";

export const acceptBetaRulesSchema = z
  .object({
    expectedActorId: z.string().min(1),
    version: z.string().min(1).max(100),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const betaRulesViewSchema = z.object({
  actorId: z.string().min(1),
  version: z.string(),
  text: z.string(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedAt: z.iso.datetime().nullable(),
});

export type BetaRulesView = z.infer<typeof betaRulesViewSchema>;
export type AcceptBetaRules = z.infer<typeof acceptBetaRulesSchema>;
