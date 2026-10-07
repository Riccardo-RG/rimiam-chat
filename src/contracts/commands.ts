import { conversationOriginSchema } from "./conversation-handoff.ts";
import { addBetaFeedbackSchema } from "./beta-feedback.ts";
import { callCommandSchemas } from "./calls.ts";
import { z } from "zod";
import { voiceSendSchema } from "./voice.ts";
import { calendarCommandSchemas } from "./calendar.ts";
import { emailCommandSchemas } from "./email.ts";
import { taskCommandSchemas } from "./tasks.ts";
import {
  workSuggestionCommandSchema,
  activeWorkCommandSchema,
} from "./active-work.ts";
import { accessCommandSchemas } from "./access.ts";
import { projectCommandSchemas } from "./project.ts";
import { attentionCommandSchemas, workstreamFocusSchema } from "./attention.ts";
import { artifactDocumentCommands } from "./artifact-document.ts";
import { workspaceLinkCommandSchema } from "./workspace-links.ts";
import { conversationReferenceSchema } from "./activity.ts";
import { productAssistanceSchema } from "./product-assistance.ts";

// Public command vocabulary. Domain authorization is enforced exclusively by application services.
const selection = {
  questionId: z.uuid(),
  questionVersion: z.number().int().positive(),
  information: z
    .array(
      z.object({ id: z.uuid(), version: z.number().int().positive() }).strict(),
    )
    .min(1)
    .max(20),
  sourceIds: z.array(z.uuid()).max(20),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(12000),
};
export const artifactDraftSchema = z
  .object({ type: z.literal("artifact.draft"), ...selection })
  .strict();
export const artifactReviseSchema = z
  .object({
    type: z.literal("artifact.revise"),
    artifactId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(4000),
    ...selection,
  })
  .strict();
export const artifactReviewSchema = z
  .object({
    type: z.literal("artifact.review"),
    artifactId: z.uuid(),
    version: z.number().int().positive(),
    people: z.array(z.string().min(1)).min(1).max(20),
    nonOperative: z.literal(true),
  })
  .strict();
export const artifactApproveSchema = z
  .object({
    type: z.literal("artifact.approve"),
    reviewId: z.uuid(),
    expectedAccessRevision: z.number().int().nonnegative(),
    representSelf: z.literal(true),
    nonOperative: z.literal(true),
  })
  .strict();

export const questionOpenSchema = z.object({
  type: z.literal("question.open"),
  sourceId: z.uuid(),
  content: z.string().trim().min(1).max(4000),
  candidateId: z.uuid().optional(),
});
export const questionAnswerSchema = z.object({
  type: z.literal("question.answer"),
  questionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  informationId: z.uuid(),
  informationVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(4000),
});
export const questionReopenSchema = z.object({
  type: z.literal("question.reopen"),
  questionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(4000),
});

export const uploadDocumentSchema = z.object({
  type: z.literal("document.upload"),
  filename: z.string().min(1).max(180),
  bytesBase64: z.string().min(1).max(11184812),
  previousSourceId: z.uuid().optional(),
  allowModelProcessing: z.literal(true).optional(),
});
export const retryDocumentSchema = z
  .object({
    type: z.literal("document.retry"),
    sourceId: z.uuid(),
    allowModelProcessing: z.literal(true).optional(),
  })
  .strict();

export const researchRequestSchema = z.object({
  type: z.literal("research.request"),
  query: z.string().trim().min(1).max(500),
  discloseQuery: z.literal(true),
  questionId: z.uuid().optional(),
  questionVersion: z.number().int().positive().optional(),
});
export const researchControlSchema = z.object({
  type: z.enum(["research.retry", "research.cancel"]),
  workId: z.uuid(),
});

const id = z.uuid();
const text = z.string().trim().min(1).max(12000);
export const commandSchema = z.discriminatedUnion("type", [
  ...callCommandSchemas,
  voiceSendSchema,
  ...attentionCommandSchemas,
  ...accessCommandSchemas,
  ...projectCommandSchemas,
  ...artifactDocumentCommands,
  activeWorkCommandSchema,
  workSuggestionCommandSchema,
  ...taskCommandSchemas,
  ...emailCommandSchemas,
  ...calendarCommandSchemas,
  artifactDraftSchema,
  artifactReviseSchema,
  artifactReviewSchema,
  artifactApproveSchema,
  questionOpenSchema,
  questionAnswerSchema,
  questionReopenSchema,
  uploadDocumentSchema,
  retryDocumentSchema,
  researchRequestSchema,
  workspaceLinkCommandSchema,
  researchControlSchema,
  z.object({
    type: z.literal("goal.establish"),
    content: text,
    conversationOrigin: conversationOriginSchema.optional(),
  }),
  z.object({
    type: z.literal("goal.adhere"),
    goalId: id,
    version: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("message.send"),
    assistanceContext: productAssistanceSchema.optional(),
    content: text,
    workstreamFocus: workstreamFocusSchema.optional(),
    reference: conversationReferenceSchema.optional(),
  }),
  z.object({
    type: z.literal("invitation.create"),
    email: z.email().toLowerCase(),
    fullHistoryDisclosed: z.literal(true),
    sendEmail: z.boolean().optional(),
  }),
  z.object({ type: z.literal("invitation.revoke"), invitationId: id }),
  z.object({
    type: z.literal("member.remove"),
    personId: z.string().min(1),
    expectedAccessRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  }),
  z.object({ type: z.literal("member.leave"), confirmed: z.literal(true) }),
  z.object({
    type: z.literal("access.relinquish"),
    confirmed: z.literal(true),
  }),
  z.object({
    type: z.literal("information.accept"),
    conversationOrigin: conversationOriginSchema.optional(),
    candidateId: id,
    descriptiveOnly: z.literal(true),
  }),
  z.object({
    type: z.literal("information.correct"),
    conversationOrigin: conversationOriginSchema.optional(),
    informationId: id,
    expectedVersion: z.number().int().positive(),
    candidateId: id,
    reason: text,
    descriptiveOnly: z.literal(true),
  }),
  z.object({
    type: z.literal("commitment.propose"),
    candidateId: id,
    people: z.array(z.string().min(1)).min(1).max(20),
  }),
  z.object({
    type: z.literal("commitment.approve"),
    proposalId: id,
    expectedContextRevision: z.number().int().nonnegative(),
    expectedAccessRevision: z.number().int().nonnegative(),
    representSelf: z.literal(true),
  }),
  z.object({ type: z.literal("interpretation.retry"), interpretationId: id }),
  addBetaFeedbackSchema,
]);
export type Command = z.infer<typeof commandSchema>;
