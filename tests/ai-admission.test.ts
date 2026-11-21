import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { z } from "zod";
import { pool } from "../src/server/db";
import { createWorkspace } from "../src/server/commands";
import { admitAIInvocation } from "../src/server/ai-admission";
import { configuredStructuredModel } from "../src/server/structured-llm";
import { configuredMediaExtractor } from "../src/server/media-provider";
import { configuredEmailComposer } from "../src/server/email-composition";

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));
afterAll(() => pool.end());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

async function space() {
  const actor = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [actor, `${actor}@example.test`],
  );
  return (await createWorkspace(actor, "Invocation guard", randomUUID())).id;
}

it("serializes concurrent reservations and retains unknown/failed dispatches across fresh reads", async () => {
  const w = await space();
  vi.stubEnv("AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY", "1");
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () => admitAIInvocation("conversation", w)),
  );
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  for (const r of attempts.filter((r) => r.status === "rejected"))
    expect(r.reason.code).toBe("AI_USAGE_LIMIT_REACHED");
  expect(
    (
      await pool.query(
        "SELECT * FROM ai_invocation_admission WHERE workspace_id=$1",
        [w],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(admitAIInvocation("active_work", w)).rejects.toMatchObject({
    code: "AI_USAGE_LIMIT_REACHED",
  });
  await expect(
    pool.query("DELETE FROM ai_invocation_admission WHERE workspace_id=$1", [
      w,
    ]),
  ).rejects.toThrow("immutable");
  // A different eligible Workspace is not blocked by this Workspace's quota.
  await expect(
    admitAIInvocation("active_work", await space()),
  ).resolves.toEqual(expect.any(String));
});

it("applies global rolling limits to unscoped calls and excludes older reservations", async () => {
  const w = await space();
  await pool.query(
    "INSERT INTO ai_invocation_admission(id,workspace_id,operation,admitted_at) VALUES($1,$2,'conversation',now()-interval '25 hours')",
    [randomUUID(), w],
  );
  vi.stubEnv("AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY", "1");
  await expect(admitAIInvocation("vision", w)).resolves.toEqual(
    expect.any(String),
  );
  const before = (
    await pool.query(
      "SELECT count(*)::integer AS total FROM ai_invocation_admission WHERE admitted_at>clock_timestamp()-interval '24 hours'",
    )
  ).rows[0].total;
  vi.stubEnv("AI_MAX_INVOCATIONS_PER_DAY", String(before + 1));
  await admitAIInvocation("transcription");
  await expect(
    admitAIInvocation("conversation", await space()),
  ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  vi.stubEnv("AI_MAX_INVOCATIONS_PER_MINUTE", "0");
  await expect(admitAIInvocation("conversation")).rejects.toMatchObject({
    code: "AI_USAGE_LIMIT_REACHED",
  });
});

it("rejects malformed configuration before reservation and never defaults silently to unlimited", async () => {
  vi.stubEnv("AI_MAX_INVOCATIONS_PER_DAY", "unlimited");
  await expect(admitAIInvocation("conversation")).rejects.toMatchObject({
    code: "AI_LIMIT_CONFIGURATION_INVALID",
  });
});

it("fences real model/media dispatch boundaries without fabricating a result or bypassing disclosure", async () => {
  const w = await space();
  vi.stubEnv("AI_MODE", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-only-not-a-real-key");
  vi.stubEnv("AI_MODEL", "test-only-model");
  vi.stubEnv("AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY", "0");
  const args = {
    system: "test",
    prompt: "test",
    schema: z.object({ answer: z.string() }),
    usageScope: { workspace: w, operation: "conversation" as const },
  };
  await expect(
    configuredStructuredModel()!.generateJSON(args),
  ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  const image = {
    workspace: w,
    kind: "image" as const,
    filename: "test.png",
    mediaType: "image/png",
    bytes: Buffer.from([]),
    allowModelProcessing: true,
  };
  await expect(
    configuredMediaExtractor().extract(image, new AbortController().signal),
  ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  await expect(
    configuredMediaExtractor().extract(
      { ...image, allowModelProcessing: false },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "MEDIA_DISCLOSURE_REQUIRED" });
  vi.stubEnv("TRANSCRIPTION_PROVIDER", "openai");
  vi.stubEnv("TRANSCRIPTION_MODEL", "test-only-transcriber");
  await expect(
    configuredMediaExtractor().extract(
      { ...image, kind: "audio", mediaType: "audio/mpeg" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  expect(generateText).not.toHaveBeenCalled();
  expect(
    (
      await pool.query(
        "SELECT 1 FROM shared_ai_usage_attempt WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
});

it("counts private email composition without leaking it to shared usage diagnostics", async () => {
  const w = await space();
  vi.stubEnv("AI_MODE", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-only-not-a-real-key");
  vi.stubEnv("AI_MODEL", "test-only-model");
  vi.stubEnv("AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY", "1");
  vi.mocked(generateText).mockResolvedValueOnce({
    output: {
      subject: "Proposta",
      body: "Da discutere",
      needsClarification: "",
    },
    finishReason: "stop",
  } as Awaited<ReturnType<typeof generateText>>);
  const composer = configuredEmailComposer(w)!;
  const input = {
    kind: "new",
    subject: "Bozza privata",
    body: "Solo destinatari espliciti",
    instruction: "Rendi più chiaro",
  };
  await expect(composer.compose(input)).resolves.toMatchObject({
    subject: "Proposta",
  });
  await expect(composer.compose(input)).rejects.toMatchObject({
    code: "AI_USAGE_LIMIT_REACHED",
  });
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(
    (
      await pool.query(
        "SELECT operation FROM ai_invocation_admission WHERE workspace_id=$1",
        [w],
      )
    ).rows,
  ).toEqual([{ operation: "email_composition" }]);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM shared_ai_usage_attempt WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
});
