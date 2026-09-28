import { z } from "zod";

export const usageRatesSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "ollama"]),
    model: z.string().min(1).max(200),
    inputPerMillionUsd: z.number().nonnegative().max(1000000),
    cachedInputPerMillionUsd: z.number().nonnegative().max(1000000).optional(),
    cacheWritePerMillionUsd: z.number().nonnegative().max(1000000).optional(),
    outputPerMillionUsd: z.number().nonnegative().max(1000000),
    verifiedOn: z.iso.date(),
  })
  .strict();
export type UsageRates = z.infer<typeof usageRatesSchema>;

export const aiUsageViewSchema = z.object({
  workspaceId: z.uuid(),
  generatedAt: z.iso.datetime(),
  periodDays: z.number().int(),
  instrumentationSince: z.iso.datetime().nullable(),
  groups: z.array(
    z.object({
      operation: z.enum(["conversation", "active_work"]),
      provider: z.string(),
      model: z.string(),
      rates: usageRatesSchema.nullable(),
      attempts: z.number().int(),
      failed: z.number().int(),
      unresolved: z.number().int(),
      missingTokenUsage: z.number().int(),
      pricedAttempts: z.number().int(),
      inputTokens: z.number().nullable(),
      cachedInputTokens: z.number().nullable(),
      cacheWriteTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      estimatedSubtotalUsd: z.number().nullable(),
    }),
  ),
});
export type AIUsageView = z.infer<typeof aiUsageViewSchema>;
