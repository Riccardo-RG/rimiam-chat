import { z } from "zod";
const positive = z.number().int().positive();
const text = z.string().trim().min(1).max(4000);
export const activeWorkCommandSchema = z
  .object({
    type: z.literal("work.converse"),
    text,
    workId: z.uuid().optional(),
    expectedRevision: positive.optional(),
    instruction: z
      .enum(["input", "assumption", "objection", "redirect", "format"])
      .optional(),
  })
  .strict();
export const activeWorkContractSchema = z.object({
  version: positive,
  objective: text,
  scope: text,
  expectedOutput: text,
  anchors: z.array(z.string()),
  focus: z.array(z.string()),
  actor: z.string().nullable(),
  origin: z.enum(["human", "miriam"]),
  sourceId: z.uuid().nullable(),
  reason: z.string(),
  createdAt: z.string(),
});
export const activeWorkIssueSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["objection", "revision", "context", "input"]),
  content: z.string(),
  actor: z.string().nullable(),
  proposedObjective: z.string().nullable(),
  requiredPeople: z.array(z.string()),
  acknowledgedBy: z.array(z.string()),
});
export const workEventSchema = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  revision: positive,
  contractVersion: positive,
  kind: z.string(),
  content: z.string(),
  actor: z.string().nullable(),
  sourceId: z.uuid().nullable(),
  createdAt: z.string(),
});
export const workInputSchema = z.object({
  key: z.string(),
  kind: z.string(),
  id: z.uuid(),
  version: positive,
  content: z.string(),
  qualification: z.string(),
  provenance: z.record(z.string(), z.unknown()),
});
export type WorkInput = z.infer<typeof workInputSchema>;
export const contributionSchema = z.object({
  id: z.uuid(),
  generation: positive,
  contractVersion: positive,
  body: z.string(),
  citations: z.array(z.string()),
  qualification: z.string(),
  createdAt: z.string(),
});
export const activeWorkItemSchema = z.object({
  id: z.uuid(),
  revision: positive,
  phase: z.enum([
    "queued",
    "working",
    "needs_input",
    "paused",
    "stopped",
    "completed",
  ]),
  validity: z.enum(["current", "potentially_outdated"]),
  error: z.string().nullable(),
  contract: activeWorkContractSchema,
  issues: z.array(activeWorkIssueSchema),
  contribution: contributionSchema.nullable(),
});
export const activeWorkViewSchema = z.object({
  works: z.array(activeWorkItemSchema),
  events: z.array(workEventSchema),
  next: z.string().nullable(),
  canControl: z.boolean(),
  suggestions: z
    .array(
      z.object({
        id: z.uuid(),
        workId: z.uuid(),
        expectedRevision: positive,
        operation: z.enum([
          "pause",
          "stop",
          "resume",
          "input",
          "assumption",
          "objection",
          "redirect",
          "format",
        ]),
        text: z.string(),
        sourceId: z.uuid(),
        interpretationId: z.uuid(),
        status: z.enum(["pending", "stale", "applied"]),
        appliedBy: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export const activeWorkHistorySchema = z.object({
  contracts: z.array(activeWorkContractSchema),
  events: z.array(workEventSchema),
  contributions: z.array(contributionSchema),
  inputs: z.array(workInputSchema.extend({ generation: positive })),
  issueActs: z.array(z.record(z.string(), z.unknown())),
  nextBefore: positive.nullable(),
});
export type ActiveWorkView = z.infer<typeof activeWorkViewSchema>;
export type ActiveWorkItem = z.infer<typeof activeWorkItemSchema>;
export type ActiveWorkContract = z.infer<typeof activeWorkContractSchema>;
export type ActiveWorkHistory = z.infer<typeof activeWorkHistorySchema>;

export const workControlSchema = z
  .object({
    workId: z.uuid(),
    expectedRevision: positive,
    operation: z.enum([
      "pause",
      "stop",
      "resume",
      "input",
      "assumption",
      "objection",
      "redirect",
      "format",
    ]),
    text,
  })
  .strict();
export const workSuggestionCommandSchema = z
  .object({
    type: z.literal("work.apply_suggestion"),
    suggestionId: z.uuid(),
    confirmExactInstruction: z.literal(true),
  })
  .strict();
