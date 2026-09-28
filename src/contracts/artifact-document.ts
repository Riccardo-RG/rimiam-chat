import { conversationOriginSchema } from "./conversation-handoff.ts";
import { z } from "zod";
const text = z.string().trim().min(1).max(24000);
export const artifactBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text }).strict(),
  z
    .object({
      type: z.literal("heading"),
      text: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("checklist"),
      items: z
        .array(
          z
            .object({
              text: z.string().trim().min(1).max(2000),
              checked: z.boolean(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      columns: z.array(z.string().max(160)).min(1).max(12),
      rows: z.array(z.array(z.string().max(2000)).max(12)).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      sourceId: z.uuid(),
      alt: z.string().trim().min(1).max(500),
      caption: z.string().max(2000),
    })
    .strict(),
]);
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;
export const artifactDocumentCommands = [
  z
    .object({
      type: z.literal("artifact.compose"),
      conversationOrigin: conversationOriginSchema.optional(),
      artifactId: z.uuid().optional(),
      expectedVersion: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(160),
      purpose: z.string().trim().min(1).max(2000),
      blocks: z.array(artifactBlockSchema).min(1).max(100),
      information: z
        .array(
          z
            .object({ id: z.uuid(), version: z.number().int().positive() })
            .strict(),
        )
        .max(100)
        .default([]),
      sourceIds: z.array(z.uuid()).max(100).default([]),
      contributionId: z.uuid().nullable().optional(),
      reason: z.string().trim().min(1).max(4000),
      nonOperative: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact.from_contribution"),
      conversationOrigin: conversationOriginSchema.optional(),
      contributionId: z.uuid(),
      title: z.string().trim().min(1).max(160),
      purpose: z.string().trim().min(1).max(2000),
      nonOperative: z.literal(true),
    })
    .strict(),
] as const;
export const artifactDocumentCommandSchema = z.discriminatedUnion(
  "type",
  artifactDocumentCommands,
);
export type ArtifactDocumentCommand = z.infer<
  typeof artifactDocumentCommandSchema
>;
