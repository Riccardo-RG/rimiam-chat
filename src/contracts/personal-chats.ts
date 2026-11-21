import { z } from "zod";
const id = z.uuid(),
  expectedActorId = z.string().min(1),
  version = z.number().int().nonnegative();
export const personalChatInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open"),
      expectedActorId,
      thread: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("new"), expectedActorId, thread: id }).strict(),
  z
    .object({
      action: z.literal("select"),
      expectedActorId,
      thread: id,
      target: id.nullable(),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      action: z.literal("ask"),
      expectedActorId,
      thread: id,
      target: id,
      expectedVersion: version,
      id,
      question: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("research_read"),
      expectedActorId,
      thread: id,
      workId: id,
    })
    .strict(),
]);
export type PersonalChatInput = z.infer<typeof personalChatInput>;

export const chatDirectorySchema = z.object({
  archive: id.nullable(),
  active: id.nullable(),
  threads: z.array(z.object({ id, label: z.string(), at: z.string() })),
  more: z.boolean(),
  ready: z.object({ thread: id, workId: id }).nullable(),
});
export const chatStateSchema = z.object({
  archive: id,
  selection: z.object({
    id: id.nullable(),
    label: z.string().nullable(),
    version,
  }),
  targets: z.array(
    z.object({ id, name: z.string(), contributes: z.boolean() }),
  ),
  turns: z.array(
    z.object({
      id,
      messageId: id,
      target: id,
      selectionVersion: version,
      question: z.string(),
      status: z.string(),
      answer: z.string().nullable(),
      references: z.array(
        z.object({ kind: z.string(), id, version, label: z.string() }),
      ),
    }),
  ),
  research: z.array(
    z.object({
      id,
      messageId: id,
      brief: z.boolean(),
      citations: z.array(z.object({ id, title: z.string(), url: z.url() })),
      generation: version,
      query: z.string(),
      status: z.string(),
      notify: z.boolean(),
      origin: id.nullable(),
      read: z.boolean(),
      shared: z.array(id),
      summary: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type ChatState = z.infer<typeof chatStateSchema>;
export type ChatDirectory = z.infer<typeof chatDirectorySchema>;
