import { z } from "zod";

const revision = z.number().int().nonnegative();
const role = z.enum(["authority", "holder"]);
export const accessChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("stewardship"),
      people: z.array(z.string().min(1)).min(1).max(20),
    })
    .strict(),
  z
    .object({ kind: z.literal("delegation"), personId: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal("revoke"), relationshipId: z.uuid() }).strict(),
]);
export const accessCommandSchemas = [
  z
    .object({
      type: z.literal("access.propose"),
      expectedAccessRevision: revision,
      change: accessChangeSchema,
      reason: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal("access.approve"),
      proposalId: z.uuid(),
      expectedAccessRevision: revision,
      role,
      acceptTerms: z.literal(true),
    })
    .strict(),
] as const;
export const accessCommandSchema = z.discriminatedUnion(
  "type",
  accessCommandSchemas,
);
export type AccessCommand = z.infer<typeof accessCommandSchema>;

const relationshipKind = z.enum(["stewardship", "invitation_delegate"]);
export const accessViewSchema = z.object({
  accessRevision: revision,
  members: z.array(
    z.object({ id: z.string(), name: z.string(), active: z.boolean() }),
  ),
  relationships: z.array(
    z.object({
      id: z.uuid(),
      holderId: z.string(),
      holderName: z.string(),
      version: revision,
      active: z.boolean(),
      available: z.boolean(),
      kind: relationshipKind,
      invitations: z.boolean(),
      removeMembers: z.boolean(),
      changeAccess: z.boolean(),
      protected: z.boolean(),
      basis: z.string(),
      conditions: z.array(
        z.object({
          participationId: z.uuid(),
          holderId: z.string(),
          available: z.boolean(),
        }),
      ),
    }),
  ),
  proposals: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["stewardship", "delegation", "revoke"]),
      reason: z.string(),
      proposedBy: z.string(),
      baseAccessRevision: revision,
      createdAt: z.string(),
      termsVersion: z.literal(1),
      terms: z.array(z.string()),
      status: z.enum(["pending", "stale", "adopted"]),
      targets: z.array(
        z.object({
          relationshipId: z.uuid(),
          holderId: z.string(),
          baseVersion: revision,
          active: z.boolean(),
          kind: relationshipKind,
          protected: z.boolean(),
        }),
      ),
      required: z.array(
        z.object({
          role,
          personId: z.string(),
          participationId: z.uuid().nullable(),
        }),
      ),
      approvals: z.array(
        z.object({ role, personId: z.string(), createdAt: z.string() }),
      ),
    }),
  ),
  next: z.string().nullable(),
});
export type AccessView = z.infer<typeof accessViewSchema>;

export const accessHistorySchema = z.object({
  relationshipId: z.uuid(),
  versions: z.array(
    z.object({
      version: revision,
      active: z.boolean(),
      invitations: z.boolean(),
      removeMembers: z.boolean(),
      changeAccess: z.boolean(),
      protected: z.boolean(),
      actor: z.string(),
      basis: z.string(),
      createdAt: z.string(),
      requiredParticipations: z.array(z.uuid()),
    }),
  ),
  nextBefore: revision.nullable(),
});
