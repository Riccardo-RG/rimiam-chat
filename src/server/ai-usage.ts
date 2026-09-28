import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aiUsageViewSchema,
  usageRatesSchema,
  type UsageRates,
} from "../contracts/ai-usage.ts";
import { pool, transaction } from "./db.ts";
import { lockWorkspace, member } from "./workspace-state.ts";

export type UsageScope = {
  workspace: string;
  operation: "conversation" | "active_work";
};
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function usageNumbers(usage?: TokenUsage) {
  const input = count(usage?.inputTokens);
  let cached = count(usage?.inputTokenDetails?.cacheReadTokens);
  let written = count(usage?.inputTokenDetails?.cacheWriteTokens);
  const uncached = count(usage?.inputTokenDetails?.noCacheTokens);
  // Infer zero only when the other reported buckets fully account for input.
  if (
    input !== null &&
    uncached !== null &&
    uncached + (cached ?? 0) + (written ?? 0) === input
  ) {
    cached ??= 0;
    written ??= 0;
  }
  return { input, cached, written, output: count(usage?.outputTokens) };
}
export function estimatedUsageUsd(
  usage: ReturnType<typeof usageNumbers>,
  rates: UsageRates | null,
) {
  const { input, cached, written, output } = usage;
  if (
    !rates ||
    input === null ||
    cached === null ||
    written === null ||
    output === null ||
    cached + written > input ||
    (cached > 0 && rates.cachedInputPerMillionUsd === undefined) ||
    (written > 0 && rates.cacheWritePerMillionUsd === undefined)
  )
    return null;
  return (
    ((input - cached - written) * rates.inputPerMillionUsd +
      cached * (rates.cachedInputPerMillionUsd ?? 0) +
      written * (rates.cacheWritePerMillionUsd ?? 0) +
      output * rates.outputPerMillionUsd) /
    1000000
  );
}
function configuredRates(provider: string, model: string): UsageRates | null {
  try {
    const rates = z
      .array(usageRatesSchema)
      .parse(JSON.parse(process.env.AI_USAGE_RATES_JSON ?? "[]"));
    const matches = rates.filter(
      (r) => r.provider === provider && r.model === model,
    );
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}
export async function beginUsage(
  scope: UsageScope | undefined,
  provider: string,
  model: string,
) {
  if (!scope) return undefined;
  const id = randomUUID(),
    rates = configuredRates(provider, model);
  // Persist before dispatch: a crash or unknown remote outcome cannot become zero cost.
  await pool.query(
    "INSERT INTO shared_ai_usage_attempt(id,workspace_id,operation,provider,model,rates) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      scope.workspace,
      scope.operation,
      provider,
      model,
      rates ? JSON.stringify(rates) : null,
    ],
  );
  return { id, rates };
}
export async function finishUsage(
  attempt: Awaited<ReturnType<typeof beginUsage>>,
  outcome: "returned" | "failed",
  usage?: TokenUsage,
) {
  if (!attempt) return;
  const numbers = usageNumbers(usage);
  try {
    await pool.query(
      `INSERT INTO shared_ai_usage_result(attempt_id,outcome,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,estimated_usd)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(attempt_id) DO NOTHING`,
      [
        attempt.id,
        outcome,
        numbers.input,
        numbers.cached,
        numbers.written,
        numbers.output,
        estimatedUsageUsd(numbers, attempt.rates),
      ],
    );
  } catch {
    // Preserve the completed product operation; the durable attempt remains visibly unresolved.
    console.error("Shared AI usage outcome could not be recorded");
  }
}
export async function aiUsageView(
  actor: string,
  workspace: string,
  days: number,
) {
  z.union([z.literal(7), z.literal(30)]).parse(days);
  return transaction(async (tx) => {
    await lockWorkspace(tx, workspace);
    await member(tx, workspace, actor, false, true);
    const since = await tx.query(
      "SELECT applied_at FROM schema_migration WHERE name='035_shared_ai_usage.sql'",
    );
    const result = await tx.query(
      `SELECT a.operation,a.provider,a.model,a.rates,count(*)::int AS attempts,
       count(*) FILTER(WHERE r.outcome='failed')::int AS failed,
       count(*) FILTER(WHERE r.attempt_id IS NULL)::int AS unresolved,
       count(*) FILTER(WHERE r.input_tokens IS NULL OR r.output_tokens IS NULL)::int AS missing,
       count(r.estimated_usd)::int AS priced,
       sum(r.input_tokens) AS input,sum(r.cached_input_tokens) AS cached,sum(r.cache_write_tokens) AS written,
       sum(r.output_tokens) AS output,sum(r.estimated_usd) AS cost
       FROM shared_ai_usage_attempt a LEFT JOIN shared_ai_usage_result r ON r.attempt_id=a.id
       WHERE a.workspace_id=$1 AND a.started_at >= now()-($2::int * interval '1 day')
       GROUP BY a.operation,a.provider,a.model,a.rates ORDER BY a.operation,a.provider,a.model,a.rates`,
      [workspace, days],
    );
    const numeric = (value: unknown) => (value === null ? null : Number(value));
    return aiUsageViewSchema.parse({
      workspaceId: workspace,
      generatedAt: new Date().toISOString(),
      periodDays: days,
      instrumentationSince: since.rows[0]?.applied_at.toISOString() ?? null,
      groups: result.rows.map((r) => ({
        operation: r.operation,
        provider: r.provider,
        model: r.model,
        rates: r.rates,
        attempts: r.attempts,
        failed: r.failed,
        unresolved: r.unresolved,
        missingTokenUsage: r.missing,
        pricedAttempts: r.priced,
        inputTokens: numeric(r.input),
        cachedInputTokens: numeric(r.cached),
        cacheWriteTokens: numeric(r.written),
        outputTokens: numeric(r.output),
        estimatedSubtotalUsd: numeric(r.cost),
      })),
    });
  });
}
