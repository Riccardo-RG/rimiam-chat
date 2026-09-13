import { z } from "zod";

export const recordingConsentText =
  "Acconsento personalmente alla registrazione del mio audio, alla trascrizione e alla conservazione come Fonte condivisa del Workspace. Audio, trascrizione e relativa storia saranno visibili ai membri idonei secondo ADR-0009, inclusi i membri ammessi successivamente. Il ritiro interrompe le acquisizioni future, non elimina il materiale già autorizzato. L'analisi di RIMIAM richiede una richiesta separata.";
export const callCommandSchemas = [
  z.object({ type: z.literal("call.join") }).strict(),
  z
    .object({
      type: z.enum([
        "call.leave",
        "call.recording.request",
        "call.recording.withdraw",
        "call.transcription.retry",
        "call.analyze",
      ]),
      callId: z.uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("call.recording.consent"),
      callId: z.uuid(),
      epoch: z.number().int().positive(),
      consentText: z.literal(recordingConsentText),
    })
    .strict(),
] as const;
export const callViewSchema = z.object({
  configured: z.boolean(),
  recordingConfigured: z.boolean(),
  consentText: z.string(),
  calls: z.array(
    z.object({
      id: z.uuid(),
      version: z.number(),
      state: z.enum(["open", "ended"]),
      recordingRequested: z.boolean(),
      epoch: z.number(),
      errorCode: z.string().nullable(),
      participants: z.array(
        z.object({
          id: z.uuid(),
          userId: z.string(),
          name: z.string(),
          state: z.string(),
          consented: z.boolean(),
        }),
      ),
      recordings: z.array(
        z.object({
          id: z.uuid(),
          participantId: z.uuid(),
          consentEpoch: z.number(),
          consentEventVersion: z.number().nullable(),
          state: z.string(),
          captureFenced: z.boolean(),
          transcriptionStatus: z.string().nullable(),
          errorCode: z.string().nullable(),
          createdAt: z.string(),
          endedAt: z.string().nullable(),
          segments: z.array(
            z.object({
              id: z.uuid(),
              ordinal: z.number(),
              content: z.string(),
              qualification: z.string(),
              startSeconds: z.number(),
            }),
          ),
        }),
      ),
      events: z.array(
        z.object({
          version: z.number(),
          kind: z.string(),
          actorId: z.string().nullable(),
          participantId: z.uuid().nullable(),
          epoch: z.number().nullable(),
          consentText: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      analysisRequested: z.boolean(),
    }),
  ),
});
export type CallView = z.infer<typeof callViewSchema>;
