import { z } from "zod";
const version = z.number().int().positive();
const revision = z.number().int().nonnegative();
const text = z.string().trim().min(1).max(4000);
export const workstreamStateSchema = z.enum([
  "proposed",
  "active",
  "resolved",
  "archived",
]);
const lifecycleAction = z.enum(["activate", "resolve", "archive", "reopen"]);
export const workstreamFocusSchema = z
  .object({
    workstreamId: z.uuid(),
    version,
  })
  .strict();
export const attentionCommandSchemas = [
  z.object({ type: z.literal("attention.aligned"), revision }).strict(),
  z
    .object({
      type: z.literal("attention.preference"),
      mode: z.enum(["discreet", "collaborative", "proactive"]),
      expectedVersion: revision,
    })
    .strict(),
  z
    .object({
      type: z.literal("workstream.save"),
      id: z.uuid().optional(),
      expectedVersion: version.optional(),
      title: text.max(160),
      description: z.string().max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal("workstream.transition"),
      workstreamId: z.uuid(),
      expectedVersion: version,
      action: lifecycleAction,
    })
    .strict(),
  z
    .object({
      type: z.literal("workstream.link"),
      workstreamId: z.uuid(),
      sourceId: z.uuid(),
      expectedVersion: revision,
      included: z.boolean(),
    })
    .strict(),
] as const;
export const attentionCommandSchema = z.discriminatedUnion(
  "type",
  attentionCommandSchemas,
);
export const attentionViewSchema = z.object({
  revision,
  alignedRevision: revision,
  nextBefore: revision.nullable(),
  changes: z.array(
    z.object({ revision, kind: z.string(), createdAt: z.string() }),
  ),
  attention: z.array(
    z.object({
      kind: z.enum(["work", "question", "task", "proposal", "artifact"]),
      id: z.uuid(),
      text: z.string(),
      reason: z.string(),
    }),
  ),
  preference: z.object({
    version: revision,
    mode: z.enum(["discreet", "collaborative", "proactive"]),
    actor: z.string().nullable(),
  }),
  workstreams: z.array(
    z.object({
      id: z.uuid(),
      version,
      state: workstreamStateSchema,
      title: z.string(),
      description: z.string(),
      actor: z.string().nullable(),
      origin: z.string(),
      sources: z.array(
        z.object({
          id: z.uuid(),
          version,
          included: z.boolean(),
          actor: z.string().nullable(),
          origin: z.string(),
          content: z.string(),
          kind: z.string(),
        }),
      ),
      history: z.array(
        z.object({
          version,
          title: z.string(),
          description: z.string(),
          actor: z.string().nullable(),
          origin: z.string(),
          createdAt: z.string(),
          lifecycleState: workstreamStateSchema.nullable(),
          lifecycleAction: lifecycleAction.nullable(),
        }),
      ),
    }),
  ),
});
export type AttentionView = z.infer<typeof attentionViewSchema>;
