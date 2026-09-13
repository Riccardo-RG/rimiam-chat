import { z } from "zod";

export const voiceSendSchema = z
  .object({
    type: z.literal("voice.send"),
    filename: z.string().min(1).max(180),
    bytesBase64: z.string().min(1).max(11184812),
    mode: z.enum(["message", "miriam"]),
    allowModelProcessing: z.literal(true),
  })
  .strict();

export const voiceMessagesSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.uuid(),
      sourceId: z.uuid(),
      mode: z.enum(["message", "miriam"]),
      status: z.string(),
      transcript: z.string().nullable(),
      researchQuery: z.string().nullable(),
      qualification: z.string(),
      errorCode: z.string().nullable(),
      interpretationStatus: z.string().nullable(),
    }),
  ),
});
