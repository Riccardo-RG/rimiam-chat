import { z } from "zod";
const id = z.uuid(),
  version = z.number().int().positive(),
  revision = z.number().int().nonnegative();
const ref = z
  .string()
  .min(1)
  .max(1000)
  .refine((s) => !/[\r\n\0]/.test(s));
const address = z.email().max(254).toLowerCase();
const filename = z
  .string()
  .min(1)
  .max(180)
  .refine((s) => !/[\\/\x00-\x1f\x7f]/.test(s));
export const emailAttachmentRefSchema = z
  .object({
    kind: z.enum(["workspace_source", "mailbox_attachment"]),
    id,
    version,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    filename,
  })
  .strict();
export const emailEnvelopeSchema = z
  .object({
    sender: address,
    to: z.array(address).max(20),
    cc: z.array(address).max(20),
    bcc: z.array(address).max(20),
    subject: z
      .string()
      .max(500)
      .refine((s) => !/[\r\n\0]/.test(s)),
    body: z.string().max(24000),
    attachments: z.array(emailAttachmentRefSchema).max(10),
    kind: z.enum(["new", "reply", "forward"]),
    target: z.object({ observationId: id, messageId: ref }).strict().nullable(),
  })
  .strict();
export type EmailEnvelope = z.infer<typeof emailEnvelopeSchema>;
export const emailMessageSchema = z
  .object({
    id: ref,
    threadId: ref.nullable(),
    revision: ref,
    internetMessageId: ref.nullable(),
    references: z.array(ref).max(100),
    from: address,
    to: z.array(address).max(200),
    cc: z.array(address).max(200),
    replyTo: z.array(address).max(20),
    subject: z.string().max(1000),
    body: z.string().max(200000),
    sentAt: z.iso.datetime({ offset: true }),
    attachments: z
      .array(
        z
          .object({
            id: ref,
            filename,
            mediaType: z.string().max(150),
            size: z.number().int().nonnegative().max(1048576),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export const emailObservationSchema = z
  .object({
    messages: z.array(emailMessageSchema).max(50),
    complete: z.boolean(),
    nextCursor: z.string().max(2000).nullable(),
  })
  .strict();
const reason = z.string().trim().min(1).max(2000);
const draft = {
  connectionId: id.nullable(),
  envelope: emailEnvelopeSchema,
  reason,
};
export const emailCommandSchemas = [
  z.object({ type: z.literal("email.draft.create"), ...draft }).strict(),
  z
    .object({
      type: z.literal("email.draft.revise"),
      draftId: id,
      expectedVersion: version,
      compositionId: id.optional(),
      ...draft,
    })
    .strict(),
  z
    .object({
      type: z.literal("email.propose"),
      draftId: id,
      version,
      discloseToRecipients: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("email.authorize"),
      actionId: id,
      version,
      expectedContextRevision: revision,
      expectedAccessRevision: revision,
      representSelf: z.literal(true),
      discloseToRecipients: z.literal(true),
    })
    .strict(),
  z
    .object({ type: z.literal("email.reject"), actionId: id, version, reason })
    .strict(),
  z.object({ type: z.literal("email.retry"), actionId: id, version }).strict(),
  z
    .object({ type: z.literal("email.reconcile"), actionId: id, version })
    .strict(),
  z
    .object({
      type: z.literal("email.read"),
      connectionId: id,
      request: z.discriminatedUnion("mode", [
        z
          .object({
            mode: z.literal("search"),
            query: z.string().trim().min(1).max(500),
            cursor: z.string().max(2000).optional(),
          })
          .strict(),
        z
          .object({
            mode: z.enum(["message", "thread"]),
            targetId: ref,
            cursor: z.string().max(2000).optional(),
          })
          .strict(),
        z
          .object({
            mode: z.literal("attachment"),
            observationId: id,
            messageId: ref,
            attachmentId: ref,
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("email.disclose"),
      observationId: id,
      messageId: ref,
      text: z.string().trim().min(1).max(12000),
      fullHistoryDisclosed: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("email.attachment.disclose"),
      attachmentId: id,
      fullHistoryDisclosed: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("email.disconnect"),
      connectionId: id,
      expectedVersion: version,
    })
    .strict(),
] as const;
export const emailCommandSchema = z.discriminatedUnion(
  "type",
  emailCommandSchemas,
);
export type EmailCommand = z.infer<typeof emailCommandSchema>;
export const emailStatusSchema = z.enum([
  "PROPOSED",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "REJECTED",
]);
export const emailReceiptSchema = z
  .object({
    operationKey: ref,
    envelopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerMessageId: ref,
    providerThreadId: ref.nullable(),
    acceptedAt: z.iso.datetime({ offset: true }),
    evidence: z.literal("provider_accepted"),
  })
  .strict();
export const emailViewSchema = z.object({
  workspaceId: id,
  revision,
  contextRevision: revision,
  accessRevision: revision,
  providerConfigured: z.boolean(),
  connections: z.array(
    z.object({
      id,
      version,
      sender: address,
      label: z.string(),
      canRead: z.boolean(),
      canSend: z.boolean(),
      active: z.boolean(),
    }),
  ),
  drafts: z.array(
    z.object({
      id,
      version,
      connectionId: id.nullable(),
      envelope: emailEnvelopeSchema,
      reason: z.string(),
    }),
  ),
  actions: z.array(
    z.object({
      id,
      draftId: id,
      version,
      status: emailStatusSchema,
      envelope: emailEnvelopeSchema,
      hash: z.string(),
      error: z.string().nullable(),
      receipt: emailReceiptSchema.nullable(),
      canAuthorize: z.boolean(),
      canReject: z.boolean(),
      canRetry: z.boolean(),
      canReconcile: z.boolean(),
    }),
  ),
  observations: z.array(
    z.object({
      id,
      connectionId: id,
      observedAt: z.string(),
      data: emailObservationSchema,
      request: z.object({
        mode: z.enum(["search", "message", "thread"]),
        query: z.string().optional(),
        targetId: z.string().optional(),
        cursor: z.string().optional(),
      }),
    }),
  ),
  attachments: z.array(
    emailAttachmentRefSchema.extend({ observationId: id, messageId: ref }),
  ),
  workspaceAttachments: z.array(emailAttachmentRefSchema),
  disclosures: z.array(
    z.object({ id, sourceId: id, personId: z.string(), createdAt: z.string() }),
  ),
  reads: z.array(
    z.object({ id, status: z.string(), error: z.string().nullable() }),
  ),
  nextDrafts: id.nullable(),
});
export type EmailView = z.infer<typeof emailViewSchema>;

export const emailComposeRequestSchema = z
  .object({
    draftId: id,
    version,
    instruction: z.string().trim().min(1).max(4000),
  })
  .strict();
export const emailSuggestionSchema = z
  .object({
    subject: z
      .string()
      .max(500)
      .regex(/^[^\r\n]*$/),
    body: z.string().max(24000),
    needsClarification: z.string().max(2000).nullable(),
  })
  .strict();
export const emailCompositionSchema = z.object({
  id,
  draftId: id,
  version,
  suggestion: emailSuggestionSchema,
});
export type EmailComposition = z.infer<typeof emailCompositionSchema>;
