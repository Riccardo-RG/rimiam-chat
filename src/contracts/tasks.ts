import { z } from "zod";

const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(2000);
export const workRefSchema = z
  .object({
    kind: z.enum([
      "goal",
      "commitment",
      "information",
      "artifact",
      "source",
      "message",
      "question",
      "task",
    ]),
    id: z.uuid(),
    version,
  })
  .strict();
export type WorkRef = z.infer<typeof workRefSchema>;
export const taskContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(8000),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    suggestedPerson: z.string().min(1).nullable(),
    references: z.array(workRefSchema).max(20),
  })
  .strict();
export type TaskContent = z.infer<typeof taskContentSchema>;
const taskBase = { taskId: z.uuid(), expectedVersion: version, reason };
const followupContent = {
  content: z.string().trim().min(1).max(2000),
  kind: z.enum(["remember", "check", "request_update", "review"]),
  remindAt: z.iso.datetime({ offset: true }),
  timeZone: taskContentSchema.shape.timeZone,
  reference: workRefSchema.nullable(),
};
export const taskCommandSchemas = [
  z
    .object({
      type: z.literal("task.create"),
      content: taskContentSchema,
      candidateId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.revise"),
      ...taskBase,
      content: taskContentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.propose_revision"),
      ...taskBase,
      content: taskContentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.adopt_revision"),
      ...taskBase,
      proposalId: z.uuid(),
      acceptResponsibility: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.accept"),
      ...taskBase,
      representSelf: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.relinquish"),
      ...taskBase,
      representSelf: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.status"),
      ...taskBase,
      status: z.enum(["open", "in_progress", "completed", "cancelled"]),
      noNormativeEffect: z.literal(true),
    })
    .strict(),
  z.object({ type: z.literal("followup.create"), ...followupContent }).strict(),
  z
    .object({
      type: z.literal("followup.revise"),
      followupId: z.uuid(),
      expectedVersion: version,
      reason,
      ...followupContent,
    })
    .strict(),
  z
    .object({
      type: z.literal("followup.close"),
      followupId: z.uuid(),
      expectedVersion: version,
      reason,
      status: z.enum(["done", "cancelled"]),
    })
    .strict(),
] as const;
export const taskCommandSchema = z.discriminatedUnion(
  "type",
  taskCommandSchemas,
);
export type TaskCommand = z.infer<typeof taskCommandSchema>;
export const taskViewItemSchema = taskContentSchema.extend({
  id: z.uuid(),
  version,
  status: z.enum(["open", "in_progress", "completed", "cancelled"]),
  actor: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  candidateId: z.uuid().nullable(),
  responsible: z.string().nullable(),
  acceptedVersion: version.nullable(),
  responsibleAvailable: z.boolean(),
});
export const followupViewItemSchema = z.object({
  ...followupContent,
  id: z.uuid(),
  version,
  owner: z.string(),
  status: z.enum(["active", "done", "cancelled"]),
  createdAt: z.string(),
  reason: z.string(),
  needsReview: z.boolean(),
  deliveredAt: z.string().nullable(),
});
export const taskProposalSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  baseVersion: version,
  content: taskContentSchema,
  actor: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
export const tasksViewSchema = z.object({
  tasks: z.array(taskViewItemSchema),
  followups: z.array(followupViewItemSchema),
  proposals: z.array(taskProposalSchema),
  next: z.string().nullable(),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
  suggestions: z.array(
    z.object({
      id: z.uuid(),
      content: z.string(),
      subject: z.string(),
      origin: z.string(),
      qualification: z.string(),
    }),
  ),
});
export type TasksView = z.infer<typeof tasksViewSchema>;
export type TaskItem = z.infer<typeof taskViewItemSchema>;
export type FollowupItem = z.infer<typeof followupViewItemSchema>;
export const tasksHistorySchema = z.object({
  versions: z.array(z.record(z.string(), z.unknown())),
  acceptances: z.array(z.record(z.string(), z.unknown())),
  references: z.array(z.record(z.string(), z.unknown())),
  proposals: z.array(z.record(z.string(), z.unknown())),
});
