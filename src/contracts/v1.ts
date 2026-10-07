import { productAssistanceSchema } from "./product-assistance.ts";
import { conversationOperationSchema } from "./conversation-operation.ts";
import { z } from "zod";
import { commandSchema } from "./commands.ts";
import { workstreamFocusSchema } from "./attention.ts";
import { conversationReferenceSchema } from "./activity.ts";

export const apiVersion = "1" as const;
export const integer = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const workspaceSchema = z.object({ id: z.uuid(), name: z.string() });
export const workspacesSchema = z.object({
  workspaces: z.array(workspaceSchema),
});
export const commandRequestSchema = z
  .object({
    commandId: z.uuid(),
    expectedActorId: z.string().min(1).optional(),
    command: commandSchema,
  })
  .strict();
export const createWorkspaceSchema = z
  .object({
    commandId: z.uuid(),
    expectedActorId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export const receiptSchema = z.object({
  commandId: z.uuid(),
  status: z.literal("committed"),
  result: z.record(z.string(), z.unknown()),
});
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    requestId: z.uuid(),
    // No receipt is implied by HTTP failure, including a lost response after COMMIT.
    recovery: z.enum(["none", "authenticate", "refresh", "check_receipt"]),
  }),
});
export const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  expiresAt: z.string(),
});
export const loginSchema = z
  .object({ email: z.email(), password: z.string().min(1).max(128) })
  .strict();
export const loginResultSchema = sessionSchema.extend({
  token: z.string().min(1),
});
export const nativeAccountSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("register"),
      email: z.email(),
      name: z.string().trim().min(1).max(120),
      password: z.string().min(12).max(128),
    })
    .strict(),
  z
    .object({ action: z.literal("request-password-reset"), email: z.email() })
    .strict(),
  z
    .object({ action: z.literal("send-verification"), email: z.email() })
    .strict(),
]);
export const nativeAccountResultSchema = z.object({
  requested: z.literal(true),
});
export const stateSchema = z.object({
  workspace: workspaceSchema.extend({
    revision: integer,
    contextRevision: integer,
    accessRevision: integer,
  }),
  messageSequence: integer,
  goals: z.array(
    z.object({
      id: z.uuid(),
      version: integer,
      content: z.string(),
      currentPrimary: z.boolean(),
      establishedBy: z.string(),
    }),
  ),
  adherences: z.array(
    z.object({ goalId: z.uuid(), goalVersion: integer, personId: z.string() }),
  ),
  information: z.array(
    z.object({
      id: z.uuid(),
      version: integer,
      subject: z.string(),
      content: z.string(),
      qualification: z.string(),
      acceptedBy: z.string(),
      candidateId: z.uuid(),
    }),
  ),
  commitments: z.array(
    z.object({
      id: z.uuid(),
      content: z.string(),
      candidateId: z.uuid().nullable(),
      people: z.array(z.string()),
      adoptedAt: z.string().nullable(),
      kind: z.enum(["commitment", "decision", "constraint"]),
      status: z.enum(["proposed", "effective", "superseded"]),
    }),
  ),
});
export const messageSchema = z.object({
  assistanceContext: productAssistanceSchema.nullable().optional(),
  operationResult: conversationOperationSchema.nullable().optional(),
  id: z.uuid(),
  sequence: integer,
  content: z.string(),
  authorId: z.string(),
  actorKind: z.enum(["human", "miriam"]),
  purpose: z.enum([
    "conversation",
    "workspace_introduction",
    "workspace_welcome",
  ]),
  citationSourceIds: z.array(z.uuid()),
  replyToSourceId: z.uuid().nullable(),
  workstreamFocus: workstreamFocusSchema.nullable().optional(),
  reference: conversationReferenceSchema.nullable().optional(),
  authorName: z.string(),
  createdAt: z.string(),
});
export const messagesSchema = z.object({
  messages: z.array(messageSchema),
  nextAfter: integer,
  through: integer,
  hasMore: z.boolean(),
});
export const changesSchema = z.object({
  changes: z.array(z.object({ revision: integer, kind: z.string() })),
  nextAfter: integer,
  headRevision: integer,
  hasMore: z.boolean(),
});
export type WorkspaceState = z.infer<typeof stateSchema>;
export const historySchema = z.object({
  messages: z.array(messageSchema),
  nextBefore: integer,
  through: integer,
  hasMore: z.boolean(),
});
export type MessagePage = z.infer<typeof messagesSchema>;
export type CommandReceipt = z.infer<typeof receiptSchema>;
