import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { z } from "zod";
import { pool } from "../src/server/db";
import { createWorkspace } from "../src/server/commands";
import {
  aiUsageView,
  beginUsage,
  finishUsage,
  usageNumbers,
  estimatedUsageUsd,
} from "../src/server/ai-usage";
import { configuredStructuredModel } from "../src/server/structured-llm";
import { betaFeedbackMarkdown } from "../src/shared/beta-feedback";
import { betaFeedbackView } from "../src/server/beta-feedback";

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));
afterAll(() => pool.end());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
const rates = {
  provider: "openai" as const,
  model: "usage-test",
  inputPerMillionUsd: 2,
  cachedInputPerMillionUsd: 0.5,
  cacheWritePerMillionUsd: 2.5,
  outputPerMillionUsd: 8,
  verifiedOn: "2026-09-26",
}; // Synthetic test prices, never production defaults.
const usage = {
  inputTokens: 1000,
  outputTokens: 200,
  inputTokenDetails: {
    noCacheTokens: 600,
    cacheReadTokens: 300,
    cacheWriteTokens: 100,
  },
};
async function setup() {
  const actor = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [actor, "Usage tester", `${actor}@example.test`],
  );
  const w = (await createWorkspace(actor, "Shared usage", randomUUID())).id;
  vi.stubEnv("AI_USAGE_RATES_JSON", JSON.stringify([rates]));
  return {
    actor,
    w,
    scope: { workspace: w, operation: "conversation" as const },
  };
}

it("prices measured buckets without double-counting caches/reasoning, and never invents missing consumption/tariffs", () => {
  expect(estimatedUsageUsd(usageNumbers(usage), rates)).toBeCloseTo(0.0032, 10);
  expect(estimatedUsageUsd(usageNumbers(), rates)).toBeNull();
  expect(estimatedUsageUsd(usageNumbers(usage), null)).toBeNull();
  expect(
    estimatedUsageUsd(
      usageNumbers({ inputTokens: 1000, outputTokens: 200 }),
      rates,
    ),
  ).toBeNull();
  expect(
    estimatedUsageUsd(usageNumbers(usage), {
      ...rates,
      cacheWritePerMillionUsd: undefined,
    }),
  ).toBeNull();
  expect(
    usageNumbers({
      inputTokens: 1000,
      outputTokens: 200,
      inputTokenDetails: { noCacheTokens: 700, cacheReadTokens: 300 },
    }).written,
  ).toBe(0);
  expect(
    estimatedUsageUsd(usageNumbers({ ...usage, inputTokens: 50 }), rates),
  ).toBeNull();
});

it("retains tariff snapshots and failed/unknown attempts, isolates workspaces, and survives fresh report reads", async () => {
  const { actor, w, scope } = await setup();
  const first = await beginUsage(scope, "openai", "usage-test");
  await finishUsage(first, "returned", usage);
  await finishUsage(first, "returned", usage); // same outcome does not double-charge
  const unknown = await beginUsage(scope, "openai", "usage-test");
  expect(unknown).toBeDefined(); // crash/restart: no outcome yet
  const failed = await beginUsage(scope, "openai", "usage-test");
  await finishUsage(failed, "failed");
  vi.stubEnv(
    "AI_USAGE_RATES_JSON",
    JSON.stringify([{ ...rates, outputPerMillionUsd: 80 }]),
  );
  const view = await aiUsageView(actor, w, 30);
  expect(view.groups).toHaveLength(1);
  expect(view.groups[0]).toMatchObject({
    attempts: 3,
    pricedAttempts: 1,
    unresolved: 1,
    failed: 1,
    missingTokenUsage: 2,
    inputTokens: 1000,
    outputTokens: 200,
    rates,
  });
  expect(view.groups[0].estimatedSubtotalUsd).toBeCloseTo(0.0032, 10);
  const other = await setup();
  expect((await aiUsageView(other.actor, other.w, 30)).groups).toEqual([]);
  await expect(aiUsageView(other.actor, w, 30)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
  const report = betaFeedbackMarkdown(await betaFeedbackView(actor, w), view);
  expect(report).toContain("not an invoice or total application cost");
  expect(report).toContain('"pricedAttempts": 1');
  expect(
    betaFeedbackMarkdown(await betaFeedbackView(other.actor, other.w), view),
  ).not.toContain("Measured AI usage");
  await expect(
    pool.query(
      "UPDATE shared_ai_usage_result SET estimated_usd=0 WHERE attempt_id=$1",
      [first!.id],
    ),
  ).rejects.toThrow();
  await pool.query(
    "UPDATE membership SET active=false WHERE workspace_id=$1 AND user_id=$2",
    [w, actor],
  );
  await expect(aiUsageView(actor, w, 7)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
});

it("records real adapter usage even on invalid output, counts retries separately and never sends usage metadata to the model", async () => {
  const { actor, w, scope } = await setup();
  vi.stubEnv("AI_MODE", "openai");
  vi.stubEnv("AI_MODEL", "usage-test");
  vi.stubEnv("OPENAI_API_KEY", "test-only-no-network");
  vi.mocked(generateText).mockResolvedValue({
    totalUsage: usage,
    finishReason: "stop",
    output: { answer: "Valid" },
  } as never);
  const model = configuredStructuredModel()!;
  const args = {
    system: "Test prompt",
    prompt: "Test source",
    schema: z.object({ answer: z.string() }),
    usageScope: scope,
  };
  await expect(model.generateJSON(args)).resolves.toEqual({ answer: "Valid" });
  expect(vi.mocked(generateText).mock.calls[0][0]).not.toHaveProperty(
    "usageScope",
  );
  vi.mocked(generateText).mockResolvedValueOnce({
    totalUsage: usage,
    finishReason: "length",
    output: { answer: "Partial" },
  } as never);
  await expect(model.generateJSON(args)).rejects.toMatchObject({
    code: "AI_OUTPUT_PARSE_ERROR",
  });
  vi.mocked(generateText).mockRejectedValueOnce(
    new DOMException("sensitive remote error", "TimeoutError"),
  );
  await expect(model.generateJSON(args)).rejects.toMatchObject({
    code: "AI_TIMEOUT",
  });
  const group = (await aiUsageView(actor, w, 30)).groups[0];
  expect(group).toMatchObject({
    attempts: 3,
    pricedAttempts: 2,
    failed: 2,
    missingTokenUsage: 1,
    inputTokens: 2000,
    outputTokens: 400,
  });
  expect(group.estimatedSubtotalUsd).toBeCloseTo(0.0064, 10);
  const raw = JSON.stringify(
    (
      await pool.query(
        "SELECT * FROM shared_ai_usage_attempt WHERE workspace_id=$1",
        [w],
      )
    ).rows,
  );
  for (const privateText of [
    "Test prompt",
    "Test source",
    "sensitive remote error",
    "test-only-no-network",
  ])
    expect(raw).not.toContain(privateText);
});

it("keeps unpriced usage visible and rejects invalid or ambiguous tariff configuration", async () => {
  const { actor, w, scope } = await setup();
  for (const config of ["not-json", JSON.stringify([rates, rates]), "[]"]) {
    vi.stubEnv("AI_USAGE_RATES_JSON", config);
    await finishUsage(
      await beginUsage(scope, "openai", "usage-test"),
      "returned",
      usage,
    );
  }
  expect((await aiUsageView(actor, w, 30)).groups[0]).toMatchObject({
    attempts: 3,
    pricedAttempts: 0,
    estimatedSubtotalUsd: null,
    inputTokens: 3000,
  });
});
