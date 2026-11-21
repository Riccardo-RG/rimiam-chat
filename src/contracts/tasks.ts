import { conversationOriginSchema } from "./conversation-handoff.ts";
import { z } from "zod";

const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(2000);
const taskStatus = z.enum([
  "open",
  "in_progress",
  "standby",
  "completed",
  "cancelled",
]);
const commentBody = z.string().trim().min(1).max(2000);
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
export const followupRecurrenceSchema = z
  .object({
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length)
      .meta({
        uniqueItems: true,
        description:
          "ISO weekdays in the reminder's time zone, Monday (1) through Sunday (7). Selecting all seven repeats daily.",
      }),
    until: z.iso
      .date()
      .describe("Inclusive final calendar date in the reminder's time zone.")
      .optional(),
  })
  .strict();
export type FollowupRecurrence = z.infer<typeof followupRecurrenceSchema>;
const followupContent = {
  content: z.string().trim().min(1).max(2000),
  kind: z.enum(["remember", "check", "request_update", "review"]),
  remindAt: z.iso.datetime({ offset: true }),
  timeZone: taskContentSchema.shape.timeZone,
  reference: workRefSchema.nullable(),
  // On revision, omission preserves a rule written by a newer client.
  // Explicit null switches the reminder back to a single occurrence.
  recurrence: followupRecurrenceSchema.nullable().optional(),
};
export const taskCommandSchemas = [
  z
    .object({
      type: z.literal("task.comment"),
      taskId: z.uuid(),
      expectedVersion: version,
      body: commentBody,
    })
    .strict(),
  z.object({ type: z.literal("task.decline"), ...taskBase }).strict(),
  z
    .object({
      type: z.literal("followup.occurrence"),
      followupId: z.uuid(),
      expectedVersion: version,
      scheduledAt: z.iso.datetime({ offset: true }),
      action: z.enum(["hide", "close", "replace", "replace_following"]),
      replacement: z
        .object({
          content: followupContent.content,
          remindAt: followupContent.remindAt,
          timeZone: followupContent.timeZone,
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("followup.previous"),
      followupId: z.uuid(),
      before: z.iso.datetime({ offset: true }),
      action: z.enum(["archive", "remind_today"]),
      remindAt: z.iso.datetime({ offset: true }).optional(),
      timeZone: followupContent.timeZone,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.create"),
      conversationOrigin: conversationOriginSchema.optional(),
      content: taskContentSchema,
      candidateId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task.revise"),
      conversationOrigin: conversationOriginSchema.optional(),
      ...taskBase,
      content: taskContentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.propose_revision"),
      conversationOrigin: conversationOriginSchema.optional(),
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
      status: taskStatus,
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
  status: taskStatus,
  actor: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  candidateId: z.uuid().nullable(),
  responsible: z.string().nullable(),
  acceptedVersion: version.nullable(),
  responsibleAvailable: z.boolean(),
  declinedBy: z.string().nullable().optional(),
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
  nextRemindAt: z.iso.datetime({ offset: true }).nullable().optional(),
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
export const taskCommentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.uuid(),
      actor: z.string(),
      authorName: z.string(),
      body: commentBody,
      taskVersion: version,
      createdAt: z.iso.datetime(),
    }),
  ),
  next: z.string().nullable(),
});
export type FollowupItem = z.infer<typeof followupViewItemSchema>;
export const tasksHistorySchema = z.object({
  versions: z.array(z.record(z.string(), z.unknown())),
  acceptances: z.array(z.record(z.string(), z.unknown())),
  references: z.array(z.record(z.string(), z.unknown())),
  proposals: z.array(z.record(z.string(), z.unknown())),
  nextDelivery: z
    .object({ version, scheduledAt: z.iso.datetime({ offset: true }) })
    .nullable()
    .optional(),
});
