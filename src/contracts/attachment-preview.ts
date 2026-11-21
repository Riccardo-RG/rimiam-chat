import { z } from "zod";

export const attachmentPreviewSchema = z.object({
  filename: z.string(),
  mediaType: z.string(),
  bytes: z.int().nonnegative(),
  preview: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("image") }),
    z.object({
      kind: z.literal("audio"),
      extension: z.enum(["mp3", "m4a", "wav", "webm", "ogg"]),
    }),
    z.object({ kind: z.literal("page"), jpeg: z.string().min(1).max(1398104) }),
    z.object({
      kind: z.literal("text"),
      text: z.string().max(16000),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.literal("unavailable"),
      reason: z.enum(["format", "unreadable", "busy"]),
    }),
  ]),
});
export type AttachmentPreview = z.infer<typeof attachmentPreviewSchema>;
