import { z } from "zod";

export const addBetaFeedbackSchema = z
  .object({
    type: z.literal("beta.feedback.add"),
    content: z.string().trim().min(1).max(6000),
    messageId: z.uuid().optional(),
  })
  .strict();

export const betaFeedbackViewSchema = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  generatedAt: z.iso.datetime(),
  entries: z.array(
    z.object({
      id: z.uuid(),
      authorId: z.string(),
      authorName: z.string(),
      createdAt: z.iso.datetime(),
      content: z.string(),
      message: z
        .object({
          id: z.uuid(),
          actorKind: z.enum(["human", "miriam"]),
          content: z.string(),
          createdAt: z.iso.datetime(),
        })
        .nullable(),
      configurationAtCapture: z.object({
        provider: z.enum(["openai", "anthropic", "ollama", "unconfigured"]),
        model: z.string().nullable(),
        conversationPromptHash: z.string(),
        appRevision: z.string().nullable(),
      }),
    }),
  ),
});
export type BetaFeedbackView = z.infer<typeof betaFeedbackViewSchema>;
